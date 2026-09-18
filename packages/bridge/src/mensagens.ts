/**
 * Contrato de mensagens entre a WebView e a camada nativa (seção 5.5 do plano).
 *
 * POR QUE VALIDAR EM VEZ DE CONFIAR NO TIPO: as mensagens `WebToNative` são
 * `postMessage` vindos da página da loja. Essa página não é nossa — ela roda o
 * tema do lojista, os apps que ele instalou e os scripts de terceiros que vêm
 * junto. Qualquer um deles pode chamar `window.ReactNativeWebView.postMessage`
 * com o que quiser. Um tipo do TypeScript some em tempo de execução; por isso
 * cada mensagem passa por um schema antes de a camada nativa agir sobre ela.
 *
 * Regra 6 do CLAUDE.md: mensagens do bridge só pelos tipos deste pacote.
 */
import { z } from 'zod';

/** Chave usada pela página para falar com o app. */
export const CANAL = 'ReactNativeWebView' as const;

// ------------------------------------------------------------ Web -> Nativo

/**
 * Carrinho mudou. Alimenta o badge da aba e a tabela `cart_events`.
 *
 * POR QUE SÓ `count` É OBRIGATÓRIO: quem produz esta mensagem é o observador
 * injetado, que lê `/cart.js`. A Shopify devolve os quatro campos, mas quem
 * responde ali é o tema do lojista — com proxy, cache de borda ou app de
 * terceiro no caminho, um campo pode não vir. Nesse caso o observador **omite**
 * o campo em vez de inventar um valor: dizer `currency: 'BRL'` para uma loja em
 * dólar, ou `totalCents: 0` para um carrinho cheio, é dado falso gravado em
 * `cart_events` (regra 1 do CLAUDE.md). Sem `count` a mensagem não serve para
 * nada — é o número do badge —, então esse continua exigido.
 */
export const CartUpdatedSchema = z.object({
  type: z.literal('CART_UPDATED'),
  /** Quantidade de itens. Nunca negativa. */
  count: z.number().int().min(0),
  /** Token do carrinho da Shopify, usado para casar com o pedido depois. */
  token: z.string().min(1).optional(),
  /** Em centavos, para não carregar ponto flutuante em dinheiro. */
  totalCents: z.number().int().min(0).optional(),
  /** Código ISO-4217, ex.: BRL. */
  currency: z.string().length(3).optional(),
});

/** A loja identificou o cliente. Vira `externalId` no OneSignal. */
export const CustomerIdentifiedSchema = z.object({
  type: z.literal('CUSTOMER_IDENTIFIED'),
  customerId: z.string().min(1).optional(),
  /** Hash do e-mail. O e-mail em claro nunca deve cruzar o bridge. */
  emailHash: z.string().min(1).optional(),
});

/** O cliente entrou no checkout. Cancela o carrinho abandonado. */
export const CheckoutStartedSchema = z.object({
  type: z.literal('CHECKOUT_STARTED'),
  token: z.string().min(1),
});

/** Compra concluída, detectada na página de obrigado. */
export const OrderCompletedSchema = z.object({
  type: z.literal('ORDER_COMPLETED'),
  orderId: z.string().min(1),
  totalCents: z.number().int().min(0),
});

/** Vibração. `success` é o padrão de notificação do sistema, não um impulso. */
export const HapticSchema = z.object({
  type: z.literal('HAPTIC'),
  style: z.enum(['light', 'medium', 'success']),
});

/**
 * URL que a camada nativa pode abrir.
 *
 * `z.url()` sozinho NÃO basta: pela especificação, `javascript:alert(1)` e
 * `intent://...` são URLs perfeitamente válidas, e as duas chegariam ao
 * `Linking.openURL`. No Android, `intent://` é caminho conhecido para disparar
 * activity arbitrária. Como a página que manda a mensagem não é nossa, o
 * esquema é decidido aqui e não lá.
 */
const urlNavegavel = z.url().refine(
  (valor) => {
    try {
      const esquema = new URL(valor).protocol;
      return esquema === 'http:' || esquema === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'Só http e https são aceitos.' },
);

/** Compartilhar pela folha nativa do sistema. */
export const ShareSchema = z.object({
  type: z.literal('SHARE'),
  url: urlNavegavel,
  title: z.string().max(200).optional(),
});

/** Pedir permissão de push na hora certa, decidida pela loja. */
export const RequestPushPermissionSchema = z.object({
  type: z.literal('REQUEST_PUSH_PERMISSION'),
});

/** Abrir um endereço fora do app. */
export const OpenExternalSchema = z.object({
  type: z.literal('OPEN_EXTERNAL'),
  url: urlNavegavel,
});

export const WebToNativeSchema = z.discriminatedUnion('type', [
  CartUpdatedSchema,
  CustomerIdentifiedSchema,
  CheckoutStartedSchema,
  OrderCompletedSchema,
  HapticSchema,
  ShareSchema,
  RequestPushPermissionSchema,
  OpenExternalSchema,
]);

export type WebToNative = z.infer<typeof WebToNativeSchema>;
export type WebToNativeType = WebToNative['type'];

// ------------------------------------------------------------ Nativo -> Web

/** Contexto que o app entrega à página assim que ela carrega. */
export const AppContextSchema = z.object({
  type: z.literal('APP_CONTEXT'),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().min(1),
  pushEnabled: z.boolean(),
});

/** Manda a WebView navegar. Usado pelo deep link de um push. */
export const NavigateSchema = z.object({
  type: z.literal('NAVIGATE'),
  /** Caminho relativo à loja. Absoluto abriria outro site dentro da aba. */
  path: z.string().startsWith('/'),
});

export const NativeToWebSchema = z.discriminatedUnion('type', [AppContextSchema, NavigateSchema]);

export type NativeToWeb = z.infer<typeof NativeToWebSchema>;
export type NativeToWebType = NativeToWeb['type'];

// ------------------------------------------------------------------ helpers

export type ResultadoDaMensagem =
  { ok: true; mensagem: WebToNative } | { ok: false; motivo: string };

/**
 * Converte o texto cru de um `postMessage` em mensagem validada.
 *
 * Devolve motivo em vez de lançar: isto roda no caminho de toda mensagem que a
 * página manda, e uma exceção por causa de um script de terceiro derrubaria a
 * aba inteira do usuário.
 */
export function lerMensagemDaWeb(bruto: unknown): ResultadoDaMensagem {
  if (typeof bruto !== 'string') {
    return { ok: false, motivo: 'A mensagem não é texto.' };
  }
  // Limite defensivo: um script hostil poderia mandar megabytes e travar a
  // thread de JS só no parse.
  if (bruto.length > 64_000) {
    return { ok: false, motivo: 'Mensagem grande demais.' };
  }

  let objeto: unknown;
  try {
    objeto = JSON.parse(bruto);
  } catch {
    return { ok: false, motivo: 'A mensagem não é JSON válido.' };
  }

  const analise = WebToNativeSchema.safeParse(objeto);
  if (!analise.success) {
    const primeiro = analise.error.issues[0];
    const caminho = primeiro?.path.join('.') ?? '';
    return {
      ok: false,
      motivo:
        caminho === ''
          ? (primeiro?.message ?? 'Formato inesperado.')
          : `${caminho}: ${primeiro?.message ?? ''}`,
    };
  }

  return { ok: true, mensagem: analise.data };
}

/** Serializa uma mensagem do app para a página, já validada. */
export function escreverMensagemParaWeb(mensagem: NativeToWeb): string {
  return JSON.stringify(NativeToWebSchema.parse(mensagem));
}

/**
 * JavaScript que entrega uma mensagem do app à página.
 *
 * O `true;` no fim não é enfeite: sem ele, o valor da última expressão volta
 * para a ponte nativa, e no iOS um retorno não serializável derruba a
 * injeção com um aviso silencioso.
 */
export function injecaoDeMensagem(mensagem: NativeToWeb): string {
  const carga = escreverMensagemParaWeb(mensagem);
  return `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(carga)}}));true;`;
}
