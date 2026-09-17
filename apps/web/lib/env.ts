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

/** URL pública da aplicação, usada nos redirects de e-mail do Supabase Auth. */
export function urlDoSite(): string {
  const explicita = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicita != null && explicita !== '') return explicita.replace(/\/$/, '');

  // Preview da Vercel: o domínio muda a cada deploy.
  const vercel = process.env.VERCEL_URL;
  if (vercel != null && vercel !== '') return `https://${vercel}`;

  return 'http://app.localhost:3000';
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
