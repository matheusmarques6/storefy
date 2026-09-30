/**
 * A04 — a cobrança do cliente, do jeito que o suporte precisa ao telefone: se
 * está em dia e até quando, o plano, as faturas com o link que o cliente
 * recebeu, os últimos avisos da Asaas sobre ele e — para superadmin — o
 * "estender teste".
 */
import { ExternalLink } from 'lucide-react';
import {
  ROTULO_STATUS_ASSINATURA,
  ROTULO_STATUS_FATURA,
  type PlatformAdminRole,
} from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { descreverDocumento, formatarDia, formatarPreco, somarDias } from '@/lib/cobranca';
import { lerSituacaoDaCobranca, lerUsoDaEmpresa } from '@/lib/cobranca-servidor';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { cobrancaConfigurada } from '@/lib/asaas';
import { ConferirNaAsaas } from './conferir-na-asaas';
import { EstenderTeste } from './estender-teste';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function limite(valor: number | null): string {
  return valor === null ? 'sem limite' : valor.toLocaleString('pt-BR');
}

export async function CobrancaDaOrganizacao({
  orgId,
  papel,
}: {
  orgId: string;
  papel: PlatformAdminRole;
}) {
  const supabase = await criarClientServidor();
  const [situacao, uso, faturas, quemPaga, avisos, assinatura] = await Promise.all([
    lerSituacaoDaCobranca(supabase, orgId),
    lerUsoDaEmpresa(supabase, orgId),
    supabase
      .from('invoices')
      .select('id, valor_centavos, status, vencimento, paga_em, link')
      .eq('org_id', orgId)
      .order('vencimento', { ascending: false })
      .limit(12),
    supabase
      .from('billing_customers')
      .select('nome, documento_tipo, documento_final, email, external_id')
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase
      .from('billing_events')
      .select('external_id, tipo, resultado, recebido_em')
      .eq('org_id', orgId)
      .order('recebido_em', { ascending: false })
      .limit(5),
    supabase
      .from('subscriptions')
      .select('conferida_em')
      .eq('org_id', orgId)
      .eq('provider', 'asaas')
      .maybeSingle(),
  ]);
  if (faturas.error != null) {
    throw new Error(`Não foi possível carregar as faturas: ${faturas.error.message}`);
  }
  if (avisos.error != null) {
    throw new Error(`Não foi possível carregar os avisos da Asaas: ${avisos.error.message}`);
  }
  if (assinatura.error != null) {
    throw new Error(`Não foi possível carregar a assinatura: ${assinatura.error.message}`);
  }

  return (
    <Card role="region" aria-labelledby="cobranca-do-cliente">
      <CardHeader>
        <CardTitle id="cobranca-do-cliente" className="flex flex-wrap items-center gap-2 text-base">
          Cobrança
          <Badge variant={situacao.emDia ? 'secondary' : 'destructive'}>
            {/* "Liberado", e não "em dia": com fatura em atraso dentro da
                tolerância o cliente está liberado, mas não está em dia. */}
            {situacao.emDia ? 'Liberado' : 'Travado'}
          </Badge>
        </CardTitle>
        <CardDescription>
          {situacao.liberadoAte === null
            ? 'Nada liberado.'
            : situacao.emDia
              ? `Tudo liberado até ${formatarDia(situacao.liberadoAte)}.`
              : `Liberado até ${formatarDia(situacao.liberadoAte)}: campanhas, publicação, versões e lojas novas estão parados.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Plano</dt>
            <dd className="mt-1 font-medium">
              {situacao.assinatura === null
                ? 'Teste, sem assinatura'
                : `${situacao.planoNome ?? ''} · ${formatarPreco(situacao.valorCentavos ?? 0)}/mês`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assinatura</dt>
            <dd className="mt-1 font-medium">
              {situacao.assinatura === null ? '—' : ROTULO_STATUS_ASSINATURA[situacao.assinatura]}
              {situacao.inadimplenteDesde === null
                ? null
                : ` desde ${formatarDia(situacao.inadimplenteDesde)}`}
              {situacao.canceladaEm === null
                ? null
                : ` em ${formatarDataHora(situacao.canceladaEm, FUSO_PADRAO)}`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Teste até</dt>
            <dd className="mt-1 font-medium">{formatarDia(situacao.testeAte)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pago até</dt>
            <dd className="mt-1 font-medium">
              {situacao.pagoAte === null ? '—' : formatarDia(situacao.pagoAte)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Uso (lojas · aparelhos · campanhas no mês)</dt>
            <dd className="mt-1 font-medium tabular-nums">
              {uso.lojas}/{limite(situacao.limiteLojas)} ·{' '}
              {uso.aparelhos30d.toLocaleString('pt-BR')}/{limite(situacao.limiteAparelhos)} ·{' '}
              {uso.campanhasNoMes}/{limite(situacao.limiteCampanhasMes)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Quem paga</dt>
            <dd className="mt-1 font-medium break-words">
              {quemPaga.data == null ? (
                '—'
              ) : (
                <>
                  {quemPaga.data.nome}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {descreverDocumento(
                      quemPaga.data.documento_tipo,
                      quemPaga.data.documento_final,
                    )}{' '}
                    · {quemPaga.data.email} · Asaas {quemPaga.data.external_id}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>

        {faturas.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma fatura.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>
                  <span className="sr-only">Abrir</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {faturas.data.map((fatura) => (
                <TableRow key={fatura.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatarDia(fatura.vencimento)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatarPreco(fatura.valor_centavos)}
                  </TableCell>
                  <TableCell>
                    {ROTULO_STATUS_FATURA[fatura.status]}
                    {fatura.paga_em === null ? null : ` em ${formatarDia(fatura.paga_em)}`}
                  </TableCell>
                  <TableCell className="text-right">
                    {fatura.link === null ? null : (
                      <a
                        href={fatura.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                      >
                        Abrir
                        <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Últimos avisos da Asaas</p>
          {avisos.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum aviso recebido sobre este cliente.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {avisos.data.map((aviso) => (
                <li key={aviso.external_id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-xs">{aviso.tipo}</span>
                  <span className="text-muted-foreground">
                    {formatarDataHora(aviso.recebido_em, FUSO_PADRAO)} · {aviso.resultado}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          O aviso da Asaas às vezes não chega (ela pausa a fila depois de erros
          seguidos). O job confere de hora em hora; ao telefone com quem pagou e
          continua travado, o suporte confere na hora.
        */}
        {assinatura.data == null ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              {assinatura.data.conferida_em === null
                ? 'Ainda não conferida direto na Asaas.'
                : `Conferida direto na Asaas em ${formatarDataHora(assinatura.data.conferida_em, FUSO_PADRAO)}.`}
            </p>
            {cobrancaConfigurada() ? <ConferirNaAsaas orgId={orgId} /> : null}
          </div>
        )}

        {papel === 'superadmin' ? (
          <EstenderTeste orgId={orgId} hoje={situacao.hoje} maximo={somarDias(situacao.hoje, 90)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
