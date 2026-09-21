/**
 * O que a camada nativa faz com cada mensagem vinda da página (seção 5.5).
 *
 * Separado dos componentes de propósito: aqui só se DECIDE, sem React e sem
 * módulo nativo. Dá para testar sem aparelho — e é aqui que mora o risco, já
 * que quem manda a mensagem é a página do lojista, com o tema dele, os apps que
 * ele instalou e os scripts de terceiros que vieram junto.
 *
 * Nada de agir por conta própria em cima de recurso que este build não tem.
 * Enquanto o OneSignal e o backend de eventos não existirem, a mensagem vira
 * `ignorar` com motivo escrito, e não um `catch` vazio: um recurso ausente é um
 * estado, não um erro engolido (regras 1 e 3 do CLAUDE.md).
 */
import { lerMensagemDaWeb } from '@storefy/bridge';

export type AcaoNativa =
  /** Alimenta o badge da aba do carrinho. */
  | { tipo: 'carrinho'; count: number; token?: string; totalCents?: number; currency?: string }
  | { tipo: 'vibrar'; estilo: 'light' | 'medium' | 'success' }
  | { tipo: 'compartilhar'; url: string; title?: string }
  | { tipo: 'abrir-fora'; url: string }
  | { tipo: 'pedir-push' }
  | { tipo: 'identificar-cliente'; customerId?: string; emailHash?: string }
  | { tipo: 'checkout-iniciado'; token: string }
  | { tipo: 'pedido-concluido'; orderId: string; totalCents: number; pedirAvaliacao: boolean }
  /** "Me avise quando voltar": o botão da página do produto foi tocado. */
  | { tipo: 'avisar-de-volta'; variantId: string; path?: string }
  | { tipo: 'ignorar'; motivo: string };

export interface ContextoDasAcoes {
  /** OneSignal ligado neste build (Fase 3). */
  push: boolean;
  /** Backend de `cart_events` disponível (Fase 3). */
  eventos: boolean;
  /** `features.rateAppPrompt` da config da loja. */
  pedirAvaliacao: boolean;
}

/**
 * Traduz uma mensagem bruta da WebView na ação que a camada nativa executa.
 *
 * Recebe a string crua do `onMessage`, não um objeto: validar é o ponto do
 * exercício, e quem chama não deve ter chance de pular essa etapa.
 */
export function acaoParaMensagem(bruta: unknown, contexto: ContextoDasAcoes): AcaoNativa {
  const lida = lerMensagemDaWeb(bruta);
  if (!lida.ok) return { tipo: 'ignorar', motivo: lida.motivo };

  const mensagem = lida.mensagem;
  switch (mensagem.type) {
    case 'CART_UPDATED':
      return {
        tipo: 'carrinho',
        count: mensagem.count,
        token: mensagem.token,
        totalCents: mensagem.totalCents,
        currency: mensagem.currency,
      };

    case 'HAPTIC':
      return { tipo: 'vibrar', estilo: mensagem.style };

    case 'SHARE':
      return { tipo: 'compartilhar', url: mensagem.url, title: mensagem.title };

    case 'OPEN_EXTERNAL':
      return { tipo: 'abrir-fora', url: mensagem.url };

    case 'REQUEST_PUSH_PERMISSION':
      // No iOS o sistema mostra o pedido UMA vez. Disparar sem ter para onde
      // registrar o dispositivo queimaria essa única chance em silêncio.
      return contexto.push
        ? { tipo: 'pedir-push' }
        : { tipo: 'ignorar', motivo: 'Push ainda não configurado neste app.' };

    case 'CUSTOMER_IDENTIFIED':
      return contexto.push
        ? {
            tipo: 'identificar-cliente',
            customerId: mensagem.customerId,
            emailHash: mensagem.emailHash,
          }
        : { tipo: 'ignorar', motivo: 'Push ainda não configurado neste app.' };

    case 'CHECKOUT_STARTED':
      return contexto.eventos
        ? { tipo: 'checkout-iniciado', token: mensagem.token }
        : { tipo: 'ignorar', motivo: 'Eventos de carrinho ainda não configurados.' };

    case 'ORDER_COMPLETED':
      // A avaliação não depende do backend: `expo-store-review` é local, e
      // pedir logo depois da compra é o momento em que o cliente mais gosta
      // do app. O evento em si, esse sim, espera o backend.
      return {
        tipo: 'pedido-concluido',
        orderId: mensagem.orderId,
        totalCents: mensagem.totalCents,
        pedirAvaliacao: contexto.pedirAvaliacao,
      };

    case 'NOTIFY_WHEN_BACK':
      /*
       * Depende do PUSH, e não do backend de eventos: a inscrição só vale se
       * houver como notificar. Aceitar o pedido num app sem push registraria a
       * intenção de alguém que nunca receberia o aviso — e o silêncio depois
       * seria pior do que o botão não existir.
       */
      return contexto.push
        ? { tipo: 'avisar-de-volta', variantId: mensagem.variantId, path: mensagem.path }
        : { tipo: 'ignorar', motivo: 'Push ainda não configurado neste app.' };
  }
}
