/**
 * O `onRequestError` do `instrumentation.ts`: o erro de verdade vai para o
 * log e o Sentry; o cliente que foi embora no meio da resposta, só para o log.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const relatarErro = vi.fn(() => Promise.resolve(true));
vi.mock('@/lib/sentry', () => ({ relatarErro }));

const { onRequestError } = await import('../instrumentation');

type Pedido = Parameters<typeof onRequestError>[1];
type Contexto = Parameters<typeof onRequestError>[2];

const PEDIDO = { path: '/convite/um-token?x=1', method: 'GET', headers: {} } as Pedido;
const CONTEXTO = {
  routerKind: 'App Router',
  routePath: '/convite/[token]',
  routeType: 'render',
  renderSource: 'react-server-components',
  revalidateReason: undefined,
} as Contexto;

let saidas: string[] = [];

beforeEach(() => {
  relatarErro.mockClear();
  saidas = [];
  for (const metodo of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, metodo).mockImplementation((linha: string) => {
      saidas.push(linha);
    });
  }
});

describe('onRequestError', () => {
  it('o erro do servidor vai para o log como erro e para o Sentry, sem a query', async () => {
    await onRequestError(new Error('quebrou'), PEDIDO, CONTEXTO);
    expect(relatarErro).toHaveBeenCalledOnce();
    const linha = JSON.parse(saidas[0] ?? '{}') as Record<string, unknown>;
    expect(linha).toMatchObject({
      nivel: 'erro',
      evento: 'requisicao.falhou',
      caminho: '/convite/um-token',
    });
  });

  it('o cliente que foi embora no meio da resposta não vira alarme', async () => {
    await onRequestError(new Error('The destination stream closed early.'), PEDIDO, CONTEXTO);
    expect(relatarErro).not.toHaveBeenCalled();
    const linha = JSON.parse(saidas[0] ?? '{}') as Record<string, unknown>;
    expect(linha).toMatchObject({ nivel: 'info', evento: 'requisicao.interrompida' });
  });
});
