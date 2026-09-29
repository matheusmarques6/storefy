import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { segredoTemFormato } from './convites';
import {
  criarOuReenviarConvite,
  entregarConvite,
  gerarSegredo,
  hashDoSegredo,
  mensagemDaEntrega,
  nomeDeQuemConvida,
} from './convites-servidor';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('o segredo do link', () => {
  it('tem o formato que a tela aceita, e nunca se repete', () => {
    const segredos = new Set(Array.from({ length: 200 }, () => gerarSegredo()));
    expect(segredos.size).toBe(200);
    for (const segredo of segredos) expect(segredoTemFormato(segredo)).toBe(true);
  });

  it('o hash é o mesmo que o banco calcula: encode(digest(segredo, sha256), hex)', () => {
    // Vetor conhecido do SHA-256 (FIPS 180-2).
    expect(hashDoSegredo('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashDoSegredo(gerarSegredo())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('quem convida, no e-mail', () => {
  it('pelo nome; sem nome, pelo e-mail', () => {
    expect(nomeDeQuemConvida({ email: 'a@b.com', user_metadata: { full_name: ' Ana ' } })).toBe(
      'Ana',
    );
    expect(nomeDeQuemConvida({ email: 'a@b.com', user_metadata: {} })).toBe('a@b.com');
    expect(nomeDeQuemConvida({ user_metadata: { full_name: 3 } })).toBe('Alguém da equipe');
  });
});

describe('a entrega', () => {
  it('sem a Resend configurada, diz que NÃO mandou e devolve o link', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_REMETENTE', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.storefy.com.br');
    const buscador = vi.fn();
    vi.stubGlobal('fetch', buscador);

    const entrega = await entregarConvite('ana@loja.com.br', 'segredo', {
      tipo: 'conta',
      convidadoPor: 'Bia',
    });
    expect(entrega).toEqual({
      link: 'https://app.storefy.com.br/convite/segredo',
      enviadoPorEmail: false,
    });
    expect(buscador).not.toHaveBeenCalled();
  });

  it('com a Resend, manda; se ela recusar, diz que não mandou', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_teste');
    vi.stubEnv('EMAIL_REMETENTE', 'Storefy <oi@storefy.com.br>');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.storefy.com.br');

    const aceitou = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', aceitou);
    const ok = await entregarConvite('ana@loja.com.br', 's', {
      tipo: 'conta',
      convidadoPor: 'Bia',
    });
    expect(ok.enviadoPorEmail).toBe(true);
    expect(aceitou).toHaveBeenCalledOnce();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 403 }))),
    );
    const recusado = await entregarConvite('ana@loja.com.br', 's', {
      tipo: 'conta',
      convidadoPor: 'Bia',
    });
    expect(recusado.enviadoPorEmail).toBe(false);
  });

  it('a mensagem nunca diz "enviado" quando não foi', () => {
    const naoFoi = { link: 'l', enviadoPorEmail: false };
    expect(mensagemDaEntrega('a@b.com', naoFoi, false)).toContain('não foi enviado');
    expect(mensagemDaEntrega('a@b.com', naoFoi, true)).toContain('não foi enviado');
    expect(mensagemDaEntrega('a@b.com', { link: 'l', enviadoPorEmail: true }, true)).toContain(
      'deixou de valer',
    );
  });
});

/**
 * Um cliente falso do Supabase só com o que `criarOuReenviarConvite` usa: a
 * consulta do convite em aberto, o insert e o update. Cada chamada fica
 * gravada para o teste conferir o que foi pedido.
 */
function clienteFalso(respostas: {
  emAberto: (string | null)[];
  insert?: { data: { id: string } | null; error: { code: string; message: string } | null };
  update?: { data: { id: string } | null; error: { message: string } | null };
}) {
  const chamadas: { tipo: string; valores?: unknown }[] = [];
  const filaDeAberto = [...respostas.emAberto];

  const consulta = () => {
    const encadeado = {
      eq: () => encadeado,
      is: () => encadeado,
      maybeSingle: () => {
        chamadas.push({ tipo: 'consulta' });
        const id = filaDeAberto.shift() ?? null;
        return Promise.resolve({ data: id === null ? null : { id }, error: null });
      },
    };
    return encadeado;
  };

  const cliente = {
    from: () => ({
      select: () => consulta(),
      insert: (valores: unknown) => {
        chamadas.push({ tipo: 'insert', valores });
        return {
          select: () => ({
            single: () =>
              Promise.resolve(respostas.insert ?? { data: { id: 'novo' }, error: null }),
          }),
        };
      },
      update: (valores: unknown) => {
        chamadas.push({ tipo: 'update', valores });
        const encadeado = {
          eq: () => encadeado,
          select: () => ({
            maybeSingle: () =>
              Promise.resolve(respostas.update ?? { data: { id: 'existente' }, error: null }),
          }),
        };
        return encadeado;
      },
    }),
  };

  return { cliente: cliente as unknown as SupabaseClient<Database>, chamadas };
}

describe('criar ou reenviar', () => {
  const agora = new Date('2026-09-29T12:00:00Z');

  it('sem convite em aberto, cria — com o hash, nunca o segredo', async () => {
    const { cliente, chamadas } = clienteFalso({ emAberto: [null] });
    const gravado = await criarOuReenviarConvite(
      cliente,
      { tipo: 'organizacao', email: 'ana@loja.com.br', orgId: 'org-1', papel: 'admin' },
      'autor',
      agora,
    );
    expect(gravado.ok && !gravado.reenviado).toBe(true);
    if (!gravado.ok) return;

    const insert = chamadas.find((chamada) => chamada.tipo === 'insert')?.valores as Record<
      string,
      unknown
    >;
    expect(insert.token_hash).toBe(hashDoSegredo(gravado.segredo));
    expect(JSON.stringify(insert)).not.toContain(gravado.segredo);
    expect(insert).toMatchObject({
      kind: 'organizacao',
      org_id: 'org-1',
      org_role: 'admin',
      platform_role: null,
      invited_by: 'autor',
      expires_at: '2026-10-06T12:00:00.000Z',
    });
  });

  it('com convite em aberto, reenvia o MESMO: segredo e prazo novos, link antigo morre', async () => {
    const { cliente, chamadas } = clienteFalso({ emAberto: ['existente'] });
    const gravado = await criarOuReenviarConvite(
      cliente,
      { tipo: 'equipe', email: 'bia@storefy.com', papelNaPlataforma: 'superadmin' },
      'autor',
      agora,
    );
    expect(gravado.ok && gravado.reenviado).toBe(true);
    expect(chamadas.some((chamada) => chamada.tipo === 'insert')).toBe(false);
    const update = chamadas.find((chamada) => chamada.tipo === 'update')?.valores;
    expect(update).toMatchObject({ platform_role: 'superadmin', org_role: null });
  });

  it('dois cliques ao mesmo tempo: o segundo vira reenvio, e não erro', async () => {
    const { cliente } = clienteFalso({
      emAberto: [null, 'criado-pelo-outro-clique'],
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
    });
    const gravado = await criarOuReenviarConvite(
      cliente,
      { tipo: 'conta', email: 'ana@loja.com.br' },
      'autor',
      agora,
    );
    expect(gravado.ok && gravado.reenviado).toBe(true);
  });

  it('a RLS recusou em silêncio (nenhuma linha): diz que não conseguiu', async () => {
    const { cliente } = clienteFalso({
      emAberto: ['existente'],
      update: { data: null, error: null },
    });
    const gravado = await criarOuReenviarConvite(
      cliente,
      { tipo: 'conta', email: 'ana@loja.com.br' },
      'autor',
      agora,
    );
    expect(gravado.ok).toBe(false);
  });
});
