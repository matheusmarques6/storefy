import { describe, expect, it } from 'vitest';
import {
  descreverCelular,
  esquemaDoApp,
  haQuanto,
  lerFragmento,
  linkDoApp,
  linkDoQr,
  pareadoDepoisDe,
  type CelularDeTeste,
} from '@/lib/celular-de-teste';
import { slugDoProjeto } from '@/lib/build-interno';

const LOJA = '8f2c1a3e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const AGORA = Date.parse('2026-09-30T12:00:00Z');

function celular(extra: Partial<CelularDeTeste> = {}): CelularDeTeste {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    nome: 'Celular da Ana',
    platform: 'ios',
    appVersion: '1.2.0',
    lastSeenAt: '2026-09-30T11:58:00Z',
    recebePush: true,
    pareadoEm: '2026-09-30T11:00:00Z',
    ...extra,
  };
}

describe('o link do QR', () => {
  /* O app só reconhece o próprio esquema: se os dois se separarem, o botão não abre nada. */
  it('abre o app pelo MESMO esquema que o build grava nele', () => {
    expect(esquemaDoApp(LOJA)).toBe(slugDoProjeto(LOJA));
    expect(linkDoApp(LOJA, 'ABCD2345')).toBe(`storefy-${LOJA}://celular-de-teste?codigo=ABCD2345`);
  });

  it('vai para a página pública, com a loja e o código no fragmento', () => {
    const link = linkDoQr('https://storefy.convertfy.me/', LOJA, 'ABCD2345');
    expect(link).toBe(`https://storefy.convertfy.me/celular-de-teste#loja=${LOJA}&codigo=ABCD2345`);
    // O fragmento nunca vai ao servidor: o código não fica em log de acesso.
    expect(new URL(link).search).toBe('');
    expect(lerFragmento(new URL(link).hash)).toEqual({ storeId: LOJA, codigo: 'ABCD2345' });
  });

  it('a página aceita o código digitado em minúsculas e a loja em maiúsculas', () => {
    expect(lerFragmento(`#loja=${LOJA.toUpperCase()}&codigo=abcd2345`)).toEqual({
      storeId: LOJA,
      codigo: 'ABCD2345',
    });
  });

  /* Sem a conferência, a página seria um trampolim para abrir qualquer esquema. */
  it('recusa fragmento incompleto, código fora do formato e loja que não é id', () => {
    for (const fragmento of [
      '',
      '#',
      `#loja=${LOJA}`,
      '#codigo=ABCD2345',
      `#loja=${LOJA}&codigo=ABCD0123`,
      `#loja=${LOJA}&codigo=ABCD234`,
      '#loja=javascript:alert(1)&codigo=ABCD2345',
      `#loja=${LOJA}x&codigo=ABCD2345`,
    ]) {
      expect(lerFragmento(fragmento), fragmento).toBeNull();
    }
  });
});

describe('o celular na lista', () => {
  it('diz o sistema, a versão e quando foi visto', () => {
    expect(descreverCelular(celular(), AGORA)).toBe('iPhone · versão 1.2.0 · visto há 2 min');
    expect(descreverCelular(celular({ platform: 'android', appVersion: null }), AGORA)).toBe(
      'Android · visto há 2 min',
    );
  });

  it('conta o tempo como gente conta', () => {
    expect(haQuanto('2026-09-30T11:59:40Z', AGORA)).toBe('agora');
    expect(haQuanto('2026-09-30T09:00:00Z', AGORA)).toBe('há 3 h');
    expect(haQuanto('2026-09-29T10:00:00Z', AGORA)).toBe('ontem');
    expect(haQuanto('2026-09-25T10:00:00Z', AGORA)).toBe('há 5 dias');
    expect(haQuanto('não é data', AGORA)).toBe('em algum momento');
  });
});

describe('o QR deu certo?', () => {
  const GERADO = '2026-09-30T11:50:00Z';

  it('é o celular pareado depois de o código nascer — novo ou pareado de novo', () => {
    const antigo = celular({ id: 'a', pareadoEm: '2026-09-30T10:00:00Z' });
    const novo = celular({ id: 'b', pareadoEm: '2026-09-30T11:51:00Z' });
    expect(pareadoDepoisDe([novo, antigo], GERADO)).toBe(novo);
    expect(pareadoDepoisDe([antigo], GERADO)).toBeNull();
    expect(pareadoDepoisDe([], GERADO)).toBeNull();
  });

  it('sem saber quando o código nasceu, não afirma nada', () => {
    expect(pareadoDepoisDe([celular()], 'não é data')).toBeNull();
  });
});
