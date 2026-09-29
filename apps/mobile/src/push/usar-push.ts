/**
 * O push, ligado ao ciclo de vida do app.
 *
 * Este é o único arquivo do push que conhece React. Tudo que ele faz é chamar,
 * na hora certa, as funções que já estão testadas em `sessao.ts`, `caixa.ts` e
 * `permissao.ts` — e guardar o pouco de estado que a tela precisa ver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { AppConfig } from '@storefy/config-schema';
import type { Ambiente } from '../nucleo/ambiente.ts';
import { buscarCaixaDeAvisos, credenciaisDe, type AvisoDaCaixa } from './api.ts';
import { montarCaixa, marcarLido, marcarTodosLidos, naoLidos, type AvisoNaTela } from './caixa.ts';
import {
  contarAbertura,
  gravarHistorico,
  gravarLidos,
  lerHistoricoDoDisco,
  lerLidosDoDisco,
} from './disco.ts';
import { notificadorReal } from './onesignal.ts';
import {
  decidirPermissao,
  registrarRecusa,
  HISTORICO_VAZIO,
  type Gatilho,
  type HistoricoDoPrePrompt,
  type PermissaoDoSistema,
} from './permissao.ts';
import {
  avisarQuandoVoltar,
  carrinhoMudou,
  checkoutIniciado,
  identificarCliente,
  iniciarPush,
  ouvirToques,
  pedidoConcluido,
  registrarQuandoAssinar,
  vincularCliente,
  type DependenciasDaSessao,
  type RespostaDoAvisoDeVolta,
} from './sessao.ts';
import type { DestinoDoPush } from './deep-link.ts';
import type { CarrinhoParaTag } from './tags.ts';
import {
  desligarNotificacoes,
  estadoDasNotificacoes,
  ligarNotificacoes,
  type EstadoDasNotificacoes,
} from './ajustes.ts';

export interface UsoDoPush {
  /** Mostrar a tela de explicação (M03) agora? */
  mostrarPrePrompt: boolean;
  /** O cliente aceitou na nossa tela: chama o pedido do sistema. */
  aceitarNoPrePrompt: () => void;
  /** O cliente disse "agora não". */
  recusarNoPrePrompt: () => void;
  /** A página pediu permissão (`REQUEST_PUSH_PERMISSION`). */
  pedirPermissao: () => void;
  /** A caixa de avisos, já ordenada e com lidos marcados. */
  avisos: AvisoNaTela[];
  avisosNaoLidos: number;
  caixaCarregando: boolean;
  recarregarCaixa: () => void;
  marcarAvisoLido: (id: string) => void;
  marcarTudoLido: () => void;
  /** Eventos que a página dispara. */
  aoMudarCarrinho: (carrinho: CarrinhoParaTag & { token?: string; currency?: string }) => void;
  aoIniciarCheckout: (token: string, itens: number) => void;
  aoConcluirPedido: (pedido: { totalCents?: number; currency?: string }) => void;
  aoIdentificarCliente: (customerId: string | undefined) => void;
  /** "Me avise quando voltar", com a resposta que a página vai mostrar. */
  aoPedirAvisoDeVolta: (pedido: {
    variantId: string;
    path?: string;
  }) => Promise<RespostaDoAvisoDeVolta>;
  /** M12: o estado das notificações, e ligar e desligar dentro do app. */
  notificacoes: EstadoDasNotificacoes;
  mudandoNotificacoes: boolean;
  erroNasNotificacoes: string | null;
  lerNotificacoes: () => void;
  ligarAsNotificacoes: () => void;
  desligarAsNotificacoes: () => void;
}

/**
 * Quem desligou as notificações no app e toca em "me avise" quer ESTE aviso —
 * mas religar liga também as promoções. Então pergunta, em vez de religar
 * calado (e em vez de gravar um pedido que nunca chegaria).
 */
function perguntarSeReliga(nomeDaLoja: string): Promise<boolean> {
  return new Promise((resolver) => {
    Alert.alert(
      'Ligar as notificações?',
      `Você desligou as notificações da ${nomeDaLoja}. Para avisar quando o produto voltar, elas precisam estar ligadas.`,
      [
        {
          text: 'Agora não',
          style: 'cancel',
          onPress: () => {
            resolver(false);
          },
        },
        {
          text: 'Ligar',
          onPress: () => {
            resolver(true);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          resolver(false);
        },
      },
    );
  });
}

interface Opcoes {
  ambiente: Ambiente;
  config: AppConfig | null;
  /** Ligado neste build? Vem de `recursosDoBuild`. */
  ativo: boolean;
  /** Para onde levar o toque numa notificação. */
  navegar: (destino: DestinoDoPush) => void;
}

export function usarPush({ ambiente, config, ativo, navegar }: Opcoes): UsoDoPush {
  const credenciais = useMemo(() => credenciaisDe(ambiente), [ambiente]);

  const dependencias = useMemo<DependenciasDaSessao>(
    () => ({
      notificador: notificadorReal,
      credenciais,
      plataforma: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: ambiente.appVersion,
      oneSignalAppId: ativo ? ambiente.oneSignalAppId : null,
    }),
    [ambiente.appVersion, ambiente.oneSignalAppId, ativo, credenciais],
  );

  const [inscricao, setInscricao] = useState<string | null>(null);
  const [sistema, setSistema] = useState<PermissaoDoSistema>('nao-perguntado');
  /*
   * A permissão real só se sabe depois de perguntar ao SDK, que é assíncrono.
   * Sem esta marca, a pergunta de abertura sairia com o valor inicial
   * (`nao-perguntado`) e a tela de explicação apareceria para quem JÁ aceitou
   * notificações — a pior primeira impressão possível do recurso.
   */
  const [sistemaLido, setSistemaLido] = useState(false);
  const [historico, setHistorico] = useState<HistoricoDoPrePrompt>(HISTORICO_VAZIO);
  const [aberturas, setAberturas] = useState(0);
  const [mostrarPrePrompt, setMostrarPrePrompt] = useState(false);

  /** `getOptedInAsync`; `null` até ser lido. */
  const [inscrito, setInscrito] = useState<boolean | null>(null);
  const [mudandoNotificacoes, setMudandoNotificacoes] = useState(false);
  const [erroNasNotificacoes, setErroNasNotificacoes] = useState<string | null>(null);

  const [avisosBrutos, setAvisosBrutos] = useState<AvisoDaCaixa[]>([]);
  const [lidos, setLidos] = useState<string[]>([]);
  const [caixaCarregando, setCaixaCarregando] = useState(false);

  /* ----------------------------------------------------------- abertura */

  useEffect(() => {
    let vivo = true;
    const segueVivo = (): boolean => vivo;

    async function comecar(): Promise<void> {
      const [total, guardado, lidosGuardados] = await Promise.all([
        contarAbertura(),
        lerHistoricoDoDisco(),
        lerLidosDoDisco(),
      ]);
      if (!segueVivo()) return;
      setAberturas(total);
      setHistorico(guardado);
      setLidos(lidosGuardados);

      if (!ativo) {
        // Sem push neste build não há o que ler; liberar a marca evita deixar
        // a pergunta de abertura presa para sempre.
        setSistemaLido(true);
        return;
      }

      const resultado = await iniciarPush(dependencias);
      if (!segueVivo()) return;
      setInscricao(resultado.inscricao);

      try {
        const tem = await notificadorReal.temPermissao();
        if (!segueVivo()) return;
        if (tem) {
          setSistema('concedida');
        } else {
          /*
           * Sem permissão, a diferença entre "ainda não perguntamos" e "ele
           * recusou" é `podePedir`. Tratar as duas como a mesma coisa faria o
           * app insistir com quem já disse não no sistema — onde insistir não
           * mostra nada e só gasta a paciência.
           */
          const pode = await notificadorReal.podePedir();
          if (!segueVivo()) return;
          setSistema(pode ? 'nao-perguntado' : 'negada');
        }
      } catch {
        setSistema('nao-perguntado');
      } finally {
        if (segueVivo()) setSistemaLido(true);
      }

      try {
        const estaInscrito = await notificadorReal.inscrito();
        if (segueVivo()) setInscrito(estaInscrito);
      } catch {
        if (segueVivo()) setErroNasNotificacoes('Não foi possível conferir as notificações agora.');
      }
    }

    void comecar();
    return () => {
      vivo = false;
    };
  }, [ativo, dependencias]);

  /* ------------------------------------- inscrição que aparece depois */

  const jaOuviu = useRef(false);
  useEffect(() => {
    if (!ativo || jaOuviu.current) return;
    jaOuviu.current = true;

    registrarQuandoAssinar(dependencias, () => {
      /* O registro já aconteceu; o estado local é atualizado abaixo. */
    });
    notificadorReal.aoMudarInscricao((id) => {
      setInscricao(id);
    });
  }, [ativo, dependencias]);

  /* ------------------------------------------------- toque na notificação */

  const jaEscuta = useRef(false);
  useEffect(() => {
    if (!ativo || config === null || jaEscuta.current) return;
    jaEscuta.current = true;

    ouvirToques(
      notificadorReal,
      { urlDaLoja: config.store.url, dominios: config.store.domains },
      navegar,
    );
  }, [ativo, config, navegar]);

  /* ------------------------------------------------------- a permissão */

  /** O pedido do sistema, dizendo a quem chamou se o cliente aceitou. */
  const pedirAoSistema = useCallback(async (): Promise<boolean> => {
    try {
      const aceitou = await notificadorReal.pedirPermissao();
      setSistema(aceitou ? 'concedida' : 'negada');
      return aceitou;
    } catch {
      setSistema('nao-perguntado');
      return false;
    }
  }, []);

  const chamarSistema = useCallback(async (): Promise<void> => {
    await pedirAoSistema();
  }, [pedirAoSistema]);

  /* ------------------------------------------ M12: ligar e desligar */

  /*
   * Relê permissão e inscrição. A tela de ajustes chama ao abrir, e o SDK
   * avisa quando a permissão muda — inclusive nos ajustes do celular: quem
   * vai lá ligar e volta encontra a tela certa, sem reabrir o app.
   */
  const lerNotificacoes = useCallback((): void => {
    if (!ativo) return;
    setErroNasNotificacoes(null);
    void (async (): Promise<void> => {
      try {
        const tem = await notificadorReal.temPermissao();
        const pode = tem || (await notificadorReal.podePedir());
        setSistema(tem ? 'concedida' : pode ? 'nao-perguntado' : 'negada');
        setSistemaLido(true);
        setInscrito(await notificadorReal.inscrito());
      } catch {
        setErroNasNotificacoes('Não foi possível conferir as notificações agora.');
      }
    })();
  }, [ativo]);

  const jaOuvePermissao = useRef(false);
  useEffect(() => {
    if (!ativo || jaOuvePermissao.current) return;
    jaOuvePermissao.current = true;
    notificadorReal.aoMudarPermissao(() => {
      lerNotificacoes();
    });
  }, [ativo, lerNotificacoes]);

  const ligarAsNotificacoes = useCallback((): void => {
    setMudandoNotificacoes(true);
    setErroNasNotificacoes(null);
    ligarNotificacoes(notificadorReal, sistema, pedirAoSistema)
      .then((resultado) => {
        setSistema(
          resultado === 'ligadas'
            ? 'concedida'
            : resultado === 'bloqueadas'
              ? 'negada'
              : 'nao-perguntado',
        );
        setInscrito(resultado === 'ligadas');
      })
      .catch(() => {
        setErroNasNotificacoes('Não foi possível ligar as notificações agora. Tente de novo.');
      })
      .finally(() => {
        setMudandoNotificacoes(false);
      });
  }, [pedirAoSistema, sistema]);

  const desligarAsNotificacoes = useCallback((): void => {
    setErroNasNotificacoes(null);
    try {
      desligarNotificacoes(notificadorReal);
      setInscrito(false);
    } catch {
      setErroNasNotificacoes('Não foi possível desligar as notificações agora. Tente de novo.');
    }
  }, []);

  const perguntarSePuder = useCallback(
    (gatilho: Gatilho): void => {
      const decisao = decidirPermissao({
        sistema,
        historico,
        aberturas,
        gatilho,
        agoraMs: Date.now(),
        disponivel: ativo,
        // A escolha do lojista manda. Sem config ainda, `manual` é o lado
        // seguro: não gasta a única chance do iOS por conta própria.
        momento: config?.features.pushPromptTiming ?? 'manual',
      });

      if (decisao.acao === 'pre-prompt') setMostrarPrePrompt(true);
      if (decisao.acao === 'pedir-ao-sistema') void chamarSistema();
    },
    [aberturas, ativo, chamarSistema, config?.features.pushPromptTiming, historico, sistema],
  );

  const aceitarNoPrePrompt = useCallback((): void => {
    setMostrarPrePrompt(false);
    void chamarSistema();
  }, [chamarSistema]);

  const recusarNoPrePrompt = useCallback((): void => {
    setMostrarPrePrompt(false);
    setHistorico((anterior) => {
      const novo = registrarRecusa(anterior, Date.now());
      void gravarHistorico(novo);
      return novo;
    });
  }, []);

  const pedirPermissao = useCallback((): void => {
    perguntarSePuder('pedido-da-pagina');
  }, [perguntarSePuder]);

  // A pergunta na abertura espera a contagem de aberturas voltar do disco.
  const jaPerguntou = useRef(false);
  useEffect(() => {
    if (!ativo || aberturas === 0 || !sistemaLido || jaPerguntou.current) return;
    jaPerguntou.current = true;
    perguntarSePuder('abertura');
  }, [aberturas, ativo, perguntarSePuder, sistemaLido]);

  /* ---------------------------------------------------- caixa de avisos */

  const recarregarCaixa = useCallback((): void => {
    if (credenciais === null || inscricao === null) return;
    setCaixaCarregando(true);
    void buscarCaixaDeAvisos(credenciais, inscricao).then(
      (resultado) => {
        setCaixaCarregando(false);
        if (resultado.ok) setAvisosBrutos(resultado.dados.avisos);
      },
      () => {
        setCaixaCarregando(false);
      },
    );
  }, [credenciais, inscricao]);

  useEffect(() => {
    recarregarCaixa();
  }, [recarregarCaixa]);

  const avisos = useMemo(() => montarCaixa(avisosBrutos, lidos), [avisosBrutos, lidos]);

  const marcarAvisoLido = useCallback(
    (id: string): void => {
      setLidos((anteriores) => {
        const novos = marcarLido(anteriores, id, avisosBrutos);
        void gravarLidos(novos);
        return novos;
      });
    },
    [avisosBrutos],
  );

  const marcarTudoLido = useCallback((): void => {
    const novos = marcarTodosLidos(avisosBrutos);
    setLidos(novos);
    void gravarLidos(novos);
  }, [avisosBrutos]);

  /* ------------------------------------------------ eventos da página */

  const aoMudarCarrinho = useCallback(
    (carrinho: CarrinhoParaTag & { token?: string; currency?: string }): void => {
      void carrinhoMudou(dependencias, inscricao, carrinho);
      if (carrinho.count > 0) perguntarSePuder('carrinho');
    },
    [dependencias, inscricao, perguntarSePuder],
  );

  const aoIniciarCheckout = useCallback(
    (token: string, itens: number): void => {
      void checkoutIniciado(dependencias, inscricao, token, itens);
    },
    [dependencias, inscricao],
  );

  const aoConcluirPedido = useCallback(
    (pedido: { totalCents?: number; currency?: string }): void => {
      void pedidoConcluido(dependencias, inscricao, pedido);
    },
    [dependencias, inscricao],
  );

  const aoIdentificarCliente = useCallback(
    (customerId: string | undefined): void => {
      identificarCliente(notificadorReal, customerId);
      void vincularCliente(dependencias, inscricao, customerId);
    },
    [dependencias, inscricao],
  );

  const nomeDaLoja = config?.store.name ?? 'loja';
  const aoPedirAvisoDeVolta = useCallback(
    async (pedido: { variantId: string; path?: string }): Promise<RespostaDoAvisoDeVolta> => {
      const resposta = await avisarQuandoVoltar(
        dependencias,
        { inscricao, sistema, inscrito },
        pedido,
        {
          pedirPermissao: pedirAoSistema,
          confirmarReligar: () => perguntarSeReliga(nomeDaLoja),
        },
      );
      // O pedido pode ter ligado as notificações: a M12 precisa ver isso.
      lerNotificacoes();
      return resposta;
    },
    [dependencias, inscricao, inscrito, lerNotificacoes, nomeDaLoja, pedirAoSistema, sistema],
  );

  const notificacoes = estadoDasNotificacoes({ disponivel: ativo, sistemaLido, sistema, inscrito });

  return {
    mostrarPrePrompt,
    aceitarNoPrePrompt,
    recusarNoPrePrompt,
    pedirPermissao,
    avisos,
    avisosNaoLidos: naoLidos(avisos),
    caixaCarregando,
    recarregarCaixa,
    marcarAvisoLido,
    marcarTudoLido,
    aoMudarCarrinho,
    aoIniciarCheckout,
    aoConcluirPedido,
    aoIdentificarCliente,
    aoPedirAvisoDeVolta,
    notificacoes,
    mudandoNotificacoes,
    erroNasNotificacoes,
    lerNotificacoes,
    ligarAsNotificacoes,
    desligarAsNotificacoes,
  };
}
