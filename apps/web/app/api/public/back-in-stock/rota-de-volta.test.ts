/**
 * `POST /api/public/back-in-stock`, de ponta a ponta: a assinatura, o aparelho
 * achado pela inscrição, os dois tetos e o que o app ouve de volta.
 *
 * O Supabase é falso (a rede para `*.supabase.co` não existe neste ambiente);
 * a rota, não. O que a função do banco faz com o pedido está provado no
 * `rls.test.sql`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assinar } from '@/lib/assinatura';
import { criptografar } from '@/lib/cripto';

const CHAVE = Buffer.alloc(32, 7).toString('base64');
const SEGREDO = 'segredo-do-app-de-teste';
const APP = '44444444-4444-4444-8444-444444444444';
const APARELHO = '55555555-5555-4555-8555-555555555555';

/** O que cada chave de `consumir_limite` responde; ausente é "cabe". */
let tetos: Record<string, { data: boolean | null; error: { message: string } | null }> = {};
let aparelhoNoBanco: { id: string } | null = { id: APARELHO };
let gravou: { data: boolean | null; error: { message: string } | null } = {
  data: true,
  error: null,
};
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
let segredoCifrado = '';

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  serviceRoleConfigurada: true,
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    from: (tabela: string) => ({
      select: () => {
        const consulta = {
          eq: () => consulta,
          maybeSingle: () =>
            Promise.resolve(
              tabela === 'apps'
                ? { data: { device_secret_enc: segredoCifrado }, error: null }
                : { data: aparelhoNoBanco, error: null },
            ),
        };
        return consulta;
      },
    }),
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === 'consumir_limite') {
        const chave = String(args.p_chave);
        const prefixo = chave.slice(0, chave.lastIndexOf(':'));
        return Promise.resolve(tetos[prefixo] ?? { data: true, error: null });
      }
      return Promise.resolve(gravou);
    },
  }),
}));

const { POST } = await import('@/app/api/public/back-in-stock/route');

const CORPO = JSON.stringify({
  appId: APP,
  subscriptionId: 'inscricao-1',
  variantId: '4412345',
  path: '/products/jaqueta?variant=4412345',
});

let chaveOriginal: string | undefined;

beforeEach(() => {
  chaveOriginal = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
  segredoCifrado = criptografar(SEGREDO);
  tetos = {};
  aparelhoNoBanco = { id: APARELHO };
  gravou = { data: true, error: null };
  chamadas = [];
  // O motivo da recusa vai para o log de propósito; o teste não precisa vê-lo.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (chaveOriginal === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = chaveOriginal;
});

function pedido(corpo: string, assinatura: string | null = assinar(SEGREDO, Date.now(), corpo)) {
  const cabecalhos = new Headers({ 'Content-Type': 'application/json' });
  if (assinatura !== null) cabecalhos.set('x-storefy-signature', assinatura);
  return new NextRequest('https://app.storefy.com.br/api/public/back-in-stock', {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

describe('POST /api/public/back-in-stock', () => {
  it('grava o pedido do aparelho achado pela inscrição', async () => {
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ novo: true });
    expect(chamadas.find((c) => c.nome === 'inscrever_de_volta')?.args).toEqual({
      p_app_id: APP,
      p_device_id: APARELHO,
      p_variant_id: '4412345',
      p_deep_link: '/products/jaqueta?variant=4412345',
    });
  });

  it('tocar de novo não é erro: o app ouve sucesso, com "novo: false"', async () => {
    gravou = { data: false, error: null };
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(200);
    await expect(resposta.json()).resolves.toEqual({ novo: false });
  });

  it('consome os dois tetos: o do app por minuto e o do aparelho por hora', async () => {
    await POST(pedido(CORPO));

    const tetosPedidos = chamadas.filter((c) => c.nome === 'consumir_limite').map((c) => c.args);
    expect(tetosPedidos).toEqual([
      { p_chave: `de-volta:${APP}`, p_maximo: 600 },
      { p_chave: `de-volta-aparelho:${APARELHO}`, p_maximo: 30, p_janela_segundos: 3600 },
    ]);
  });

  it('acima do teto do app: 429, e nem procura o aparelho', async () => {
    tetos['de-volta'] = { data: false, error: null };
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(429);
    expect(chamadas.map((c) => c.nome)).toEqual(['consumir_limite']);
  });

  it('acima do teto do aparelho: 429, e nada é gravado', async () => {
    tetos['de-volta-aparelho'] = { data: false, error: null };
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(429);
    expect(chamadas.some((c) => c.nome === 'inscrever_de_volta')).toBe(false);
  });

  it('teto fora do ar: 503 em JSON, e nada é gravado', async () => {
    tetos['de-volta'] = { data: null, error: { message: 'conexão caiu' } };
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(503);
    await expect(resposta.json()).resolves.toEqual({ erro: 'indisponivel' });
    expect(chamadas.some((c) => c.nome === 'inscrever_de_volta')).toBe(false);
  });

  /*
   * O app registra de novo e tenta outra vez (`push/sessao.ts`). Por isso é
   * 404, e não 400: o pedido estava certo, o aparelho é que ainda não chegou.
   */
  it('aparelho que o servidor não conhece: 404', async () => {
    aparelhoNoBanco = null;
    const resposta = await POST(pedido(CORPO));

    expect(resposta.status).toBe(404);
    await expect(resposta.json()).resolves.toEqual({ erro: 'aparelho_desconhecido' });
  });

  it('sem assinatura, ou com o corpo trocado: 401, e nada chega ao banco', async () => {
    expect((await POST(pedido(CORPO, null))).status).toBe(401);

    const trocado = CORPO.replace('4412345', '999');
    expect((await POST(pedido(trocado, assinar(SEGREDO, Date.now(), CORPO)))).status).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it('caminho que abriria outro site é recusado', async () => {
    const torto = JSON.stringify({
      appId: APP,
      subscriptionId: 'inscricao-1',
      variantId: '4412345',
      path: '//evil.com',
    });
    const resposta = await POST(pedido(torto));

    expect(resposta.status).toBe(400);
    expect(chamadas).toEqual([]);
  });
});
