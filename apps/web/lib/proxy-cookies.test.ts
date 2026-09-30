/**
 * Os cookies da sessão atravessam toda resposta do proxy.
 *
 * O Supabase escreve os cookies na resposta de `NextResponse.next()` quando
 * renova o token (ou apaga a sessão morta). Uma resposta NOVA — o redirect
 * para o login, o "já está logado", o 403 da visita — que não os carregasse
 * deixava o navegador com o refresh token velho, que o Supabase já trocou: o
 * reuso dele, passado o intervalo de tolerância, derruba a sessão inteira.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextResponse } from 'next/server';

vi.mock('@/lib/env', () => ({
  supabaseConfigurado: true,
  env: { hostAdmin: '', hostCliente: '' },
}));

/** O que o Supabase "escreve" nesta rodada, e quem ele devolve como usuário. */
let usuario: { id: string } | null = null;
let escrever: (resposta: NextResponse) => void = () => undefined;

vi.mock('@/lib/supabase/middleware', () => ({
  carregarUsuario: (_pedido: NextRequest, resposta: NextResponse) => {
    escrever(resposta);
    return Promise.resolve(usuario);
  },
}));

const { proxy } = await import('@/proxy');

const TOKEN = 'sb-projeto-auth-token';

function pedir(
  caminho: string,
  extra: ConstructorParameters<typeof NextRequest>[1] = {},
): Promise<NextResponse> {
  return proxy(new NextRequest(`http://app.localhost:3000${caminho}`, extra));
}

/** O que o `Set-Cookie` da resposta diz sobre o cookie da sessão. */
function cookieDaSessao(resposta: NextResponse) {
  return resposta.cookies.get(TOKEN);
}

beforeEach(() => {
  usuario = null;
  escrever = () => undefined;
});

describe('proxy: os cookies da sessão', () => {
  it('o token renovado vai junto no "já está logado, vá para o painel"', async () => {
    usuario = { id: 'pessoa' };
    escrever = (resposta) => {
      resposta.cookies.set(TOKEN, 'token-renovado', { path: '/' });
    };
    const resposta = await pedir('/entrar');
    expect(resposta.status).toBe(307);
    expect(resposta.headers.get('location')).toBe('http://app.localhost:3000/');
    expect(cookieDaSessao(resposta)?.value).toBe('token-renovado');
  });

  it('a sessão morta sai apagada no redirect para o login', async () => {
    escrever = (resposta) => {
      resposta.cookies.set(TOKEN, '', { path: '/', maxAge: 0 });
    };
    const resposta = await pedir('/lojas', { headers: { cookie: `${TOKEN}=velho` } });
    expect(resposta.status).toBe(307);
    expect(resposta.headers.get('location')).toContain('/entrar?aviso=sessao-encerrada');
    expect(cookieDaSessao(resposta)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('também na ação do servidor, que recebe o redirect sem corpo', async () => {
    escrever = (resposta) => {
      resposta.cookies.set(TOKEN, '', { path: '/', maxAge: 0 });
    };
    const resposta = await pedir('/app', {
      method: 'POST',
      headers: { 'next-action': 'abc', cookie: `${TOKEN}=velho` },
    });
    expect(resposta.headers.get('x-action-redirect')).toContain('/entrar?aviso=sessao-encerrada');
    expect(cookieDaSessao(resposta)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('e no login do admin', async () => {
    escrever = (resposta) => {
      resposta.cookies.set(TOKEN, '', { path: '/', maxAge: 0 });
    };
    const resposta = await pedir('/admin/lojas', { headers: { cookie: `${TOKEN}=velho` } });
    expect(resposta.headers.get('location')).toContain('/admin/entrar');
    expect(cookieDaSessao(resposta)).toMatchObject({ value: '', maxAge: 0 });
  });
});
