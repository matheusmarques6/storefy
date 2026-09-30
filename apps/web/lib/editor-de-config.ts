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
import { mesmoDominio } from '@storefy/bridge';
import type { AppConfig, Tab } from '@storefy/config-schema';
import { safeParseAppConfig } from '@storefy/config-schema';

export const MIN_ABAS = 2;
export const MAX_ABAS = 5;

/**
 * O aviso no topo cabe em duas linhas na faixa do app, ao lado do "fechar",
 * num celular pequeno. Mais do que isso seria cortado no meio da frase.
 */
export const MAX_TEXTO_DO_AVISO = 80;

/** As telas de boas-vindas (C06d): o schema aceita até quatro. */
export const MAX_SLIDES = 4;

/**
 * O título de um slide cabe em duas linhas da letra grande do app, e o texto
 * em umas quatro, num celular pequeno. Mais do que isso empurra o botão para
 * fora da tela — o slide não rola.
 */
export const MAX_TITULO_DO_SLIDE = 40;
export const MAX_TEXTO_DO_SLIDE = 160;

/**
 * O Supabase do desenvolvimento serve as imagens em `http://127.0.0.1`. Em
 * produção o endereço é sempre `https://`; um `localhost` numa config de
 * verdade só chegaria por fora do painel.
 */
const ENDERECO_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

type AvisoDoTopo = NonNullable<AppConfig['announcement']>;

/** Configs anteriores ao aviso não têm o campo: é o mesmo que desligado. */
export function avisoDaConfig(config: AppConfig): AvisoDoTopo {
  return config.announcement ?? { enabled: false, text: '' };
}

/** Cada tipo de aba entra com um rótulo e um ícone que já fazem sentido. */
export const PADRAO_POR_TIPO: Record<Tab['type'], { label: string; icon: string; url?: string }> = {
  webview: { label: 'Página', icon: 'grid', url: '/' },
  search: { label: 'Buscar', icon: 'search' },
  cart: { label: 'Carrinho', icon: 'shopping-bag' },
  account: { label: 'Conta', icon: 'user' },
  notifications: { label: 'Avisos', icon: 'bell' },
};

/**
 * O número que cada tipo de aba sabe mostrar sobre o ícone (C06b): o
 * carrinho conta os itens, a caixa de avisos conta os não lidos. Os outros
 * tipos não têm o que contar — e um número ali seria inventado.
 */
export const BADGE_DO_TIPO: Partial<Record<Tab['type'], Exclude<Tab['badge'], 'none'>>> = {
  cart: 'cart_count',
  notifications: 'unread',
};

/** Liga ou desliga o número sobre o ícone, quando o tipo da aba tem um. */
export function mostrarNumeroDaAba(config: AppConfig, id: string, ligado: boolean): AppConfig {
  const aba = config.tabs.find((item) => item.id === id);
  const badge = aba === undefined ? undefined : BADGE_DO_TIPO[aba.type];
  if (badge === undefined) return config;
  return editarAba(config, id, { badge: ligado ? badge : 'none' });
}

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

/**
 * Por onde o cliente chega aos Ajustes do app (M12) — o mesmo critério do
 * app: a engrenagem da caixa de avisos (que só existe com push) ou, sem ela,
 * a linha no topo da aba Conta.
 *
 * `null` é um app sem caminho: o cliente não tem onde desligar as
 * notificações dentro do app (diretriz 4.5.4 da Apple) nem onde ler a
 * política de privacidade (5.1.1).
 */
export function entradaDosAjustes(
  config: AppConfig,
  recursos: { push: boolean },
): 'avisos' | 'conta' | null {
  if (recursos.push && config.tabs.some((aba) => aba.type === 'notifications')) return 'avisos';
  if (config.tabs.some((aba) => aba.type === 'account')) return 'conta';
  return null;
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
    badge: BADGE_DO_TIPO[tipo] ?? 'none',
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

/**
 * Liga, desliga ou muda o aviso no topo (C06e). Link apagado sai da config,
 * em vez de ficar como texto vazio que o app teria de adivinhar.
 */
export function editarAviso(config: AppConfig, mudancas: Partial<AvisoDoTopo>): AppConfig {
  const proxima = clonar(config);
  const aviso: AvisoDoTopo = { ...avisoDaConfig(proxima), ...mudancas };
  if (aviso.url?.trim() === '') delete aviso.url;
  proxima.announcement = aviso;
  return proxima;
}

/**
 * O link do aviso é um endereço DA LOJA — caminho (`/collections/promo`) ou
 * URL inteira de um domínio dela. O app só abre esses: um aviso escrito num
 * painel levando a um site qualquer, sem barra de endereço e com o nome da
 * loja em volta, seria uma tela de phishing pronta.
 */
export function linkDaLoja(link: string, loja: AppConfig['store']): boolean {
  let alvo: URL;
  try {
    alvo = new URL(link.trim(), loja.url);
  } catch {
    return false;
  }
  if (alvo.protocol !== 'https:' && alvo.protocol !== 'http:') return false;
  return [loja.url, ...loja.domains].some((entrada) => {
    try {
      const host = new URL(entrada.includes('://') ? entrada : `https://${entrada}`).hostname;
      return mesmoDominio(alvo.hostname, host);
    } catch {
      return false;
    }
  });
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

  config.features.onboardingSlides.forEach((slide, indice) => {
    const tela = `tela de boas-vindas ${String(indice + 1)}`;
    const titulo = slide.title.trim();
    const texto = slide.body.trim();
    if (titulo === '' || texto === '') {
      problemas.push({ secao: 'recursos', mensagem: `A ${tela} está sem título ou sem texto.` });
    }
    if (titulo.length > MAX_TITULO_DO_SLIDE) {
      problemas.push({
        secao: 'recursos',
        mensagem: `O título da ${tela} passa de ${String(MAX_TITULO_DO_SLIDE)} caracteres e não cabe na tela do celular. Encurte o título.`,
      });
    }
    if (texto.length > MAX_TEXTO_DO_SLIDE) {
      problemas.push({
        secao: 'recursos',
        mensagem: `O texto da ${tela} passa de ${String(MAX_TEXTO_DO_SLIDE)} caracteres e não cabe na tela do celular. Encurte o texto.`,
      });
    }
    /*
     * A imagem nova é sempre enviada pelo painel (`https://`). Um endereço
     * antigo, digitado à mão, pode ser `http://` — que o iPhone recusa — ou
     * nem ser um endereço: o slide sairia com um buraco no lugar da imagem.
     */
    const imagem = slide.image.trim();
    if (imagem !== '' && !imagem.startsWith('https://') && !ENDERECO_LOCAL.test(imagem)) {
      problemas.push({
        secao: 'recursos',
        mensagem: `A imagem da ${tela} não abre no app. Envie a imagem de novo.`,
      });
    }
  });

  const aviso = avisoDaConfig(config);
  if (aviso.enabled) {
    const texto = aviso.text.trim();
    if (texto === '') {
      problemas.push({
        secao: 'recursos',
        mensagem: 'O aviso no topo está ligado, mas sem texto. Escreva o que ele deve dizer.',
      });
    } else if (texto.length > MAX_TEXTO_DO_AVISO) {
      problemas.push({
        secao: 'recursos',
        mensagem: `O aviso no topo passa de ${String(MAX_TEXTO_DO_AVISO)} caracteres e seria cortado no app. Encurte o texto.`,
      });
    }
    const link = aviso.url?.trim() ?? '';
    if (link !== '' && !linkDaLoja(link, config.store)) {
      problemas.push({
        secao: 'recursos',
        mensagem:
          'O link do aviso precisa ser um endereço da sua loja, como /collections/promocao.',
      });
    }
  }

  return problemas;
}

function secaoDoCaminho(caminho: readonly PropertyKey[]): Problema['secao'] {
  const primeiro = String(caminho[0] ?? '');
  if (primeiro === 'theme') return 'aparencia';
  if (primeiro === 'tabs') return 'abas';
  if (primeiro === 'features' || primeiro === 'announcement') return 'recursos';
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
