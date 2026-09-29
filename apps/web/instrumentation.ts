/**
 * Erros do servidor (Fase 8).
 *
 * O Next chama `onRequestError` para todo erro que ele captura: numa página
 * de servidor, numa rota de API, numa Server Action, no proxy. Cada um vira
 * uma linha no log estruturado e, com `SENTRY_DSN`, um alerta no Sentry.
 *
 * Só o CAMINHO vai, sem a query: um convite leva o token na URL, e um token
 * num alerta é um token vazado.
 */
import type { Instrumentation } from 'next';
import { log } from '@/lib/log';
import { relatarErro } from '@/lib/sentry';

export const onRequestError: Instrumentation.onRequestError = async (erro, pedido, contexto) => {
  const caminho = pedido.path.split('?', 1)[0] ?? '/';
  log.erro('requisicao.falhou', {
    erro,
    caminho,
    metodo: pedido.method,
    rota: contexto.routePath,
    tipo: contexto.routeType,
  });
  await relatarErro({
    erro,
    origem: 'servidor',
    marcas: { rota: contexto.routePath, tipo: contexto.routeType, metodo: pedido.method },
    extras: { caminho },
  });
};
