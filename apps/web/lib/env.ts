/**
 * Variáveis de ambiente, validadas em um único lugar.
 *
 * POR QUE NÃO FALHAR NA IMPORTAÇÃO: o `next build` do CI roda sem segredos.
 * Se este módulo lançasse ao ser importado, o build quebraria por falta de
 * configuração em vez de por erro de código. Em vez disso, expomos
 * `supabaseConfigurado`, e a interface mostra um estado "não configurado"
 * explicando o que falta — que é o que a regra 1 do CLAUDE.md pede para toda
 * integração ausente.
 */
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

/**
 * Lidas de `process.env.X` literal, e não por índice: o Next substitui
 * `process.env.NEXT_PUBLIC_*` no bundle em tempo de build, e o acesso dinâmico
 * não é substituído — o valor chegaria como `undefined` no browser.
 */
const brutas = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

const analise = publicSchema.safeParse(brutas);

/** Falso quando faltam URL ou chave do Supabase. A interface avisa em vez de quebrar. */
export const supabaseConfigurado = analise.success;

/**
 * A chave de service role existe?
 *
 * Booleano, nunca o valor. Serve para as rotas que precisam dela responderem um
 * erro limpo em vez de estourar: sem isto, o endpoint público da config
 * devolveria a página de erro do Next para o app de todos os clientes.
 */
export const serviceRoleConfigurada =
  process.env.SUPABASE_SERVICE_ROLE_KEY != null && process.env.SUPABASE_SERVICE_ROLE_KEY !== '';

/** O que exatamente está faltando, para a tela de configuração pendente. */
export const faltandoNoSupabase: string[] = analise.success
  ? []
  : analise.error.issues.map((problema) => String(problema.path[0] ?? 'variável'));

export const env = {
  supabaseUrl: brutas.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: brutas.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  /** Login com Google fica visível só quando o provedor está configurado no Supabase. */
  googleHabilitado: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true',
  /** Host do painel do cliente, quando houver domínio próprio (ex.: app.storefy.com). */
  hostCliente: process.env.NEXT_PUBLIC_CLIENT_HOST ?? '',
  /** Host do painel admin, quando houver domínio próprio (ex.: admin.storefy.com). */
  hostAdmin: process.env.NEXT_PUBLIC_ADMIN_HOST ?? '',
} as const;

/**
 * URL pública da aplicação.
 *
 * É daqui que saem o endereço de retorno do OAuth da Shopify, a URL dos
 * webhooks e os links de confirmação de e-mail do Supabase. Os três precisam
 * de uma URL ABSOLUTA — com esquema.
 *
 * `NEXT_PUBLIC_SITE_URL` é colada à mão num painel, e a forma que a Vercel
 * mostra o domínio é sem esquema (`minha-app.vercel.app`). Colar exatamente o
 * que está lá é o caminho natural, e produzia
 * `redirect_uri=minha-app.vercel.app/api/shopify/callback` — que a Shopify
 * recusa com "The redirect_uri is not whitelisted", sem dizer que o problema
 * é a falta do `https://`. O mesmo valor ia para o registro dos webhooks, e
 * ali o erro era ainda mais silencioso: a Shopify recusava cada tópico e a
 * loja ficava conectada sem receber nada.
 *
 * Normalizar aqui é melhor do que validar na hora de usar: são cinco lugares
 * usando, e a primeira coisa que qualquer um deles faz é montar uma URL.
 */
export function urlDoSite(): string {
  const explicita = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicita != null && explicita.trim() !== '') return comEsquema(explicita.trim());

  // Preview da Vercel: o domínio muda a cada deploy.
  const vercel = process.env.VERCEL_URL;
  if (vercel != null && vercel !== '') return `https://${vercel}`;

  return 'http://app.localhost:3000';
}

/**
 * Garante o esquema, sem mexer em quem já o tem.
 *
 * `localhost` fica em `http`: forçar `https` num ambiente de desenvolvimento
 * quebraria o login local, que é onde isto mais roda.
 */
function comEsquema(bruto: string): string {
  const semBarra = bruto.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(semBarra)) return semBarra;

  const local =
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(semBarra) ||
    /^[a-z0-9-]+\.localhost(:\d+)?$/i.test(semBarra);

  return `${local ? 'http' : 'https'}://${semBarra}`;
}

/**
 * Chave de service role. Só existe no servidor.
 * Lançar aqui é proposital: quem chama isto já decidiu fazer uma operação
 * privilegiada, e seguir sem a chave seria pior do que falhar alto.
 */
export function chaveServiceRole(): string {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (chave == null || chave === '') {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não configurada. Ela é obrigatória para as rotas do painel admin.',
    );
  }
  return chave;
}
