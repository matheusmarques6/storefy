/**
 * O funil do C10: enviados → entregues → aberturas → pedidos na campanha, e
 * enviadas → aberturas → pedidos na automação — e a receita no fim.
 *
 * Cada barra é a fração do topo, e cada etapa diz quanto da anterior chegou
 * até ela. Etapa sem número fica com traço e sem barra: o funil nunca desenha
 * um zero que não aconteceu (regra 1 do CLAUDE.md).
 */
import Link from 'next/link';
import { comoReais } from '@/lib/analytics';
import { porcentagemOuTraco, numeroOuTraco } from '@/lib/campanha';
import {
  MOTIVO_SEM_VENDAS,
  textoDosPedidos,
  ticketMedio,
  type EtapaDoFunil,
  type Vendas,
} from '@/lib/vendas-do-push';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function FunilDaCampanha({
  etapas,
  vendas,
  vendasVisiveis,
  podeConectar,
  de = 'campanha',
}: {
  etapas: readonly EtapaDoFunil[];
  /** `undefined` antes do envio. */
  vendas: Vendas | undefined;
  vendasVisiveis: boolean;
  /** Quem pode conectar a Shopify vê o atalho; os outros, só o motivo. */
  podeConectar: boolean;
  /** A automação tem período, e não "antes e depois do envio". */
  de?: 'campanha' | 'automacao';
}) {
  const ticket = vendas === undefined ? null : ticketMedio(vendas);
  const nenhumPedido =
    de === 'campanha'
      ? 'Nenhum pedido veio desta notificação até agora.'
      : 'Nenhum pedido veio desta automação no período.';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Do envio à venda</CardTitle>
        <CardDescription>
          Cada etapa mostra quantas pessoas chegaram até ali e quanto da etapa anterior isso
          representa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol
          className="space-y-4"
          aria-label={de === 'campanha' ? 'Funil da campanha' : 'Funil da automação'}
        >
          {etapas.map((etapa) => (
            <li key={etapa.chave} className="space-y-1.5" data-etapa={etapa.chave}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="text-sm font-medium">{etapa.rotulo}</span>
                <span className="text-sm tabular-nums">
                  <span className="font-semibold" data-testid={`funil-${etapa.chave}`}>
                    {numeroOuTraco(etapa.valor)}
                  </span>
                  {etapa.taxa === null ? null : (
                    <span className="text-muted-foreground">
                      {' '}
                      · {porcentagemOuTraco(etapa.taxa)} da etapa anterior
                    </span>
                  )}
                </span>
              </div>
              <div
                className="bg-muted h-2 overflow-hidden rounded-full"
                role="presentation"
                aria-hidden
              >
                {etapa.largura === null ? null : (
                  <div
                    className="bg-primary h-full rounded-full"
                    // Um pedido em dez mil ainda aparece: a barra de 0,01% sumiria.
                    style={{
                      width: `${String(etapa.largura === 0 ? 0 : Math.max(etapa.largura * 100, 1))}%`,
                    }}
                  />
                )}
              </div>
              <p className="text-muted-foreground text-xs">{etapa.explicacao}</p>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border p-4" data-testid={`receita-da-${de}`}>
          <p className="text-muted-foreground text-xs">Receita</p>
          {vendasVisiveis ? (
            vendas === undefined ? (
              <p className="text-sm">A receita aparece depois que a campanha for enviada.</p>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums">
                  {comoReais(vendas.receitaCents)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {vendas.pedidos === 0
                    ? `${nenhumPedido} Um pedido conta se a compra acontece até 3 dias depois do toque.`
                    : `${textoDosPedidos(vendas.pedidos)}${ticket === null ? '' : `, ticket médio de ${comoReais(ticket)}`}. Conta a compra feita até 3 dias depois do toque.`}
                </p>
              </>
            )
          ) : (
            <>
              <p className="text-2xl font-semibold tabular-nums">—</p>
              <p className="text-muted-foreground text-xs">
                {MOTIVO_SEM_VENDAS}{' '}
                {podeConectar ? (
                  <Link href="/integracoes" className="text-foreground underline">
                    Conectar a Shopify
                  </Link>
                ) : null}
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
