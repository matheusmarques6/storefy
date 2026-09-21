/**
 * Roteamento por painel e renovação de sessão.
 *
 * Este arquivo usa a convenção `proxy` do Next 16. Ela substitui o antigo
 * `middleware.ts`, que ainda funciona mas emite aviso de depreciação no build.
 * O comportamento é o mesmo; muda o nome do arquivo e o da função exportada.
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

export async function proxy(request: NextRequest) {
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
     * Tudo, menos:
     *
     *  - arquivos estáticos;
     *  - `auth/`, que precisa rodar sem interferência para trocar o código
     *    pela sessão;
     *  - `api/`, que NÃO deve passar por este middleware;
     *  - `privacy/`, a política de privacidade pública de cada loja.
     *
     * A exclusão de `api/` é deliberada. Este middleware redireciona para
     * `/entrar` quem não tem sessão, o que faz sentido para tela, não para
     * endpoint: um webhook do EAS ou da Shopify receberia um 307 para a
     * página de login em vez de ser processado, e o app mobile receberia HTML
     * ao buscar a própria config. Cada rota de API faz a autenticação que lhe
     * cabe — assinatura HMAC, segredo de cron, ou nenhuma quando é pública.
     *
     * A de `privacy/` é do mesmo tipo, e a Apple depende dela: o revisor abre
     * esse endereço para conferir a política antes de aprovar o app. Um 307
     * para a tela de login ali vira recusa — e a recusa chega dias depois.
     */
    '/((?!_next/static|_next/image|favicon.ico|auth/|api/|privacy/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

/**
 * O mesmo padrão de `config.matcher`, exportado para teste.
 *
 * O Next exige que os itens de `matcher` sejam literais estáticos: ele lê esse
 * campo em tempo de build, sem executar o módulo, e um `build` quebra na hora
 * se o valor for uma referência. Por isso o literal fica inline acima e esta
 * constante é DERIVADA dele — assim não há como os dois divergirem.
 *
 * O teste está em `lib/rotas.test.ts`. Voltar a capturar `api/` aqui quebraria
 * todo webhook e todo endpoint público das próximas fases, e só apareceria em
 * produção.
 */
export const PADRAO_DO_MATCHER: string = config.matcher[0] ?? '';
