/**
 * O que roda no navegador antes do painel ficar interativo (Fase 8).
 *
 * Erro que escapa de tudo — um `throw` num evento, uma promessa sem `catch` —
 * vai para `/api/erros`, que repassa ao Sentry. O que cai nas telas de erro do
 * React é relatado por elas (`components/estado-de-erro.tsx`).
 */
import { relatarNoNavegador } from '@/lib/erros-do-navegador';

try {
  window.addEventListener('error', (evento) => {
    relatarNoNavegador(evento.error ?? evento.message, 'janela', window.location.pathname);
  });
  window.addEventListener('unhandledrejection', (evento) => {
    relatarNoNavegador(evento.reason, 'promessa', window.location.pathname);
  });
} catch {
  // Sem os ouvintes, o painel funciona igual; só não relata.
}
