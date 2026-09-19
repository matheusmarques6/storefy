/**
 * As operações do editor do app (C06) sobre a `AppConfig`.
 *
 * Tudo aqui é puro e imutável: recebe a config, devolve outra. Os formulários
 * ficam sendo só formulários, e as regras que doem — uma aba de carrinho só,
 * rótulo que não cabe na barra, id que já existe — ganham teste em vez de
 * viverem espalhadas por `onChange`.
 *
 * As mensagens são para o lojista, não para quem programa: nada de "ZodError"
 * nem de "índice 2 do array tabs".
 */
import type { AppConfig, Tab } from '@storefy/config-schema';
import { safeParseAppConfig } from '@storefy/config-schema';

export const MIN_ABAS = 2;
export const MAX_ABAS = 5;

/** Cada tipo de aba entra com um rótulo e um ícone que já fazem sentido. */
export const PADRAO_POR_TIPO: Record<Tab['type'], { label: string; icon: string; url?: string }> = {
  webview: { label: 'Página', icon: 'grid', url: '/' },
  search: { label: 'Buscar', icon: 'search' },
  cart: { label: 'Carrinho', icon: 'shopping-bag' },
  account: { label: 'Conta', icon: 'user' },
  notifications: { label: 'Avisos', icon: 'bell' },
};

/** Tipos que só fazem sentido uma vez na barra. */
const TIPOS_UNICOS: Tab['type'][] = ['cart', 'account', 'search', 'notifications'];

function clonar(config: AppConfig): AppConfig {
  return structuredClone(config);
}

/**
 * Um identificador livre, derivado do tipo.
 *
 * Derivado e não aleatório: `carrinho` é legível no deep link e no histórico,
 * enquanto um uuid não diz nada a ninguém.
 */
export function idLivre(config: AppConfig, base: string): string {
  const usados = new Set(config.tabs.map((aba) => aba.id));
  const limpo =
    base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'aba';

  if (!usados.has(limpo)) return limpo;
  for (let n = 2; n < 100; n += 1) {
    const tentativa = `${limpo}-${String(n)}`;
    if (!usados.has(tentativa)) return tentativa;
  }
  return `${limpo}-${String(Date.now())}`;
}

/**
 * Tipos que ainda cabem nesta config.
 *
 * `notifications` só entra quando o push está configurado: sem ele o app
 * esconde essa aba da barra, e oferecê-la aqui seria um botão que não faz nada
 * — que é exatamente o que a regra 3 do CLAUDE.md proíbe.
 */
export function tiposDisponiveis(
  config: AppConfig,
  recursos: { push: boolean } = { push: false },
): Tab['type'][] {
  const usados = new Set(config.tabs.map((aba) => aba.type));
  return (Object.keys(PADRAO_POR_TIPO) as Tab['type'][])
    .filter((tipo) => tipo !== 'notifications' || recursos.push)
    .filter((tipo) => !TIPOS_UNICOS.includes(tipo) || !usados.has(tipo));
}

export function podeAdicionarAba(
  config: AppConfig,
  recursos: { push: boolean } = { push: false },
): boolean {
  return config.tabs.length < MAX_ABAS && tiposDisponiveis(config, recursos).length > 0;
}

export function podeRemoverAba(config: AppConfig): boolean {
  return config.tabs.length > MIN_ABAS;
}

export function adicionarAba(
  config: AppConfig,
  tipo: Tab['type'],
  recursos: { push: boolean } = { push: false },
): AppConfig {
  if (!podeAdicionarAba(config, recursos)) return config;
  if (!tiposDisponiveis(config, recursos).includes(tipo)) return config;

  const padrao = PADRAO_POR_TIPO[tipo];
  const nova: Tab = {
    id: idLivre(config, padrao.label),
    label: padrao.label,
    icon: padrao.icon,
    type: tipo,
    badge: tipo === 'cart' ? 'cart_count' : tipo === 'notifications' ? 'unread' : 'none',
    ...(padrao.url === undefined ? {} : { url: padrao.url }),
  };

  const proxima = clonar(config);
  proxima.tabs = [...proxima.tabs, nova];
  return proxima;
}

export function removerAba(config: AppConfig, id: string): AppConfig {
  if (!podeRemoverAba(config)) return config;
  const restantes = config.tabs.filter((aba) => aba.id !== id);
  if (restantes.length === config.tabs.length) return config;

  const proxima = clonar(config);
  proxima.tabs = restantes;
  return proxima;
}

/** Move uma aba de posição. Fora dos limites, devolve a config intacta. */
export function moverAba(config: AppConfig, de: number, para: number): AppConfig {
  const total = config.tabs.length;
  if (de < 0 || de >= total || para < 0 || para >= total || de === para) return config;

  const proxima = clonar(config);
  const abas = [...proxima.tabs];
  const [movida] = abas.splice(de, 1);
  if (movida === undefined) return config;
  abas.splice(para, 0, movida);
  proxima.tabs = abas;
  return proxima;
}

/** Altera campos de uma aba, mantendo o resto. */
export function editarAba(config: AppConfig, id: string, mudancas: Partial<Tab>): AppConfig {
  const proxima = clonar(config);
  proxima.tabs = proxima.tabs.map((aba) => (aba.id === id ? { ...aba, ...mudancas } : aba));
  return proxima;
}

/** Altera uma cor do tema. */
export function editarTema(config: AppConfig, mudancas: Partial<AppConfig['theme']>): AppConfig {
  const proxima = clonar(config);
  proxima.theme = { ...proxima.theme, ...mudancas };
  return proxima;
}

export function editarWebview(
  config: AppConfig,
  mudancas: Partial<AppConfig['webview']>,
): AppConfig {
  const proxima = clonar(config);
  proxima.webview = { ...proxima.webview, ...mudancas };
  return proxima;
}

export function editarRecursos(
  config: AppConfig,
  mudancas: Partial<AppConfig['features']>,
): AppConfig {
  const proxima = clonar(config);
  proxima.features = { ...proxima.features, ...mudancas };
  return proxima;
}

// ------------------------------------------------------------- validação

export interface Problema {
  /** Seção do editor onde está o problema, para levar o lojista até lá. */
  secao: 'aparencia' | 'abas' | 'loja' | 'recursos';
  mensagem: string;
}

/**
 * Tudo que impede esta config de ir ao ar, em português.
 *
 * Vai além do schema de propósito: o Zod recusa id repetido, mas não avisa que
 * duas abas com o mesmo rótulo deixam a barra confusa, nem que um seletor com
 * chaves é CSS livre disfarçado.
 */
export function validarConfig(config: AppConfig): Problema[] {
  const problemas: Problema[] = [];

  const analise = safeParseAppConfig(config);
  if (!analise.success) {
    for (const questao of analise.error.issues) {
      problemas.push({
        secao: secaoDoCaminho(questao.path),
        mensagem: mensagemDoProblema(questao),
      });
    }
  }

  const rotulos = config.tabs.map((aba) => aba.label.trim().toLowerCase());
  if (new Set(rotulos).size !== rotulos.length) {
    problemas.push({
      secao: 'abas',
      mensagem: 'Duas abas estão com o mesmo nome. O cliente não saberia qual é qual.',
    });
  }

  for (const aba of config.tabs) {
    if (aba.type === 'webview' && (aba.url ?? '').trim() === '') {
      problemas.push({
        secao: 'abas',
        mensagem: `A aba "${aba.label}" é uma página da loja e precisa de um endereço.`,
      });
    }
  }

  for (const seletor of config.webview.hideSelectors) {
    if (seletor.includes('{') || seletor.includes('}')) {
      problemas.push({
        secao: 'loja',
        mensagem: `O item "${seletor}" não é um seletor. Para escrever CSS, use o campo de CSS.`,
      });
    }
  }

  if (config.features.appBanner.enabled && config.features.appBanner.text.trim() === '') {
    problemas.push({
      secao: 'recursos',
      mensagem: 'O banner está ligado, mas sem texto. Escreva o que ele deve dizer.',
    });
  }

  for (const slide of config.features.onboardingSlides) {
    if (slide.title.trim() === '' || slide.body.trim() === '') {
      problemas.push({
        secao: 'recursos',
        mensagem: 'Um slide de boas-vindas está sem título ou sem texto.',
      });
    }
  }

  return problemas;
}

function secaoDoCaminho(caminho: readonly PropertyKey[]): Problema['secao'] {
  const primeiro = String(caminho[0] ?? '');
  if (primeiro === 'theme') return 'aparencia';
  if (primeiro === 'tabs') return 'abas';
  if (primeiro === 'features') return 'recursos';
  return 'loja';
}

/**
 * Como o problema aparece para o lojista.
 *
 * Traduzido pelo CÓDIGO e pelo caminho do erro, e nunca pelo texto em inglês
 * que o Zod produz: aquele texto muda de forma entre versões — entre a 3 e a 4
 * "at most 12" virou "Too big: expected string to have <=12 characters" — e uma
 * comparação de string quebraria em silêncio, deixando o inglês vazar para a
 * tela do lojista numa atualização de dependência.
 */
interface QuestaoDeValidacao {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}

/** Nome de cada campo como o lojista o conhece na tela. */
const NOME_DO_CAMPO: Record<string, string> = {
  primary: 'a cor principal',
  background: 'a cor de fundo',
  text: 'a cor do texto',
  tabBarBg: 'a cor da barra de abas',
  tabBarActive: 'a cor da aba ativa',
  tabBarInactive: 'a cor da aba inativa',
  statusBar: 'o estilo da barra de status',
  label: 'o nome da aba',
  icon: 'o ícone da aba',
  url: 'o endereço da aba',
  id: 'o identificador da aba',
  type: 'o tipo da aba',
  badge: 'o selo da aba',
  hideSelectors: 'a lista de itens escondidos',
  customCss: 'o CSS personalizado',
  customJs: 'o JavaScript personalizado',
  name: 'o nome da loja',
  domains: 'os domínios da loja',
};

function mensagemDoProblema(questao: QuestaoDeValidacao): string {
  const caminho = questao.path.map((parte) => String(parte));
  const campo = caminho[caminho.length - 1] ?? '';
  const emAbas = caminho[0] === 'tabs';
  const nivelDaLista = emAbas && caminho.length === 1;

  if (nivelDaLista && questao.code === 'too_small') {
    return `O app precisa de pelo menos ${String(MIN_ABAS)} abas para a barra parecer nativa.`;
  }
  if (nivelDaLista && questao.code === 'too_big') {
    return `A barra cabe no máximo ${String(MAX_ABAS)} abas.`;
  }
  if (campo === 'label' && questao.code === 'too_big') {
    return 'O nome da aba passa de 12 caracteres e seria cortado na barra.';
  }
  if (campo === 'label' && questao.code === 'too_small') {
    return 'A aba precisa de um nome para aparecer na barra.';
  }

  /*
   * Mensagem escrita por nós no schema (as de cor e de identificador) já vem em
   * português; qualquer outra é texto do Zod e não pode chegar à tela.
   */
  if (/[áàâãéêíóôõúç]/i.test(questao.message)) return questao.message;

  const nome = NOME_DO_CAMPO[campo] ?? 'um dos campos';
  return `Confira ${nome}: o valor informado não é aceito.`;
}
