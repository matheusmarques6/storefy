/**
 * AppConfig — contrato central entre o painel e o app (seção 3 do PLANO-DESENVOLVIMENTO.md).
 *
 * O painel edita, o Supabase guarda com versões e o app consome. Todo o produto
 * gira em torno deste objeto.
 *
 * REGRA DE COMPATIBILIDADE (seção 3 do plano): apps já publicados precisam
 * continuar funcionando com configs novas. Portanto:
 *   - campo novo entra SEMPRE com `.default(...)` ou `.optional()`;
 *   - campo existente nunca muda de tipo nem deixa de ser aceito;
 *   - toda mudança neste arquivo ganha um teste em `index.test.ts`.
 *
 * Nota sobre a sintaxe: o plano foi escrito com `z.string().url()`, que o Zod 4
 * deprecou em favor de `z.url()`. A validação é a mesma; usamos a forma atual
 * para não emitir aviso de depreciação no lint.
 */
import { z } from 'zod';

/** Tipos de aba suportados pela tab bar nativa. */
export const TabType = z.enum(['webview', 'cart', 'account', 'notifications', 'search']);

/** Badge numérico exibido sobre o ícone da aba. */
export const TabBadge = z.enum(['none', 'cart_count', 'unread']);

/** Estilo da status bar do sistema. */
export const StatusBarStyle = z.enum(['light', 'dark']);

/** Momento em que o app pede permissão de push. */
export const PushPromptTiming = z.enum(['onboarding', 'after_first_add_to_cart', 'manual']);

export const StoreSchema = z.object({
  name: z.string(),
  /** URL pública da loja, ex.: https://loja.com.br */
  url: z.url(),
  /** Domínios que abrem dentro da WebView. O resto abre no navegador externo. */
  domains: z.array(z.string()),
});

export const ThemeSchema = z.object({
  primary: z.string(),
  background: z.string(),
  text: z.string(),
  tabBarBg: z.string(),
  tabBarActive: z.string(),
  tabBarInactive: z.string(),
  statusBar: StatusBarStyle,
});

export const TabSchema = z.object({
  id: z.string(),
  /** Cabe na tab bar: limite de 12 caracteres. */
  label: z.string().max(12),
  /** Nome do ícone (lucide/phosphor). */
  icon: z.string(),
  type: TabType,
  /** Caminho relativo ou URL absoluta. Só se aplica a abas do tipo `webview`. */
  url: z.string().optional(),
  badge: TabBadge.default('none'),
});

export const WebviewSchema = z.object({
  /** Seletores CSS escondidos na loja, ex.: 'header', '.site-footer'. */
  hideSelectors: z.array(z.string()),
  customCss: z.string().default(''),
  customJs: z.string().default(''),
  pullToRefresh: z.boolean().default(true),
  userAgentSuffix: z.string().default('StorefyApp'),
});

export const OnboardingSlideSchema = z.object({
  title: z.string(),
  body: z.string(),
  image: z.string(),
});

export const FeaturesSchema = z.object({
  pushPromptTiming: PushPromptTiming,
  onboardingSlides: z.array(OnboardingSlideSchema).max(4),
  /** Banner "baixe o app" exibido no site. */
  appBanner: z.object({ enabled: z.boolean(), text: z.string() }),
  biometricLogin: z.boolean().default(false),
  rateAppPrompt: z.boolean().default(true),
});

export const AnnouncementSchema = z.object({
  enabled: z.boolean(),
  text: z.string(),
  url: z.string().optional(),
});

export const AppConfigSchema = z.object({
  /** Incrementa a cada publicação. */
  version: z.number(),
  store: StoreSchema,
  theme: ThemeSchema,
  /** A tab bar precisa de 2 a 5 abas para parecer nativa e caber na tela. */
  tabs: z.array(TabSchema).min(2).max(5),
  webview: WebviewSchema,
  features: FeaturesSchema,
  announcement: AnnouncementSchema.optional(),
  /** Abaixo deste build, o app exibe a tela "Atualize o app". */
  minSupportedBuild: z.number().default(1),
});

/** Alias mantido para casar com o nome usado na seção 3 do plano. */
export const AppConfig = AppConfigSchema;

export type AppConfig = z.infer<typeof AppConfigSchema>;
/** Formato aceito na entrada, antes de o Zod aplicar os defaults. */
export type AppConfigInput = z.input<typeof AppConfigSchema>;
export type Tab = z.infer<typeof TabSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Store = z.infer<typeof StoreSchema>;

/** Valida e aplica defaults. Lança `ZodError` se a config for inválida. */
export function parseAppConfig(input: unknown): AppConfig {
  return AppConfigSchema.parse(input);
}

/** Valida sem lançar — use quando a origem dos dados não é confiável. */
export function safeParseAppConfig(input: unknown) {
  return AppConfigSchema.safeParse(input);
}

export { configInicial, dominiosDaLoja, ABAS_PADRAO, TEMA_PADRAO } from './inicial';
export type { DadosDaLoja } from './inicial';
