/**
 * As notas para a revisão da Apple (C12, checklist 5.7 do plano).
 *
 * A diretriz 4.2 da App Store recusa app que "é só um site embrulhado". O que
 * separa um do outro, para o revisor, é o que ele consegue VER de nativo — e
 * ele vê mais depressa quando alguém diz onde olhar. O campo "Notes" da App
 * Review Information existe para isso, e quase todo lojista o deixa em branco.
 *
 * TUDO SAI DA CONFIG PUBLICADA, que é a que o revisor vai abrir: só entra o
 * recurso que está ligado de verdade. Prometer ao revisor um Face ID que o app
 * não tem é recusa na certa, e das demoradas.
 *
 * Em inglês: é a língua da equipe de revisão, e nota que o revisor precisa
 * traduzir é nota que ele pula.
 */
import type { AppConfig, Tab } from '@storefy/config-schema';
import { dominioDe } from './ficha-da-loja';

/** Limite do campo "Notes" na App Store Connect. */
export const LIMITE_DAS_NOTAS = 4000;

export interface DadosDasNotas {
  nomeDaLoja: string;
  urlDaLoja: string;
  /** O app tem push configurado (OneSignal). */
  pushLigado: boolean;
  /** A config publicada — a que o revisor abre. */
  config: AppConfig;
  /**
   * A Shopify já publica os Universal Links do app no domínio da loja. Sem
   * isso, prometer "o link abre no app" é prometer o que o revisor não vê.
   */
  linksNoApp?: boolean;
}

/** As abas que o app mostra de fato: sem push, a caixa de avisos não aparece. */
function abasVisiveis(config: AppConfig, pushLigado: boolean): Tab[] {
  const visiveis = config.tabs.filter((aba) => aba.type !== 'notifications' || pushLigado);
  return visiveis.length === 0 ? config.tabs : visiveis;
}

function entreAspas(texto: string): string {
  return `"${texto.trim()}"`;
}

export function montarNotasDaRevisao(dados: DadosDasNotas): string {
  const { config, pushLigado } = dados;
  const loja = dados.nomeDaLoja.trim() === '' ? config.store.name : dados.nomeDaLoja.trim();
  const dominio = dominioDe(dados.urlDaLoja === '' ? config.store.url : dados.urlDaLoja);

  const abas = abasVisiveis(config, pushLigado);
  const conta = abas.find((aba) => aba.type === 'account');
  const avisos = pushLigado ? abas.find((aba) => aba.type === 'notifications') : undefined;
  const carrinho = abas.find((aba) => aba.badge === 'cart_count');
  const faceId = config.features.biometricLogin && conta !== undefined;
  // O carrinho é lido de `/cart.js`, que só a Shopify tem: fora dela, nem a
  // vibração nem o número na aba acontecem.
  const shopify = config.store.platform === 'shopify';

  const recursos: string[] = [];
  if (abas.length > 1) {
    recursos.push(
      `Native tab bar (${abas.map((aba) => entreAspas(aba.label)).join(', ')}). Each tab keeps its own page and scroll position, like a native app.`,
    );
  }
  if (pushLigado) {
    recursos.push(
      'Push notifications from the store, with deep links that open the exact product or collection.',
    );
  }
  if (avisos !== undefined) {
    recursos.push(
      `Native notification inbox in the ${entreAspas(avisos.label)} tab, with read and unread states.`,
    );
  }
  const busca = abas.find((aba) => aba.type === 'search');
  if (busca !== undefined) {
    recursos.push(
      `Native search field at the top of the ${entreAspas(busca.label)} tab; results open on the store's own search page.`,
    );
  }
  if (config.features.onboardingSlides.length > 0) {
    recursos.push('Native welcome screens on the first launch.');
  }
  if (config.features.biometricLogin && conta !== undefined) {
    recursos.push(
      `Face ID / Touch ID protection for the ${entreAspas(conta.label)} tab, where the customer's orders and addresses are.`,
    );
  }
  recursos.push('Native share sheet: the store\'s "Share" buttons open the iOS share sheet.');
  if (shopify) recursos.push('Haptic feedback when a product is added to the cart.');
  recursos.push('Native offline screen with a retry button when there is no connection.');
  if (dados.linksNoApp === true) {
    recursos.push(
      `Universal Links: links to ${dominio} open directly in the app, on the right page.`,
    );
  }
  if (config.features.rateAppPrompt) {
    recursos.push('Native App Store rating prompt after a completed purchase.');
  }

  /*
   * Onde ficam os ajustes do app (M12). Com push, é ali que a diretriz 4.5.4
   * manda o revisor procurar o "parar de receber" dentro do app — e ele
   * procura. A entrada segue o app: a engrenagem da caixa de avisos ou, sem
   * ela, a linha no topo da aba Conta.
   */
  const entradaDosAjustes =
    avisos !== undefined
      ? `the gear icon in the ${entreAspas(avisos.label)} tab`
      : conta !== undefined
        ? `"Ajustes do app" (App settings) at the top of the ${entreAspas(conta.label)} tab`
        : null;
  if (entradaDosAjustes !== null) {
    recursos.push(
      pushLigado
        ? `Native settings screen (${entradaDosAjustes}): turn notifications off inside the app, see the app version and open the privacy policy.`
        : `Native settings screen (${entradaDosAjustes}): app version and privacy policy.`,
    );
  }

  const passos: string[] = [];
  if (shopify) {
    passos.push(
      carrinho === undefined
        ? 'Browse the catalog and add a product to the cart: the phone gives haptic feedback.'
        : `Browse the catalog and add a product to the cart: the badge on the ${entreAspas(carrinho.label)} tab updates and the phone gives haptic feedback.`,
    );
  } else {
    passos.push('Browse the catalog using the tab bar.');
  }
  if (conta !== undefined) {
    passos.push(
      `No account is needed to browse or buy. To see the account area, open the ${entreAspas(conta.label)} tab and create a customer account there.${faceId ? ' On a device with Face ID set up, the tab asks for Face ID first.' : ''}`,
    );
  }
  if (pushLigado) {
    passos.push(
      avisos === undefined
        ? 'Allow notifications when asked to receive messages from the store.'
        : `Allow notifications when asked; messages sent by the store also appear in the ${entreAspas(avisos.label)} tab.`,
    );
    if (entradaDosAjustes !== null) {
      passos.push(
        `To stop receiving notifications from inside the app, open ${entradaDosAjustes} and switch off "Receber notificações" (Receive notifications).`,
      );
    }
  }

  const texto = [
    `This is the official app of ${loja} (${dominio}). It brings the store's catalog and checkout into a native iOS app, with features the website does not have:`,
    '',
    ...recursos.map((linha) => `• ${linha}`),
    '',
    'How to test:',
    ...passos.map((linha) => `• ${linha}`),
    '',
    shopify
      ? "Payments happen in the store's own Shopify checkout, the same one used on the website."
      : "Payments happen in the store's own checkout, the same one used on the website.",
  ].join('\n');

  return texto.length <= LIMITE_DAS_NOTAS ? texto : texto.slice(0, LIMITE_DAS_NOTAS).trimEnd();
}
