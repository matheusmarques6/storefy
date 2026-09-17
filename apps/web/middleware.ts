/**
 * Roteamento por painel e renovação de sessão.
 *
 * DOIS CAMINHOS PARA O MESMO DESTINO, de propósito:
 *
 *   1. Por subdomínio — `app.localhost` e `admin.localhost` em desenvolvimento,
 *      `storefy.convertfy.me` e `admin-storefy.convertfy.me` quando houver
 *      domínio próprio. É o modelo da seção 1 do plano.
 *   2. Por prefixo de caminho — `/admin/...` no mesmo host.
 *
 * O segundo existe porque `*.vercel.app` não aceita subdomínio: um projeto
 * responde em um host só. Enquanto o domínio próprio não entra, o admin vive em
 * `/admin`. Quando entrar, basta preencher NEXT_PUBLIC_CLIENT_HOST e
 * NEXT_PUBLIC_ADMIN_HOST — nenhuma rota muda de lugar.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { carregarUsuario } from '@/lib/supabase/middleware';
import { env, supabaseConfigurado } from '@/lib/env';

/** Rotas do painel do cliente que não exigem login. */
const PUBLICAS_CLIENTE = [
  '/entrar',
  '/cadastrar',
  '/recuperar-senha',
  '/redefinir-senha',
  '/confirmar-email',
];

/** Rotas do painel admin que não exigem login. */
const PUBLICAS_ADMIN = ['/admin/entrar'];

function ehHost(hostname: string, configurado: string): boolean {
  return configurado !== '' && hostname === configurado;
}

export async function middleware(request: NextRequest) {
  const { nextUrl } = request;
  const hostname = request.headers.get('host')?.split(':')[0] ?? '';
  const caminho = nextUrl.pathname;

  // Sem Supabase configurado, tudo vai para a tela que explica o que falta.
  if (!supabaseConfigurado) {
    if (caminho === '/configuracao-pendente') return NextResponse.next();
    const url = nextUrl.clone();
    url.pathname = '/configuracao-pendente';
    return NextResponse.rewrite(url);
  }

  const hostEhAdmin = ehHost(hostname, env.hostAdmin) || hostname.startsWith('admin.');
  const hostEhCliente = ehHost(hostname, env.hostCliente) || hostname.startsWith('app.');

  let response = NextResponse.next({ request });
  const usuario = await carregarUsuario(request, response);

  // ---------------------------------------------------------------- admin
  if (hostEhAdmin) {
    // No host do admin, a raiz já é o painel admin: reescreve /x para /admin/x.
    const caminhoAdmin = caminho.startsWith('/admin')
      ? caminho
      : `/admin${caminho === '/' ? '' : caminho}`;

    if (usuario == null && !PUBLICAS_ADMIN.includes(caminhoAdmin)) {
      const url = nextUrl.clone();
      url.pathname = '/entrar';
      return NextResponse.redirect(url);
    }

    if (caminhoAdmin !== caminho) {
      const url = nextUrl.clone();
      url.pathname = caminhoAdmin;
      const reescrita = NextResponse.rewrite(url, { request });
      for (const cookie of response.cookies.getAll()) reescrita.cookies.set(cookie);
      response = reescrita;
    }
    return response;
  }

  // Host do cliente com domínio próprio: /admin pertence ao outro host.
  if (hostEhCliente && caminho.startsWith('/admin') && env.hostAdmin !== '') {
    const url = nextUrl.clone();
    url.hostname = env.hostAdmin;
    url.pathname = caminho;
    return NextResponse.redirect(url);
  }

  // ------------------------------------------- admin por caminho (Vercel)
  if (caminho.startsWith('/admin')) {
    if (usuario == null && !PUBLICAS_ADMIN.includes(caminho)) {
      const url = nextUrl.clone();
      url.pathname = '/admin/entrar';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // -------------------------------------------------------------- cliente
  const ehPublica = PUBLICAS_CLIENTE.some(
    (rota) => caminho === rota || caminho.startsWith(`${rota}/`),
  );

  if (usuario == null && !ehPublica) {
    const url = nextUrl.clone();
    url.pathname = '/entrar';
    // Volta para onde o usuário queria ir depois do login.
    if (caminho !== '/') url.searchParams.set('proximo', caminho);
    return NextResponse.redirect(url);
  }

  // Já logado não precisa ver a tela de login.
  if (usuario != null && (caminho === '/entrar' || caminho === '/cadastrar')) {
    const url = nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Tudo, menos arquivos estáticos e as rotas de callback do auth, que
     * precisam rodar sem interferência para trocar o código pela sessão.
     */
    '/((?!_next/static|_next/image|favicon.ico|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
