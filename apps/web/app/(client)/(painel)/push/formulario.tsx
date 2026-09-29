'use client';

/**
 * O formulário da campanha (C08), usado para criar e para editar.
 *
 * A prévia fica ao lado e acompanha a digitação: o lojista escreve num campo
 * largo de navegador e a mensagem chega numa tira estreita de tela bloqueada,
 * e não há como consertar depois de enviar.
 *
 * ENVIAR AGORA PEDE CONFIRMAÇÃO, e o botão diz o que vai acontecer. Os dois
 * nasceram de um defeito: na edição de um rascunho o único botão era "Salvar
 * alterações", com "Agora" marcado — e salvar MANDAVA a campanha para todos os
 * clientes. Uma notificação enviada não volta; o clique que a envia precisa
 * saber disso.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  MAXIMO_DO_CORPO,
  MAXIMO_DO_TITULO,
  validarCampanha,
  type ProblemaNoFormulario,
} from '@/lib/campanha';
import { descricaoDoPublico, lerPublico } from '@/lib/publico-do-push';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PreviaDaNotificacao } from './previa-da-notificacao';
import { EnvioDeTeste } from './envio-de-teste';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import type { EstadoDoPush } from './acoes';
import { SeletorDoCatalogo } from './catalogo/seletor';
import { CampoDaImagem, type ImagemDaCampanha } from './campo-da-imagem';
import { CampoDoPublico, type PublicoNoFormulario } from './campo-do-publico';
import { SeletorDeEmoji } from './seletor-de-emoji';

export interface ValoresIniciais {
  title: string;
  body: string;
  deepLink: string;
  agendarPara: string;
  enviarAgora: boolean;
  imagem: ImagemDaCampanha | null;
  publico: PublicoNoFormulario;
}

/** O que as ações do servidor recebem: a imagem vai pelo caminho no bucket. */
export interface ValoresDoEnvio {
  title: string;
  body: string;
  deepLink: string;
  agendarPara: string;
  enviarAgora: boolean;
  imagem: string | null;
  publico: { tipo: string; dias: string };
}

function paraOEnvio(valores: ValoresIniciais): ValoresDoEnvio {
  return { ...valores, imagem: valores.imagem?.caminho ?? null };
}

interface Props {
  nomeDoApp: string;
  urlDaLoja: string;
  /** O fuso da loja, para conferir o horário aqui mesmo, antes de ir ao servidor. */
  fuso: string;
  /**
   * Em que fuso o horário é lido — "horário de Brasília". Sem isto o lojista
   * não sabe em que hora está agendando, e é essa dúvida que faz alguém
   * marcar 23:00 "para compensar" um fuso que já estava certo.
   */
  nomeDoFuso: string;
  /** Aparelhos para o envio de teste. */
  aparelhos: readonly AparelhoParaTeste[];
  /** Quantos aparelhos têm o app: o tamanho do envio, dito na confirmação. */
  alcance: number | null;
  /** Sem as notificações ligadas, "agora" quer dizer "assim que ligar". */
  notificacoesLigadas: boolean;
  iniciais: ValoresIniciais;
  /** O botão principal diz o que acontece com o que está marcado. */
  rotuloDoEnvio: { agora: string; agendado: string };
  aoEnviar: (valores: ValoresDoEnvio) => Promise<EstadoDoPush>;
  /** Salvar sem enviar: na criação e na edição de um rascunho. */
  aoSalvarRascunho?: (
    valores: Omit<ValoresDoEnvio, 'agendarPara' | 'enviarAgora'>,
  ) => Promise<EstadoDoPush>;
  rotuloDoRascunho?: string;
}

/** "quem não abre o app há 30 dias" — o público no meio de uma frase, ou `null` para todos. */
function paraQuem(publico: PublicoNoFormulario): string | null {
  if (publico.tipo === 'todos') return null;
  const lido = lerPublico(publico.tipo, publico.dias);
  const quem = lido.ok ? descricaoDoPublico(lido.publico) : 'o público escolhido';
  return `${quem.charAt(0).toLowerCase()}${quem.slice(1)}`;
}

/** O que a confirmação diz sobre o tamanho do envio — e, com público, para quem vai. */
function descricaoDoEnvio(
  alcance: number | null,
  ligadas: boolean,
  publico: PublicoNoFormulario,
): string {
  const quem = paraQuem(publico);
  if (!ligadas) {
    return `As notificações desta loja ainda não estão ligadas. A campanha fica na fila e sai assim que a configuração terminar${quem === null ? '' : `, para ${quem}`}. Depois de enviada, não dá para desfazer.`;
  }
  if (alcance === 0) {
    return 'Ninguém instalou o app ainda, então ela não vai chegar a nenhum celular. Se quiser, agende para depois de divulgar o app.';
  }
  if (quem !== null) {
    return `Ela sai em instantes para ${quem}. Quantos recebem depende de quem se encaixa na hora do envio. Depois de enviada, não dá para desfazer.`;
  }
  const quantos =
    alcance === null
      ? 'todos os aparelhos com o app'
      : alcance === 1
        ? 'o único aparelho com o app'
        : `os ${alcance.toLocaleString('pt-BR')} aparelhos com o app`;
  return `Ela sai em instantes para ${quantos}. Depois de enviada, não dá para desfazer.`;
}

type CampoDeTexto = 'title' | 'body';

export function FormularioDaCampanha({
  nomeDoApp,
  urlDaLoja,
  fuso,
  nomeDoFuso,
  aparelhos,
  alcance,
  notificacoesLigadas,
  iniciais,
  rotuloDoEnvio,
  aoEnviar,
  aoSalvarRascunho,
  rotuloDoRascunho = 'Salvar como rascunho',
}: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresIniciais>(iniciais);
  const [problemas, setProblemas] = useState<ProblemaNoFormulario[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, iniciar] = useTransition();
  // Com a imagem subindo, salvar gravaria a campanha sem ela.
  const [imagemSubindo, setImagemSubindo] = useState(false);
  const ocupado = enviando || imagemSubindo;

  const titulo = useRef<HTMLInputElement>(null);
  const corpo = useRef<HTMLTextAreaElement>(null);
  /*
   * Onde o cursor estava em cada campo. O emoji entra ali — e num campo que
   * nunca recebeu o cursor, no fim do texto, e não no começo.
   */
  const cursores = useRef<Record<CampoDeTexto, { inicio: number; fim: number } | null>>({
    title: null,
    body: null,
  });

  const erroDe = (campo: ProblemaNoFormulario['campo']): string | undefined =>
    problemas.find((problema) => problema.campo === campo)?.mensagem;

  function trocar<C extends keyof ValoresIniciais>(campo: C, valor: ValoresIniciais[C]) {
    setValores((anteriores) => ({ ...anteriores, [campo]: valor }));
    // O erro some assim que o campo muda: manter o aviso embaixo de um campo
    // já corrigido faz o lojista procurar problema onde não há mais.
    setProblemas((anteriores) => anteriores.filter((problema) => problema.campo !== campo));
  }

  function lembrarCursor(campo: CampoDeTexto, elemento: HTMLInputElement | HTMLTextAreaElement) {
    cursores.current[campo] = {
      inicio: elemento.selectionStart ?? elemento.value.length,
      fim: elemento.selectionEnd ?? elemento.value.length,
    };
  }

  function inserirEmoji(campo: CampoDeTexto, emoji: string) {
    const atual = valores[campo];
    const cursor = cursores.current[campo] ?? { inicio: atual.length, fim: atual.length };
    const novo = atual.slice(0, cursor.inicio) + emoji + atual.slice(cursor.fim);
    const maximo = campo === 'title' ? MAXIMO_DO_TITULO : MAXIMO_DO_CORPO;
    if (novo.length > maximo) {
      toast.error(
        campo === 'title'
          ? 'O título já está no limite de caracteres: o emoji não cabe.'
          : 'A mensagem já está no limite de caracteres: o emoji não cabe.',
      );
      return;
    }

    trocar(campo, novo);
    const posicao = cursor.inicio + emoji.length;
    cursores.current[campo] = { inicio: posicao, fim: posicao };
    // Depois de o React desenhar o texto novo: o cursor volta para logo
    // depois do emoji, e a pessoa continua digitando de onde parou.
    requestAnimationFrame(() => {
      const elemento = campo === 'title' ? titulo.current : corpo.current;
      elemento?.focus();
      elemento?.setSelectionRange(posicao, posicao);
    });
  }

  function enviar(acao: () => Promise<EstadoDoPush>, sucessoPadrao: string) {
    iniciar(async () => {
      const resultado = await acao();

      if (resultado.problemas !== undefined && resultado.problemas.length > 0) {
        setProblemas(resultado.problemas);
        toast.error('Confira os campos destacados.');
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível concluir.');
        return;
      }

      toast.success(resultado.mensagem ?? sucessoPadrao);
      router.push('/push');
      router.refresh();
    });
  }

  /**
   * Confere aqui o que dá para conferir aqui — as mesmas regras do servidor,
   * que confere de novo. Sem isto, a confirmação de "enviar agora" abriria
   * para uma campanha sem título, e o erro só apareceria DEPOIS de a pessoa
   * confirmar o envio.
   */
  function conferir(): boolean {
    const analise = validarCampanha(
      {
        title: valores.title,
        body: valores.body,
        deepLink: valores.deepLink,
        agendarPara: valores.agendarPara,
        enviarAgora: valores.enviarAgora,
      },
      { urlDaLoja, agoraMs: Date.now(), fuso },
    );
    const publico = lerPublico(valores.publico.tipo, valores.publico.dias);
    if (analise.ok && publico.ok) return true;
    setProblemas([
      ...(analise.ok ? [] : analise.problemas),
      ...(publico.ok ? [] : [{ campo: 'publico' as const, mensagem: publico.mensagem }]),
    ]);
    toast.error('Confira os campos destacados.');
    return false;
  }

  const paraTodos = valores.publico.tipo === 'todos';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="space-y-5"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (!conferir()) return;
          if (valores.enviarAgora) {
            setConfirmando(true);
            return;
          }
          enviar(() => aoEnviar(paraOEnvio(valores)), 'Campanha agendada.');
        }}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="title">Título</Label>
            <div className="flex items-center gap-1">
              <SeletorDeEmoji
                rotulo="Inserir emoji no título"
                aoEscolher={(emoji) => {
                  inserirEmoji('title', emoji);
                }}
              />
              <span className="text-muted-foreground text-xs tabular-nums">
                {valores.title.length}/{MAXIMO_DO_TITULO}
              </span>
            </div>
          </div>
          <Input
            ref={titulo}
            id="title"
            value={valores.title}
            maxLength={MAXIMO_DO_TITULO}
            onChange={(evento) => {
              trocar('title', evento.target.value);
            }}
            onSelect={(evento) => {
              lembrarCursor('title', evento.currentTarget);
            }}
            aria-invalid={erroDe('title') !== undefined}
            aria-describedby={erroDe('title') === undefined ? undefined : 'erro-title'}
            placeholder="Promoção de inverno"
          />
          {erroDe('title') === undefined ? null : (
            <p id="erro-title" className="text-destructive text-sm">
              {erroDe('title')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="body">Mensagem</Label>
            <div className="flex items-center gap-1">
              <SeletorDeEmoji
                rotulo="Inserir emoji na mensagem"
                aoEscolher={(emoji) => {
                  inserirEmoji('body', emoji);
                }}
              />
              <span className="text-muted-foreground text-xs tabular-nums">
                {valores.body.length}/{MAXIMO_DO_CORPO}
              </span>
            </div>
          </div>
          <Textarea
            ref={corpo}
            id="body"
            rows={3}
            value={valores.body}
            maxLength={MAXIMO_DO_CORPO}
            onChange={(evento) => {
              trocar('body', evento.target.value);
            }}
            onSelect={(evento) => {
              lembrarCursor('body', evento.currentTarget);
            }}
            aria-invalid={erroDe('body') !== undefined}
            aria-describedby={erroDe('body') === undefined ? undefined : 'erro-body'}
            placeholder="Até 40% OFF em peças selecionadas. Só até domingo."
          />
          {erroDe('body') === undefined ? null : (
            <p id="erro-body" className="text-destructive text-sm">
              {erroDe('body')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="deepLink">Abrir em (opcional)</Label>
          <Input
            id="deepLink"
            value={valores.deepLink}
            onChange={(evento) => {
              trocar('deepLink', evento.target.value);
            }}
            aria-invalid={erroDe('deepLink') !== undefined}
            aria-describedby="ajuda-deepLink"
            placeholder="/colecoes/inverno"
          />
          <p id="ajuda-deepLink" className="text-muted-foreground text-xs">
            {erroDe('deepLink') ?? (
              <>
                O caminho da página que o toque abre, dentro de {urlDaLoja}. Deixe vazio para abrir
                o app na tela inicial.
              </>
            )}
          </p>

          {/*
            O campo acima continua livre: quem já sabe o caminho não deve ser
            obrigado a procurar na lista, e há link legítimo que não é produto
            nem coleção — uma landing de campanha, por exemplo.
          */}
          <SeletorDoCatalogo
            aoEscolher={(caminho) => {
              trocar('deepLink', caminho);
            }}
          />
        </div>

        <CampoDaImagem
          imagem={valores.imagem}
          aoMudar={(imagem) => {
            trocar('imagem', imagem);
          }}
          aoSubir={setImagemSubindo}
          erro={erroDe('imagem')}
        />

        <CampoDoPublico
          valor={valores.publico}
          aoMudar={(publico) => {
            trocar('publico', publico);
          }}
          erro={erroDe('publico')}
        />

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Quando enviar</legend>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="quando"
              checked={valores.enviarAgora}
              onChange={() => {
                trocar('enviarAgora', true);
              }}
              className="size-4"
            />
            Agora
          </label>

          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="radio"
              name="quando"
              checked={!valores.enviarAgora}
              onChange={() => {
                trocar('enviarAgora', false);
              }}
              className="size-4"
            />
            Agendar para
            {/*
              Sem `disabled`: um campo apagado ao lado de um rádio desmarcado
              parece quebrado, e o lojista fica clicando nele sem entender. Tocar
              no campo JÁ escolhe "agendar" — é o que ele quis dizer ao clicar.
            */}
            <Input
              type="datetime-local"
              value={valores.agendarPara}
              onFocus={() => {
                if (valores.enviarAgora) trocar('enviarAgora', false);
              }}
              onChange={(evento) => {
                setValores((anteriores) => ({
                  ...anteriores,
                  agendarPara: evento.target.value,
                  enviarAgora: false,
                }));
                setProblemas((anteriores) =>
                  anteriores.filter((problema) => problema.campo !== 'agendarPara'),
                );
              }}
              aria-label="Data e hora do envio"
              aria-invalid={erroDe('agendarPara') !== undefined}
              aria-describedby={
                erroDe('agendarPara') === undefined
                  ? 'fuso-do-envio'
                  : 'fuso-do-envio erro-agendarPara'
              }
              className="w-auto"
            />
            <span id="fuso-do-envio" className="text-muted-foreground text-xs">
              {nomeDoFuso}
            </span>
          </label>
          {erroDe('agendarPara') === undefined ? null : (
            <p id="erro-agendarPara" className="text-destructive text-sm">
              {erroDe('agendarPara')}
            </p>
          )}
        </fieldset>

        <EnvioDeTeste
          aparelhos={aparelhos}
          valores={{
            title: valores.title,
            body: valores.body,
            deepLink: valores.deepLink,
            imagem: valores.imagem?.caminho ?? null,
          }}
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={ocupado}>
            {enviando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {valores.enviarAgora ? rotuloDoEnvio.agora : rotuloDoEnvio.agendado}
          </Button>

          {aoSalvarRascunho === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={ocupado}
              onClick={() => {
                const publico = lerPublico(valores.publico.tipo, valores.publico.dias);
                if (!publico.ok) {
                  setProblemas([{ campo: 'publico', mensagem: publico.mensagem }]);
                  toast.error('Confira os campos destacados.');
                  return;
                }
                enviar(
                  () =>
                    aoSalvarRascunho({
                      title: valores.title,
                      body: valores.body,
                      deepLink: valores.deepLink,
                      imagem: valores.imagem?.caminho ?? null,
                      publico: valores.publico,
                    }),
                  'Rascunho salvo.',
                );
              }}
            >
              {rotuloDoRascunho}
            </Button>
          )}

          <Button asChild variant="ghost" disabled={enviando}>
            <Link href="/push">Cancelar</Link>
          </Button>
        </div>
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <PreviaDaNotificacao
          nomeDoApp={nomeDoApp}
          title={valores.title}
          body={valores.body}
          imagem={valores.imagem?.url ?? null}
        />
      </aside>

      <AlertDialog
        open={confirmando}
        onOpenChange={(aberto) => {
          if (!enviando) setConfirmando(aberto);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paraTodos ? 'Enviar agora para todos?' : 'Enviar agora para este público?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {descricaoDoEnvio(alcance, notificacoesLigadas, valores.publico)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={enviando}
              onClick={(evento) => {
                // O diálogo fica aberto, com o botão girando, até a resposta:
                // fechar antes deixaria a pessoa sem saber se foi.
                evento.preventDefault();
                enviar(async () => {
                  const resultado = await aoEnviar(paraOEnvio(valores));
                  setConfirmando(false);
                  return resultado;
                }, 'Campanha na fila de envio.');
              }}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Enviar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
