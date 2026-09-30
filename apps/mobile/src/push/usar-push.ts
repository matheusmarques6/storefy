/**
 * O push, ligado ao ciclo de vida do app.
 *
 * Este é o único arquivo do push que conhece React. Tudo que ele faz é chamar,
 * na hora certa, as funções que já estão testadas em `sessao.ts`, `caixa.ts` e
 * `permissao.ts` — e guardar o pouco de estado que a tela precisa ver.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { AppConfig, AvisoDoPush, OrigemDoPush } from '@storefy/config-schema';
import type { Ambiente } from '../nucleo/ambiente.ts';
import { buscarCaixaDeAvisos, credenciaisDe, type AvisoDaCaixa } from './api.ts';
import {
  caixaDesatualizada,
  montarCaixa,
  marcarLido,
  marcarTodosLidos,
  naoLidos,
  situacaoDaCaixa,
  type AvisoNaTela,
  type SituacaoDaCaixa,
} from './caixa.ts';
import {
  contarAbertura,
  gravarCaixa,
  gravarHistorico,
  gravarLidos,
  gravarToque,
  idDaInstalacao,
  lerCaixaDoDisco,
  lerHistoricoDoDisco,
  lerLidosDoDisco,
  lerToqueDoDisco,
} from './disco.ts';
import { marcaDoToque, type MarcaDoPush } from '../webview/atribuicao.ts';
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
  avisosParaPrometer,
  carrinhoMudou,
  checkoutIniciado,
  contarAberturaDoEnvio,
  identificarCliente,
  iniciarPush,
  ouvirToques,
  pedidoConcluido,
  registrarAbertura,
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
  /**
   * O que a tela pode prometer além das promoções: os avisos das automações
   * que a loja deixou ligadas. Vazio quando não deu para saber.
   */
  avisosPrometidos: AvisoDoPush[];
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
  /** O que a caixa mostra: a lista, o carregando, o erro ou como ligar as notificações. */
  situacaoDaCaixa: SituacaoDaCaixa;
  /** A lista na tela é a guardada no aparelho: o servidor não respondeu. */
  caixaDesatualizada: boolean;
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
  /**
   * A última notificação tocada que ainda responde pela compra, pronta para
   * as abas gravarem no carrinho. `null` sem toque, ou com o toque vencido.
   */
  marcaDoPush: MarcaDoPush | null;
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
      lerInstalacao: idDaInstalacao,
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
  const [avisosPrometidos, setAvisosPrometidos] = useState<AvisoDoPush[]>([]);

  /** `getOptedInAsync`; `null` até ser lido. */
  const [inscrito, setInscrito] = useState<boolean | null>(null);
  const [mudandoNotificacoes, setMudandoNotificacoes] = useState(false);
  const [erroNasNotificacoes, setErroNasNotificacoes] = useState<string | null>(null);

  const [avisosBrutos, setAvisosBrutos] = useState<AvisoDaCaixa[]>([]);
  const [lidos, setLidos] = useState<string[]>([]);
  const [caixaCarregando, setCaixaCarregando] = useState(false);
  /** Já há resposta: do servidor, ou a caixa guardada no aparelho. */
  const [caixaLida, setCaixaLida] = useState(false);
  const [falhaNaCaixa, setFalhaNaCaixa] = useState(false);
  /*
   * O servidor já respondeu? A caixa guardada chega do disco depois, às vezes,
   * e não pode trocar a lista nova pela velha.
   */
  const caixaDoServidor = useRef(false);
  const [marcaDoPush, setMarcaDoPush] = useState<MarcaDoPush | null>(null);

  /* ----------------------------------------------------------- abertura */

  useEffect(() => {
    let vivo = true;
    const segueVivo = (): boolean => vivo;

    async function comecar(): Promise<void> {
      const [total, guardado, lidosGuardados, toqueGuardado, caixaGuardada] = await Promise.all([
        contarAbertura(),
        lerHistoricoDoDisco(),
        lerLidosDoDisco(),
        lerToqueDoDisco(),
        lerCaixaDoDisco(),
      ]);
      if (!segueVivo()) return;
      setAberturas(total);
      setHistorico(guardado);
      setLidos(lidosGuardados);
      // A caixa da última vez aparece já, com ou sem internet — até o servidor responder.
      if (caixaGuardada !== null && !caixaDoServidor.current) {
        setAvisosBrutos(caixaGuardada);
        setCaixaLida(true);
      }
      // O toque que abriu o app a frio chega antes do disco, e é mais novo que ele.
      setMarcaDoPush((atual) => atual ?? marcaDoToque(toqueGuardado, Date.now()));

      if (!ativo) {
        // Sem push neste build não há o que ler; liberar a marca evita deixar
        // a pergunta de abertura presa para sempre.
        setSistemaLido(true);
        // Mas a abertura conta: instalações, ativos e o MAU da loja não
        // dependem de o app ter notificação.
        void registrarAbertura(dependencias);
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

  /*
   * O toque vira a origem da próxima compra: na memória, para as abas abertas
   * gravarem já na próxima mudança de carrinho, e no disco, para a compra que
   * acontece depois de fechar e reabrir o app.
   */
  const guardarOrigem = useCallback((origem: OrigemDoPush): void => {
    const toque = { origem, tocadaEmMs: Date.now() };
    setMarcaDoPush(marcaDoToque(toque, toque.tocadaEmMs));
    void gravarToque(toque);
  }, []);

  /* O toque numa automação vira abertura no painel (C09, C10 e C11). */
  const contarToqueNaAutomacao = useCallback(
    (envio: string): void => {
      void contarAberturaDoEnvio(dependencias, envio);
    },
    [dependencias],
  );

  const jaEscuta = useRef(false);
  useEffect(() => {
    if (!ativo || config === null || jaEscuta.current) return;
    jaEscuta.current = true;

    ouvirToques(
      notificadorReal,
      { urlDaLoja: config.store.url, dominios: config.store.domains },
      navegar,
      guardarOrigem,
      contarToqueNaAutomacao,
    );
  }, [ativo, config, contarToqueNaAutomacao, guardarOrigem, navegar]);

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

  /*
   * Os avisos da loja, perguntados uma vez por abertura do app. Só a resposta
   * certa fica guardada: a incerta (sem rede, servidor fora) é perguntada de
   * novo na próxima vez que a tela for abrir.
   */
  const avisosDaLoja = useRef<Promise<AvisoDoPush[] | null> | null>(null);
  const carregarAvisos = useCallback((): Promise<AvisoDoPush[] | null> => {
    const guardada = avisosDaLoja.current;
    if (guardada !== null) return guardada;
    const pergunta = avisosParaPrometer(dependencias)
      .catch(() => null)
      .then((avisos) => {
        if (avisos === null) avisosDaLoja.current = null;
        return avisos;
      });
    avisosDaLoja.current = pergunta;
    return pergunta;
  }, [dependencias]);

  // Pergunta antes de precisar, para a tela abrir sem esperar a rede.
  useEffect(() => {
    if (!ativo || !sistemaLido || sistema !== 'nao-perguntado') return;
    void carregarAvisos();
  }, [ativo, carregarAvisos, sistema, sistemaLido]);

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

      if (decisao.acao === 'pre-prompt') {
        // A tela só promete o que a loja manda; sem resposta, só as promoções.
        void carregarAvisos().then((avisos) => {
          setAvisosPrometidos(avisos ?? []);
          setMostrarPrePrompt(true);
        });
      }
      if (decisao.acao === 'pedir-ao-sistema') void chamarSistema();
    },
    [
      aberturas,
      ativo,
      carregarAvisos,
      chamarSistema,
      config?.features.pushPromptTiming,
      historico,
      sistema,
    ],
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

  const buscarCaixa = useCallback((): void => {
    if (credenciais === null || inscricao === null) return;
    setCaixaCarregando(true);
    void buscarCaixaDeAvisos(credenciais, inscricao).then(
      (resultado) => {
        setCaixaCarregando(false);
        if (!resultado.ok) {
          // A lista guardada (se houver) continua; a tela diz que está velha.
          setFalhaNaCaixa(true);
          return;
        }
        caixaDoServidor.current = true;
        setAvisosBrutos(resultado.dados.avisos);
        setCaixaLida(true);
        setFalhaNaCaixa(false);
        void gravarCaixa(resultado.dados.avisos);
      },
      () => {
        setCaixaCarregando(false);
        setFalhaNaCaixa(true);
      },
    );
  }, [credenciais, inscricao]);

  useEffect(() => {
    buscarCaixa();
  }, [buscarCaixa]);

  const notificacoes = estadoDasNotificacoes({ disponivel: ativo, sistemaLido, sistema, inscrito });

  /*
   * Notificações ligadas e nenhuma inscrição depois de um tempo (o SDK não
   * conseguiu criá-la): sem ela não há caixa para buscar. Vira o erro com
   * "Tentar de novo", e não um carregando sem fim.
   */
  useEffect(() => {
    if (!ativo || credenciais === null || inscricao !== null || notificacoes !== 'ligadas') return;
    const relogio = setTimeout(() => {
      setFalhaNaCaixa(true);
    }, 10_000);
    return () => {
      clearTimeout(relogio);
    };
  }, [ativo, credenciais, inscricao, notificacoes]);

  /** O "Tentar de novo" e o puxar para atualizar: sem inscrição, pede a ela ao SDK antes. */
  const recarregarCaixa = useCallback((): void => {
    if (inscricao !== null) {
      buscarCaixa();
      return;
    }
    if (!ativo || credenciais === null) return;
    setCaixaCarregando(true);
    notificadorReal.idDaInscricao().then(
      (id) => {
        setCaixaCarregando(false);
        // A inscrição nova dispara a busca (o efeito acima).
        if (id === null) setFalhaNaCaixa(true);
        else setInscricao(id);
      },
      () => {
        setCaixaCarregando(false);
        setFalhaNaCaixa(true);
      },
    );
  }, [ativo, buscarCaixa, credenciais, inscricao]);

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

  const temAvisos = avisos.length > 0;

  return {
    mostrarPrePrompt,
    avisosPrometidos,
    aceitarNoPrePrompt,
    recusarNoPrePrompt,
    pedirPermissao,
    avisos,
    avisosNaoLidos: naoLidos(avisos),
    caixaCarregando,
    situacaoDaCaixa: situacaoDaCaixa({
      notificacoes,
      comCredenciais: credenciais !== null,
      temAvisos,
      jaLeu: caixaLida,
      falhou: falhaNaCaixa,
    }),
    caixaDesatualizada: caixaDesatualizada({ temAvisos, falhou: falhaNaCaixa }),
    recarregarCaixa,
    marcarAvisoLido,
    marcarTudoLido,
    aoMudarCarrinho,
    aoIniciarCheckout,
    aoConcluirPedido,
    aoIdentificarCliente,
    aoPedirAvisoDeVolta,
    marcaDoPush,
    notificacoes,
    mudandoNotificacoes,
    erroNasNotificacoes,
    lerNotificacoes,
    ligarAsNotificacoes,
    desligarAsNotificacoes,
  };
}
