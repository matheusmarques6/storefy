import { describe, expect, it } from 'vitest';
import { PADRAO_DO_MATCHER } from '@/proxy';

/**
 * O matcher do proxy decide o que passa pela guarda de sessão.
 *
 * Capturar `api/` foi um bug real: o proxy redireciona quem não tem
 * sessão para `/entrar`, e um webhook do EAS receberia um 307 para a página de
 * login em vez de ser processado. Estes testes fixam o comportamento.
 */
// Guarda de sanidade: a constante é derivada de `config.matcher[0]`, e um
// padrão vazio faria as asserções de "não intercepta" passarem à toa.
if (PADRAO_DO_MATCHER === '') throw new Error('PADRAO_DO_MATCHER veio vazio');

const matcher = new RegExp(`^${PADRAO_DO_MATCHER}$`);

function intercepta(caminho: string): boolean {
  return matcher.test(caminho);
}

describe('matcher do proxy', () => {
  it('intercepta as telas do painel do cliente', () => {
    for (const caminho of ['/', '/lojas', '/lojas/nova', '/configuracoes/conta', '/entrar']) {
      expect(intercepta(caminho), caminho).toBe(true);
    }
  });

  it('intercepta as telas do painel admin', () => {
    for (const caminho of ['/admin', '/admin/lojas', '/admin/logs', '/admin/entrar']) {
      expect(intercepta(caminho), caminho).toBe(true);
    }
  });

  it('NÃO intercepta rotas de API', () => {
    // Webhooks, crons e o endpoint que o app mobile consome. Nenhum deles pode
    // receber um redirecionamento para a tela de login.
    for (const caminho of [
      '/api/health',
      '/api/public/app-config/abc-123',
      '/api/public/devices',
      '/api/webhooks/eas',
      '/api/webhooks/shopify',
      '/api/jobs/dispatch-push',
    ]) {
      expect(intercepta(caminho), caminho).toBe(false);
    }
  });

  it('NÃO intercepta o callback do auth', () => {
    // Precisa rodar sem interferência para trocar o código pela sessão.
    expect(intercepta('/auth/callback')).toBe(false);
    expect(intercepta('/auth/confirmar')).toBe(false);
  });

  it('NÃO intercepta arquivos estáticos', () => {
    for (const caminho of [
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
      '/logo.svg',
      '/icone.png',
      '/foto.jpeg',
      '/animacao.webp',
    ]) {
      expect(intercepta(caminho), caminho).toBe(false);
    }
  });

  it('intercepta uma rota cujo nome apenas começa parecido com api', () => {
    // `/apizinha` não é rota de API: a exclusão tem que ser do segmento.
    expect(intercepta('/apizinha')).toBe(true);
  });
});
