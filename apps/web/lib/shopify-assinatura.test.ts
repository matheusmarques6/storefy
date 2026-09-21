import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { conferirHmacDaQuery, conferirHmacDoWebhook } from '@/lib/shopify-assinatura';

const SEGREDO = 'segredo-do-app-shopify';

describe('conferirHmacDaQuery', () => {
  /** A mensagem é a query ordenada, sem o `hmac`, com `&` entre os pares. */
  function assinar(pares: Record<string, string>): URLSearchParams {
    const ordenados = Object.entries(pares)
      .map(([chave, valor]) => `${chave}=${valor}`)
      .sort()
      .join('&');
    const hmac = createHmac('sha256', SEGREDO).update(ordenados).digest('hex');
    return new URLSearchParams({ ...pares, hmac });
  }

  it('aceita a query que a Shopify assinou', () => {
    const q = assinar({
      code: 'abc',
      shop: 'minha-loja.myshopify.com',
      state: 'n',
      timestamp: '1',
    });
    expect(conferirHmacDaQuery(q, SEGREDO)).toBe(true);
  });

  /*
   * A Shopify acrescenta parâmetro sem avisar. Se a conferência só olhasse uma
   * lista fixa, um parâmetro novo faria toda conexão falhar — e o sintoma
   * seria "a Shopify parou de funcionar".
   */
  it('parâmetro novo da Shopify não quebra a conferência', () => {
    const q = assinar({ code: 'abc', shop: 'x.myshopify.com', host: 'base64', inventado: '1' });
    expect(conferirHmacDaQuery(q, SEGREDO)).toBe(true);
  });

  it('recusa quando qualquer valor muda', () => {
    const q = assinar({ code: 'abc', shop: 'minha-loja.myshopify.com' });
    q.set('code', 'outro');
    expect(conferirHmacDaQuery(q, SEGREDO)).toBe(false);
  });

  it('recusa assinatura de outro segredo e query sem hmac', () => {
    const q = assinar({ code: 'abc' });
    expect(conferirHmacDaQuery(q, 'outro-segredo')).toBe(false);

    q.delete('hmac');
    expect(conferirHmacDaQuery(q, SEGREDO)).toBe(false);
  });

  /*
   * Sem `SHOPIFY_API_SECRET` configurado, quem souber disso assina a query com
   * a chave VAZIA e passa. É a falha inteira: a conferência precisa recusar
   * porque não há segredo, e não porque a conta não bateu.
   */
  it('sem segredo configurado, nem uma assinatura feita com chave vazia passa', () => {
    const pares = 'code=abc&shop=x.myshopify.com';
    const comChaveVazia = createHmac('sha256', '').update(pares).digest('hex');
    const q = new URLSearchParams({
      code: 'abc',
      shop: 'x.myshopify.com',
      hmac: comChaveVazia,
    });

    expect(conferirHmacDaQuery(q, '')).toBe(false);
  });

  /** `signature` é do app proxy e não entra na conta, como o `hmac`. */
  it('ignora o parâmetro signature', () => {
    const q = assinar({ code: 'abc', shop: 'x.myshopify.com' });
    q.set('signature', 'qualquer');
    expect(conferirHmacDaQuery(q, SEGREDO)).toBe(true);
  });
});

describe('conferirHmacDoWebhook', () => {
  const corpo = JSON.stringify({ id: 1, email: 'cliente@loja.com' });
  const assinatura = createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('base64');

  it('aceita o corpo que a Shopify assinou', () => {
    expect(conferirHmacDoWebhook(assinatura, SEGREDO, corpo)).toBe(true);
  });

  /*
   * A assinatura do webhook é BASE64, e a do OAuth é hex. Trocar uma pela
   * outra é o erro clássico, e ele passa despercebido até o primeiro webhook
   * de verdade chegar.
   */
  it('não aceita a mesma assinatura em hex', () => {
    const hex = createHmac('sha256', SEGREDO).update(corpo, 'utf8').digest('hex');
    expect(conferirHmacDoWebhook(hex, SEGREDO, corpo)).toBe(false);
  });

  it('recusa quando o corpo muda, mesmo com o mesmo JSON', () => {
    const reescrito = JSON.stringify(JSON.parse(corpo), null, 2);
    expect(JSON.parse(reescrito)).toEqual(JSON.parse(corpo));
    expect(conferirHmacDoWebhook(assinatura, SEGREDO, reescrito)).toBe(false);
  });

  it('recusa sem cabeçalho, sem segredo e com segredo errado', () => {
    expect(conferirHmacDoWebhook(null, SEGREDO, corpo)).toBe(false);
    expect(conferirHmacDoWebhook('  ', SEGREDO, corpo)).toBe(false);
    expect(conferirHmacDoWebhook(assinatura, '', corpo)).toBe(false);
    expect(conferirHmacDoWebhook(assinatura, 'outro', corpo)).toBe(false);
  });

  it('acento no corpo não muda a conta', () => {
    const comAcento = JSON.stringify({ nome: 'Ação & Coração' });
    const assinado = createHmac('sha256', SEGREDO).update(comAcento, 'utf8').digest('base64');
    expect(conferirHmacDoWebhook(assinado, SEGREDO, comAcento)).toBe(true);
  });
});
