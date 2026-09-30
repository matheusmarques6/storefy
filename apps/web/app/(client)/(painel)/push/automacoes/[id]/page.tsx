/**
 * Detalhe de uma automação (C10): o funil do período — enviadas, aberturas e
 * pedidos — e o que não saiu, com o porquê.
 *
 * A automação não tem "antes e depois do envio" como a campanha: ela envia
 * todo dia. Por isso o detalhe é de um período (7, 30 ou 90 dias, na URL).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  appContaAberturas,
  appDaLoja,
  buscarAutomacao,
  desfechosDaAutomacao,
  resultadoDasAutomacoes,
} from '@/lib/push-servidor';
import { DESCRICAO_DO_TIPO, resumoDaAutomacaoLigada } from '@/lib/automacao';
import { descreverDesfechos } from '@/lib/desfechos-da-automacao';
import { funilDaAutomacao, vendasVisiveis } from '@/lib/vendas-do-push';
import { lerPeriodo } from '@/lib/analytics';
import { ehUuid } from '@/lib/app-config-publica';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SeletorDePeriodo } from '../../../analytics/periodo';
import { FunilDaCampanha } from '../../[id]/funil';
import { PreviaDaNotificacao } from '../../previa-da-notificacao';

export const metadata: Metadata = { title: 'Automação' };

export default async function PaginaDaAutomacao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const [{ id }, { periodo }] = await Promise.all([params, searchParams]);
  const dias = lerPeriodo(periodo);
  const { lojaAtiva, papel } = await exigirContextoCliente();
  // Um id que não é id nem chega ao banco; o de outra loja volta vazio pela RLS.
  if (lojaAtiva == null || !ehUuid(id)) notFound();

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) notFound();

  const automacao = await buscarAutomacao(supabase, app.id, id);
  if (automacao == null) notFound();

  const [resultados, contaAberturas, desfechos] = await Promise.all([
    resultadoDasAutomacoes(supabase, app.id, dias),
    appContaAberturas(supabase, app.id),
    desfechosDaAutomacao(supabase, automacao.id, dias),
  ]);
  const resultado = resultados.get(automacao.id) ?? {
    envios: 0,
    aberturas: 0,
    pedidos: 0,
    receitaCents: 0,
  };
  const comVendas = vendasVisiveis(lojaAtiva);
  const podeEscrever = papel === 'owner' || papel === 'admin';
  const descricao = DESCRICAO_DO_TIPO[automacao.type];
  const naoSairam = descreverDesfechos(desfechos, automacao.enabled);
  const nadaNoPeriodo = resultado.envios === 0 && naoSairam.length === 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/push/automacoes"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Automações
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{descricao.nome}</h1>
          <Badge variant={automacao.enabled ? 'success' : 'outline'}>
            {automacao.enabled ? 'Ligada' : 'Desligada'}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {automacao.enabled
            ? resumoDaAutomacaoLigada(automacao.type, automacao.delayMinutes)
            : descricao.gatilho}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          O que a automação fez nos últimos {dias} dias.
        </p>
        <SeletorDePeriodo atual={dias} base={`/push/automacoes/${automacao.id}`} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {nadaNoPeriodo ? (
            <p
              className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm"
              data-testid="automacao-sem-envios"
            >
              {automacao.enabled
                ? `Nenhum envio nos últimos ${String(dias)} dias. Os números aparecem quando a automação disparar pela primeira vez.`
                : `A automação está desligada e não enviou nada nos últimos ${String(dias)} dias. Ligue em Automações para ela voltar a trabalhar.`}
            </p>
          ) : (
            <>
              <FunilDaCampanha
                de="automacao"
                etapas={funilDaAutomacao(resultado, contaAberturas, comVendas)}
                vendas={resultado}
                vendasVisiveis={comVendas}
                podeConectar={podeEscrever}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">O que não saiu</CardTitle>
                  <CardDescription>
                    Envios do período que foram cancelados, falharam ou ainda esperam a hora — e o
                    porquê.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {naoSairam.length === 0 ? (
                    <p className="text-sm">Tudo o que chegou a hora de sair, saiu.</p>
                  ) : (
                    <ul className="divide-y" aria-label="Envios que não saíram">
                      {naoSairam.map((linha) => (
                        <li
                          key={linha.texto}
                          className="flex items-baseline justify-between gap-4 py-2 text-sm"
                        >
                          <span
                            className={cn(
                              linha.tom === 'atencao' && 'text-amber-700 dark:text-amber-400',
                            )}
                          >
                            {linha.texto}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {linha.quantos.toLocaleString('pt-BR')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Mensagem</dt>
              <dd className="break-words">{automacao.body}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Abre em</dt>
              <dd className="break-words">{automacao.deepLink ?? 'Tela inicial do app'}</dd>
            </div>
          </dl>

          {podeEscrever ? (
            <Button asChild variant="outline">
              <Link href="/push/automacoes">Editar mensagem ou desligar</Link>
            </Button>
          ) : null}
        </div>

        <aside>
          <PreviaDaNotificacao
            nomeDoApp={lojaAtiva.name}
            title={automacao.title}
            body={automacao.body}
            imagem={null}
          />
        </aside>
      </div>
    </div>
  );
}
