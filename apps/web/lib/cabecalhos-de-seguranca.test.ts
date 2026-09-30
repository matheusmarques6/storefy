/**
 * Os cabeçalhos de segurança como o Next os recebe (`next.config.ts`). O
 * e2e `cabecalhos.spec.ts` confere o que chega de verdade ao navegador.
 */
import { describe, expect, it } from 'vitest';
import configuracao from '../next.config';
import { CABECALHOS_DE_SEGURANCA, CAMINHOS_COM_CABECALHOS } from '@/lib/cabecalhos-de-seguranca';

/** O `source` como o Next o lê: âncora no começo e no fim do caminho. */
const caminho = new RegExp(`^${CAMINHOS_COM_CABECALHOS}$`);

describe('cabeçalhos de segurança', () => {
  it('o next.config entrega os cabeçalhos em todo caminho, menos na prévia da loja', async () => {
    const regras = (await configuracao.headers?.()) ?? [];
    expect(regras).toEqual([
      { source: CAMINHOS_COM_CABECALHOS, headers: [...CABECALHOS_DE_SEGURANCA] },
    ]);

    for (const dentro of ['/', '/app', '/admin', '/entrar', '/privacy/x', '/api/health']) {
      expect(caminho.test(dentro), dentro).toBe(true);
    }
    expect(caminho.test('/api/preview-proxy')).toBe(false);
  });

  it('ninguém de fora enquadra o painel, e a página não aceita outro <base>', () => {
    const valor = (chave: string) =>
      CABECALHOS_DE_SEGURANCA.find((cabecalho) => cabecalho.key === chave)?.value;
    const politica = valor('Content-Security-Policy') ?? '';
    expect(politica).toContain("frame-ancestors 'self'");
    expect(politica).toContain("base-uri 'self'");
    expect(politica).toContain("object-src 'none'");
    // Uma política de script aqui travaria o painel: o Next precisa de nonce.
    expect(politica).not.toMatch(/script-src|default-src/);
    expect(valor('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(valor('X-Content-Type-Options')).toBe('nosniff');
  });
});
