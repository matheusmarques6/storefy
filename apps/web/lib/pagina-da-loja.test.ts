import { describe, expect, it, vi } from 'vitest';
import { descobrirTema } from '@/lib/pagina-da-loja';

const LOJA = new URL('https://oakvintage.com.br/');

/** Um fetch que responde a página inicial da loja com o HTML dado. */
function paginaCom(html: string, status = 200) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    ),
  ) as unknown as typeof fetch;
}

describe('descobrirTema', () => {
  it('lê o tema original na página inicial da loja', async () => {
    const html =
      '<script>Shopify.theme = {"name":"Tema de Natal","schema_name":"Prestige","role":"main"};</script>';
    expect(await descobrirTema(LOJA, paginaCom(html))).toEqual({ ok: true, tema: 'Prestige' });
  });

  it('página sem tema: diz onde o lojista acha o nome, em vez de chutar', async () => {
    const resultado = await descobrirTema(LOJA, paginaCom('<html><body>oi</body></html>'));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('Loja virtual › Temas');
  });

  it('a loja fora do ar ou respondendo erro: o motivo da leitura', async () => {
    const semRede = vi.fn(() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const foraDoAr = await descobrirTema(LOJA, semRede);
    expect(foraDoAr).toEqual({
      ok: false,
      motivo: 'Não conseguimos acessar a loja agora. Confira se o site está no ar e tente de novo.',
    });

    const comErro = await descobrirTema(LOJA, paginaCom('erro', 503));
    expect(comErro.ok).toBe(false);
    if (!comErro.ok) expect(comErro.motivo).toContain('503');
  });

  /* A busca é a pública: endereço interno não é consultado. */
  it('endereço interno não é buscado', async () => {
    const buscador = vi.fn() as unknown as typeof fetch;
    const resultado = await descobrirTema(new URL('http://127.0.0.1/'), buscador);
    expect(resultado.ok).toBe(false);
    expect(buscador).not.toHaveBeenCalled();
  });
});
