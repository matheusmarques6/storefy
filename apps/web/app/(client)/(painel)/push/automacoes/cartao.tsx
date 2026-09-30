'use client';

/**
 * O card de uma automação (C09).
 *
 * Liga e desliga direto no card, e abre o editor de mensagem quando o lojista
 * quer mexer no texto. Ligar é a ação mais comum de longe, e enterrá-la dentro
 * de um formulário faria a automação que mais traz venda ficar desligada.
 */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  opcoesDeAtraso,
  resumoDaAutomacaoLigada,
  DESCRICAO_DO_TIPO,
  type TipoDeAutomacao,
} from '@/lib/automacao';
import { comoReais } from '@/lib/analytics';
import {
  MAXIMO_DO_CORPO,
  MAXIMO_DO_TITULO,
  numeroOuTraco,
  porcentagemOuTraco,
  type ProblemaNoFormulario,
} from '@/lib/campanha';
import type { AutomacaoSalva, ChaveDoWebhook, ResultadoDaAutomacao } from '@/lib/push-servidor';
import {
  AVISO_DAS_ABERTURAS,
  JANELA_DAS_VENDAS_EM_DIAS,
  MOTIVO_SEM_VENDAS,
} from '@/lib/vendas-do-push';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PreviaDaNotificacao } from '../previa-da-notificacao';
import { salvarAutomacao } from '../acoes';
import { SecaoDoWebhook } from './webhook';

interface Props {
  tipo: TipoDeAutomacao;
  salva: AutomacaoSalva | null;
  urlDaLoja: string;
  nomeDoApp: string;
  podeEscrever: boolean;
  fuso: string;
  /** Envios, aberturas, pedidos e receita nos últimos 30 dias. `null` sem linha no banco. */
  resultado: ResultadoDaAutomacao | null;
  /** O app da loja já conta os toques? Antes disso, as aberturas são traço. */
  contaAberturas: boolean;
  /** A loja manda os pedidos (Shopify conectada)? Sem isso, pedido e receita são traço. */
  vendasVisiveis: boolean;
  /** Só no card do webhook: o endereço que a ferramenta chama e a chave em uso. */
  webhook?: { endereco: string; chave: ChaveDoWebhook | null };
}

export function CartaoDaAutomacao({
  tipo,
  salva,
  urlDaLoja,
  nomeDoApp,
  podeEscrever,
  fuso,
  resultado,
  contaAberturas,
  vendasVisiveis,
  webhook,
}: Props) {
  const descricao = DESCRICAO_DO_TIPO[tipo];
  const router = useRouter();

  const [aberto, setAberto] = useState(false);
  const [enviando, iniciar] = useTransition();
  const [problemas, setProblemas] = useState<ProblemaNoFormulario[]>([]);

  /*
   * Sem linha no banco, o formulário abre com a sugestão do tipo — texto de
   * partida para o lojista editar. Nada disso vira dado antes de ele salvar:
   * a automação só existe quando ele decide que existe.
   */
  const [valores, setValores] = useState({
    title: salva?.title ?? descricao.sugestao.title,
    body: salva?.body ?? descricao.sugestao.body,
    deepLink: salva?.deepLink ?? '',
    delayMinutes: salva?.delayMinutes ?? descricao.sugestao.delayMinutes,
  });

  const ligada = salva?.enabled ?? false;
  const erroDe = (campo: ProblemaNoFormulario['campo']): string | undefined =>
    problemas.find((problema) => problema.campo === campo)?.mensagem;

  function salvar(enabled: boolean, fechar: boolean) {
    iniciar(async () => {
      const resultado = await salvarAutomacao({ tipo, ...valores, enabled });

      if (resultado.problemas !== undefined && resultado.problemas.length > 0) {
        setProblemas(resultado.problemas);
        toast.error('Confira os campos destacados.');
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível salvar.');
        return;
      }

      setProblemas([]);
      if (fechar) setAberto(false);
      toast.success(resultado.mensagem ?? 'Pronto.');
      router.refresh();
    });
  }

  return (
    <Card role="region" aria-labelledby={`automacao-${tipo}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle id={`automacao-${tipo}`} className="text-base">
            {descricao.nome}
          </CardTitle>
          <CardDescription>{descricao.gatilho}</CardDescription>
          <p className="text-muted-foreground text-xs">
            {/* O resumo é do que está SALVO: o que está sendo editado ainda não vale. */}
            {ligada && salva !== null
              ? resumoDaAutomacaoLigada(tipo, salva.delayMinutes)
              : descricao.porque}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {enviando ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
          ) : null}
          <Switch
            checked={ligada}
            disabled={!podeEscrever || enviando}
            aria-label={`${ligada ? 'Desligar' : 'Ligar'} ${descricao.nome}`}
            onCheckedChange={(marcado) => {
              salvar(marcado, false);
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {salva === null ? null : (
          <ResultadoNaJanela
            automacaoId={salva.id}
            resultado={resultado}
            contaAberturas={contaAberturas}
            vendasVisiveis={vendasVisiveis}
            tipo={tipo}
          />
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!podeEscrever}
          onClick={() => {
            setAberto((anterior) => !anterior);
          }}
          aria-expanded={aberto}
        >
          {aberto ? 'Fechar' : 'Editar mensagem'}
        </Button>

        {aberto ? (
          <div className="grid gap-6 border-t pt-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              {webhook === undefined ? null : (
                <p className="text-muted-foreground text-sm">
                  Este texto vai quando a sua ferramenta não manda o dela no chamado.
                </p>
              )}
              <div className="space-y-2">
                <Label htmlFor={`titulo-${tipo}`}>Título</Label>
                <Input
                  id={`titulo-${tipo}`}
                  value={valores.title}
                  maxLength={MAXIMO_DO_TITULO}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, title: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'title'));
                  }}
                  aria-invalid={erroDe('title') !== undefined}
                />
                {erroDe('title') === undefined ? null : (
                  <p className="text-destructive text-sm">{erroDe('title')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`corpo-${tipo}`}>Mensagem</Label>
                <Textarea
                  id={`corpo-${tipo}`}
                  rows={3}
                  value={valores.body}
                  maxLength={MAXIMO_DO_CORPO}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, body: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'body'));
                  }}
                  aria-invalid={erroDe('body') !== undefined}
                />
                {erroDe('body') === undefined ? null : (
                  <p className="text-destructive text-sm">{erroDe('body')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`link-${tipo}`}>Abrir em (opcional)</Label>
                <Input
                  id={`link-${tipo}`}
                  value={valores.deepLink}
                  placeholder={tipo === 'abandoned_cart' ? '/cart' : '/colecoes/novidades'}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, deepLink: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'deepLink'));
                  }}
                  aria-invalid={erroDe('deepLink') !== undefined}
                />
                <p className="text-muted-foreground text-xs">
                  {erroDe('deepLink') ?? `Uma página de ${urlDaLoja}. Vazio abre a tela inicial.`}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`atraso-${tipo}`}>{descricao.rotuloDoAtraso}</Label>
                <select
                  id={`atraso-${tipo}`}
                  value={String(valores.delayMinutes)}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, delayMinutes: Number(evento.target.value) }));
                  }}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {opcoesDeAtraso(tipo).map((opcao) => (
                    <option key={opcao.minutos} value={opcao.minutos}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-xs">
                  Entre 22h e 8h o envio espera até as 8h, no horário da sua loja. Ninguém gosta de
                  ser acordado por uma promoção.
                </p>
              </div>

              <Button
                type="button"
                disabled={enviando}
                onClick={() => {
                  salvar(ligada, true);
                }}
              >
                {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Salvar mensagem
              </Button>
            </div>

            <PreviaDaNotificacao nomeDoApp={nomeDoApp} title={valores.title} body={valores.body} />
          </div>
        ) : null}

        {webhook === undefined ? null : (
          <SecaoDoWebhook
            endereco={webhook.endereco}
            chave={webhook.chave}
            ligada={ligada}
            fuso={fuso}
            podeEscrever={podeEscrever}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * O que a automação fez nos últimos 30 dias (C09): quantas notificações
 * saíram, quantas abriram e o que venderam — e o caminho para o detalhe (C10).
 *
 * Só aparece para automação que existe no banco — sugestão nunca salva não
 * tem histórico, e zeros ali afirmariam um desempenho que não existiu.
 */
function ResultadoNaJanela({
  automacaoId,
  resultado,
  contaAberturas,
  vendasVisiveis,
  tipo,
}: {
  automacaoId: string;
  resultado: ResultadoDaAutomacao | null;
  contaAberturas: boolean;
  vendasVisiveis: boolean;
  tipo: TipoDeAutomacao;
}) {
  const vendas = vendasVisiveis && resultado !== null;
  const aberturas = contaAberturas && resultado !== null ? resultado.aberturas : null;
  const taxa =
    aberturas !== null && resultado !== null && resultado.envios > 0
      ? aberturas / resultado.envios
      : null;
  return (
    <section aria-labelledby={`resultado-${tipo}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`resultado-${tipo}`} className="text-muted-foreground text-xs font-medium">
          Últimos {JANELA_DAS_VENDAS_EM_DIAS} dias
        </h3>
        <Link
          href={`/push/automacoes/${automacaoId}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs font-medium"
        >
          Ver detalhes
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">Enviadas</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {numeroOuTraco(resultado?.envios ?? null)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Aberturas</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {numeroOuTraco(aberturas)}
            {taxa === null ? null : (
              <span className="text-muted-foreground font-normal">
                {' '}
                · {porcentagemOuTraco(taxa)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Pedidos</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {vendas ? numeroOuTraco(resultado.pedidos) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Receita</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {vendas ? comoReais(resultado.receitaCents) : '—'}
          </dd>
        </div>
      </dl>
      <p className="text-muted-foreground text-xs">
        {vendasVisiveis
          ? 'Conta a compra feita até 3 dias depois de o cliente tocar na notificação.'
          : MOTIVO_SEM_VENDAS}
        {contaAberturas ? null : ` Aberturas: ${AVISO_DAS_ABERTURAS.toLowerCase()}`}
      </p>
    </section>
  );
}
