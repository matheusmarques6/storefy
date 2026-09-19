import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emailConfigurado,
  enviarEmail,
  escaparHtml,
  lerRespostaDaResend,
  remetente,
} from '@/lib/email';

let chaveOriginal: string | undefined;
let remetenteOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.RESEND_API_KEY;
  remetenteOriginal = process.env.EMAIL_REMETENTE;
  process.env.RESEND_API_KEY = 'chave-de-teste';
  process.env.EMAIL_REMETENTE = 'Storefy <avisos@storefy.com.br>';
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = chaveOriginal;
  if (remetenteOriginal === undefined) delete process.env.EMAIL_REMETENTE;
  else process.env.EMAIL_REMETENTE = remetenteOriginal;
});

const MENSAGEM = {
  para: ['dona@loja.com.br'],
  assunto: 'Oi',
  texto: 'Corpo',
  html: '<p>Corpo</p>',
};

describe('emailConfigurado e remetente', () => {
  it('só está configurado com chave E remetente', () => {
    expect(emailConfigurado()).toBe(true);

    delete process.env.EMAIL_REMETENTE;
    expect(emailConfigurado()).toBe(false);
    expect(remetente()).toBeNull();

    process.env.EMAIL_REMETENTE = '   ';
    expect(emailConfigurado()).toBe(false);

    process.env.EMAIL_REMETENTE = 'Storefy <a@b.com>';
    delete process.env.RESEND_API_KEY;
    expect(emailConfigurado()).toBe(false);
  });
});

describe('enviarEmail', () => {
  it('manda para a Resend no formato dela', async () => {
    let url = '';
    let corpo: Record<string, unknown> = {};
    let auth = '';

    const falso: typeof fetch = (entrada, init) => {
      url = entrada instanceof Request ? entrada.url : entrada.toString();
      auth = new Headers(init?.headers).get('Authorization') ?? '';
      const texto = typeof init?.body === 'string' ? init.body : '{}';
      corpo = JSON.parse(texto) as Record<string, unknown>;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    expect(await enviarEmail(MENSAGEM, falso)).toEqual({ ok: true });
    expect(url).toBe('https://api.resend.com/emails');
    expect(auth).toBe('Bearer chave-de-teste');
    expect(corpo).toEqual({
      from: 'Storefy <avisos@storefy.com.br>',
      to: ['dona@loja.com.br'],
      subject: 'Oi',
      text: 'Corpo',
      html: '<p>Corpo</p>',
    });
  });

  /*
   * O mesmo e-mail duas vezes na lista viraria duas cópias na caixa de quem
   * é owner e admin ao mesmo tempo — o que acontece em toda organização de
   * uma pessoa só.
   */
  it('não manda duas vezes para o mesmo endereço', async () => {
    let corpo: { to?: string[] } = {};
    const falso: typeof fetch = (_e, init) => {
      const texto = typeof init?.body === 'string' ? init.body : '{}';
      corpo = JSON.parse(texto) as { to?: string[] };
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    await enviarEmail(
      { ...MENSAGEM, para: ['Dona@Loja.com.br', 'dona@loja.com.br ', '', '  '] },
      falso,
    );
    expect(corpo.to).toEqual(['dona@loja.com.br']);
  });

  it('sem ninguém para avisar, recusa sem chamar a Resend', async () => {
    const naoDeveria: typeof fetch = () => {
      throw new Error('não deveria chamar a Resend');
    };

    const r = await enviarEmail({ ...MENSAGEM, para: [] }, naoDeveria);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.passageiro).toBe(false);
  });

  /*
   * Sem chave, o aviso conta como PASSAGEIRO: quando a variável for
   * preenchida, o próximo ciclo manda. Marcar permanente descartaria para
   * sempre um aviso por causa de configuração que ainda vai chegar.
   */
  it('sem configuração, recusa como passageiro e não chama ninguém', async () => {
    const naoDeveria: typeof fetch = () => {
      throw new Error('não deveria chamar a Resend');
    };

    const semChave = () => {
      delete process.env.RESEND_API_KEY;
    };
    const semRemetente = () => {
      delete process.env.EMAIL_REMETENTE;
    };

    for (const apagar of [semChave, semRemetente]) {
      process.env.RESEND_API_KEY = 'chave-de-teste';
      process.env.EMAIL_REMETENTE = 'Storefy <a@b.com>';
      apagar();

      const r = await enviarEmail(MENSAGEM, naoDeveria);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.passageiro).toBe(true);
    }
  });

  it('rede fora do ar vira falha passageira', async () => {
    const r = await enviarEmail(MENSAGEM, () => Promise.reject(new Error('sem rede')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.passageiro).toBe(true);
  });
});

describe('lerRespostaDaResend', () => {
  it('2xx é sucesso', () => {
    for (const status of [200, 201, 202]) {
      expect(lerRespostaDaResend(status)).toEqual({ ok: true });
    }
  });

  /*
   * A distinção decide se o aviso volta para a fila. Chave errada (401) e
   * domínio não verificado (403) não melhoram sozinhos; limite de taxa e queda
   * deles melhoram.
   */
  it('separa o que melhora sozinho do que não melhora', () => {
    for (const status of [429, 500, 502, 503]) {
      const r = lerRespostaDaResend(status);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.passageiro).toBe(true);
    }

    for (const status of [400, 401, 403, 404, 422]) {
      const r = lerRespostaDaResend(status);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.passageiro).toBe(false);
    }
  });
});

/*
 * O nome da loja vem do lojista e entra no HTML do e-mail. Sem escapar, um
 * nome com `<` quebraria o layout do e-mail de todo mundo daquela organização
 * — cliente de e-mail não é navegador, mas continua interpretando marcação.
 */
describe('escaparHtml', () => {
  it('escapa o que quebra marcação', () => {
    expect(escaparHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(escaparHtml("Loja do Zé & Cia 'boa'")).toBe('Loja do Zé &amp; Cia &#39;boa&#39;');
  });

  it('texto comum passa inteiro', () => {
    expect(escaparHtml('Loja da Ana — Roupas')).toBe('Loja da Ana — Roupas');
  });
});
