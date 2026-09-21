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

/**
 * Cor em hexadecimal, como o React Native entende.
 *
 * Aceita `#rgb`, `#rrggbb` e `#rrggbbaa`. O campo era `z.string()` livre, e
 * isso deixava o painel gravar `primary: 'azul'` — o app renderizaria com a cor
 * padrão da plataforma e ninguém entenderia por quê. O aperto entra ANTES de
 * existir qualquer config publicada, que é a única janela em que ele não
 * quebra a regra de compatibilidade da seção 3.
 */
export const CorHex = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'Use uma cor hexadecimal, como #1a1a1a.',
  );

/** Tipos de aba suportados pela tab bar nativa. */
export const TabType = z.enum(['webview', 'cart', 'account', 'notifications', 'search']);

/** Badge numérico exibido sobre o ícone da aba. */
export const TabBadge = z.enum(['none', 'cart_count', 'unread']);

/** Estilo da status bar do sistema. */
export const StatusBarStyle = z.enum(['light', 'dark']);

/** Momento em que o app pede permissão de push. */
export const PushPromptTiming = z.enum(['onboarding', 'after_first_add_to_cart', 'manual']);

/** Em que plataforma a loja roda. Espelha `stores.platform`. */
export const StorePlatform = z.enum(['shopify', 'other']);

export const StoreSchema = z.object({
  name: z.string(),
  /** URL pública da loja, ex.: https://loja.com.br */
  url: z.url(),
  /** Domínios que abrem dentro da WebView. O resto abre no navegador externo. */
  domains: z.array(z.string()),
  /**
   * O que o app pode assumir sobre a loja.
   *
   * Hoje decide uma coisa só, e ela paga a assinatura: em `shopify`, o app
   * marca o carrinho com `_storefy` para o pedido nascer sabendo que veio
   * dali. Numa loja `other` esses endpoints não existem, e insistir seria uma
   * requisição perdida por página.
   *
   * `default('shopify')` e não `other`: toda config já publicada é de loja
   * Shopify — é o produto —, e o outro padrão desligaria a atribuição de todo
   * mundo até a próxima publicação, sem ninguém perceber.
   */
  platform: StorePlatform.default('shopify'),
});

export const ThemeSchema = z.object({
  primary: CorHex,
  background: CorHex,
  text: CorHex,
  tabBarBg: CorHex,
  tabBarActive: CorHex,
  tabBarInactive: CorHex,
  statusBar: StatusBarStyle,
});

export const TabSchema = z.object({
  /**
   * Identificador estável da aba.
   *
   * Vira chave de componente e de WebView no app: com id repetido, duas abas
   * disputam a mesma instância e a rolagem de uma aparece na outra. Só
   * minúsculas, números e hífen, para poder viajar em URL de deep link.
   */
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use só letras minúsculas, números e hífen.'),
  /** Cabe na tab bar: limite de 12 caracteres. */
  label: z.string().min(1).max(12),
  /** Nome do ícone (lucide/phosphor). */
  icon: z.string().min(1),
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
  tabs: z
    .array(TabSchema)
    .min(2)
    .max(5)
    .refine((abas) => new Set(abas.map((aba) => aba.id)).size === abas.length, {
      message: 'Duas abas não podem ter o mesmo identificador.',
    }),
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
export { NOMES_DE_ICONE, ROTULO_DO_ICONE, ehNomeDeIcone } from './icones';
export type { NomeDeIcone } from './icones';
export {
  ESQUEMA_DA_PREVIA,
  ehTokenDePrevia,
  lerTokenDePrevia,
  normalizarTokenDePrevia,
  urlDaPrevia,
} from './previa';

/**
 * O atributo de carrinho que marca o pedido como vindo do app.
 *
 * MORA AQUI PORQUE É CONTRATO ENTRE OS DOIS LADOS: o app escreve com
 * `/cart/update.js`, a Shopify carrega até o pedido, e o webhook do painel lê
 * em `note_attributes`. Duas constantes iguais em pacotes diferentes se
 * desencontram no dia em que alguém renomeia uma — e o sintoma seria todo
 * pedido do app aparecendo como pedido do site, sem erro em lugar nenhum.
 *
 * O underscore na frente não é estilo: a Shopify ESCONDE do cliente final os
 * atributos que começam com `_`. Sem ele, a marca apareceria no e-mail de
 * confirmação e na página de agradecimento da loja.
 */
export const ATRIBUTO_DO_CARRINHO = '_storefy';

/** O valor gravado no atributo. Só `'1'` conta como pedido do app. */
export const VALOR_DO_ATRIBUTO = '1';
