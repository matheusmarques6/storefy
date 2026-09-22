/**
 * A URL pública da aplicação.
 *
 * Ela é o endereço de retorno do OAuth da Shopify, a URL dos webhooks e o
 * destino dos links de confirmação de e-mail. Um valor sem esquema passa
 * despercebido no painel da Vercel — é assim que ela mostra o domínio — e
 * quebra os três de jeitos diferentes:
 *
 *   a Shopify recusa o OAuth com "The redirect_uri is not whitelisted", sem
 *   dizer que o problema é a falta do `https://`;
 *
 *   o registro de webhook é recusado tópico a tópico, e a loja fica conectada
 *   sem receber nada — o erro mais silencioso dos três;
 *
 *   o link de confirmação de e-mail vira um caminho relativo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { urlDoSite } from '@/lib/env';

let siteOriginal: string | undefined;
let vercelOriginal: string | undefined;

beforeEach(() => {
  siteOriginal = process.env.NEXT_PUBLIC_SITE_URL;
  vercelOriginal = process.env.VERCEL_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  if (siteOriginal === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteOriginal;
  if (vercelOriginal === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = vercelOriginal;
});

describe('urlDoSite', () => {
  /*
   * O CASO QUE QUEBROU DE VERDADE: a Vercel mostra o domínio sem esquema, e
   * colar exatamente o que está lá é o caminho natural.
   */
  it('põe https no domínio colado sem esquema', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'storefy-eight.vercel.app';

    expect(urlDoSite()).toBe('https://storefy-eight.vercel.app');
    expect(`${urlDoSite()}/api/shopify/callback`).toBe(
      'https://storefy-eight.vercel.app/api/shopify/callback',
    );
  });

  it('não mexe em quem já veio completo', () => {
    for (const url of ['https://app.storefy.com.br', 'http://exemplo.test']) {
      process.env.NEXT_PUBLIC_SITE_URL = url;
      expect(urlDoSite()).toBe(url);
    }
  });

  it('tira a barra do fim, com ou sem esquema', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.storefy.com.br/';
    expect(urlDoSite()).toBe('https://app.storefy.com.br');

    process.env.NEXT_PUBLIC_SITE_URL = 'storefy-eight.vercel.app//';
    expect(urlDoSite()).toBe('https://storefy-eight.vercel.app');
  });

  it('espaço em volta não vira parte da URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '  storefy-eight.vercel.app  ';
    expect(urlDoSite()).toBe('https://storefy-eight.vercel.app');
  });

  /*
   * Forçar https no ambiente local quebraria o login de quem está
   * desenvolvendo, que é onde isto mais roda.
   */
  it('localhost fica em http', () => {
    for (const host of ['localhost:3000', 'app.localhost:3000', '127.0.0.1:3000']) {
      process.env.NEXT_PUBLIC_SITE_URL = host;
      expect(urlDoSite(), host).toBe(`http://${host}`);
    }
  });

  it('em branco cai no VERCEL_URL, que também vem sem esquema', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '   ';
    process.env.VERCEL_URL = 'storefy-abc123.vercel.app';

    expect(urlDoSite()).toBe('https://storefy-abc123.vercel.app');
  });

  it('sem nada configurado, o padrão local continua valendo', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(urlDoSite()).toBe('http://app.localhost:3000');
  });

  /* O que todo mundo que usa isto faz: montar uma URL absoluta. */
  it('o resultado é sempre uma URL absoluta', () => {
    for (const valor of [
      'storefy-eight.vercel.app',
      'https://app.storefy.com.br/',
      '  exemplo.com  ',
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = valor;
      expect(() => new URL(`${urlDoSite()}/api/webhooks/shopify`), valor).not.toThrow();
    }
  });
});
