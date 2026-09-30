/**
 * O erro que é o CLIENTE indo embora, e não o servidor falhando: a pessoa
 * trocou de página, fechou a aba ou perdeu o sinal com a resposta ainda a
 * caminho. O Next conta isso como erro da renderização ("The destination
 * stream closed early."), e o Node, ao ler o corpo do pedido, como
 * "aborted" com `ECONNRESET`.
 *
 * Em produção acontece o tempo todo — num celular em movimento, a toda hora.
 * Tratado como falha, cada um virava um alerta no Sentry: a cota e a atenção
 * iam para o que não é defeito, e o defeito de verdade se perdia no meio.
 *
 * De propósito estreito: um `ECONNRESET` de uma chamada NOSSA a outro serviço
 * (a Shopify, a Asaas) chega como "fetch failed", e continua sendo erro.
 */
export function clienteDesistiu(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  if (erro.message === 'The destination stream closed early.') return true;
  return erro.message === 'aborted' && (erro as { code?: unknown }).code === 'ECONNRESET';
}
