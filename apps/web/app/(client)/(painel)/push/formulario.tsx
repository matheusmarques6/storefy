'use client';

/**
 * O formulário da campanha (C08), usado para criar e para editar.
 *
 * A prévia fica ao lado e acompanha a digitação: o lojista escreve num campo
 * largo de navegador e a mensagem chega numa tira estreita de tela bloqueada,
 * e não há como consertar depois de enviar.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { MAXIMO_DO_CORPO, MAXIMO_DO_TITULO, type ProblemaNoFormulario } from '@/lib/campanha';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PreviaDaNotificacao } from './previa-da-notificacao';
import { EnvioDeTeste } from './envio-de-teste';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import type { EstadoDoPush } from './acoes';
import { SeletorDoCatalogo } from './catalogo/seletor';

export interface ValoresIniciais {
  title: string;
  body: string;
  deepLink: string;
  agendarPara: string;
  enviarAgora: boolean;
}

interface Props {
  nomeDoApp: string;
  urlDaLoja: string;
  /** Aparelhos para o envio de teste. */
  aparelhos: readonly AparelhoParaTeste[];
  iniciais: ValoresIniciais;
  /** Texto do botão principal. */
  rotuloDoEnvio: string;
  aoEnviar: (valores: ValoresIniciais) => Promise<EstadoDoPush>;
  /** Só na criação: salvar sem enviar. */
  aoSalvarRascunho?: (
    valores: Omit<ValoresIniciais, 'agendarPara' | 'enviarAgora'>,
  ) => Promise<EstadoDoPush>;
}

export function FormularioDaCampanha({
  nomeDoApp,
  urlDaLoja,
  aparelhos,
  iniciais,
  rotuloDoEnvio,
  aoEnviar,
  aoSalvarRascunho,
}: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresIniciais>(iniciais);
  const [problemas, setProblemas] = useState<ProblemaNoFormulario[]>([]);
  const [enviando, iniciar] = useTransition();

  const erroDe = (campo: ProblemaNoFormulario['campo']): string | undefined =>
    problemas.find((problema) => problema.campo === campo)?.mensagem;

  function trocar<C extends keyof ValoresIniciais>(campo: C, valor: ValoresIniciais[C]) {
    setValores((anteriores) => ({ ...anteriores, [campo]: valor }));
    // O erro some assim que o campo muda: manter o aviso embaixo de um campo
    // já corrigido faz o lojista procurar problema onde não há mais.
    setProblemas((anteriores) => anteriores.filter((problema) => problema.campo !== campo));
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

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        className="space-y-5"
        onSubmit={(evento) => {
          evento.preventDefault();
          enviar(() => aoEnviar(valores), 'Pronto.');
        }}
      >
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="title">Título</Label>
            <span className="text-muted-foreground text-xs tabular-nums">
              {valores.title.length}/{MAXIMO_DO_TITULO}
            </span>
          </div>
          <Input
            id="title"
            value={valores.title}
            maxLength={MAXIMO_DO_TITULO}
            onChange={(evento) => {
              trocar('title', evento.target.value);
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
          <div className="flex items-baseline justify-between">
            <Label htmlFor="body">Mensagem</Label>
            <span className="text-muted-foreground text-xs tabular-nums">
              {valores.body.length}/{MAXIMO_DO_CORPO}
            </span>
          </div>
          <Textarea
            id="body"
            rows={3}
            value={valores.body}
            maxLength={MAXIMO_DO_CORPO}
            onChange={(evento) => {
              trocar('body', evento.target.value);
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
              className="w-auto"
            />
          </label>
          {erroDe('agendarPara') === undefined ? null : (
            <p className="text-destructive text-sm">{erroDe('agendarPara')}</p>
          )}
        </fieldset>

        <EnvioDeTeste
          aparelhos={aparelhos}
          valores={{ title: valores.title, body: valores.body, deepLink: valores.deepLink }}
        />

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" disabled={enviando}>
            {enviando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            {rotuloDoEnvio}
          </Button>

          {aoSalvarRascunho === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={() => {
                enviar(
                  () =>
                    aoSalvarRascunho({
                      title: valores.title,
                      body: valores.body,
                      deepLink: valores.deepLink,
                    }),
                  'Rascunho salvo.',
                );
              }}
            >
              Salvar como rascunho
            </Button>
          )}

          <Button asChild variant="ghost" disabled={enviando}>
            <Link href="/push">Cancelar</Link>
          </Button>
        </div>
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <PreviaDaNotificacao nomeDoApp={nomeDoApp} title={valores.title} body={valores.body} />
      </aside>
    </div>
  );
}
