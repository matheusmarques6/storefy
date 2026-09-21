/**
 * O que a tela de Integrações (C14) mostra sobre a Shopify.
 *
 * Puro de propósito: é a decisão de "o que o lojista está vendo" separada de
 * quem busca o dado. A tela é um componente de cliente, então nada aqui pode
 * importar `server-only` nem `node:crypto`.
 */
import { normalizarDominio } from '@/lib/shopify';

export type EstadoDaShopify =
  /** A organização ainda não tem loja: não há o que conectar. */
  | 'sem_loja'
  | 'desconectada'
  | 'conectada'
  /** Conectada, mas o lojista concedeu menos do que pedimos. */
  | 'escopos_faltando';

/** Por qual caminho a loja conectou. */
export type CaminhoDaConexao = 'oauth' | 'manual';

export interface SituacaoDaShopify {
  estado: EstadoDaShopify;
  /** O domínio já conhecido, para preencher o campo na reconexão. */
  dominio: string;
  /** Escopos que pedimos e não vieram. Vazio quando está tudo certo. */
  faltando: string[];
  /** Escopos concedidos, na ordem em que a Shopify devolveu. */
  concedidos: string[];
  /** Como conectou. `null` quando não está conectada. */
  caminho: CaminhoDaConexao | null;
  /** Client ID do app do lojista, quando o caminho é o manual. */
  clientId: string | null;
  /**
   * O app público da Storefy está pronto?
   *
   * Separado de `estado` de propósito: mesmo sem ele, a tela continua
   * oferecendo o caminho manual, que é o que funciona hoje. Antes, um app
   * público não configurado desligava a tela inteira.
   */
  oauthDisponivel: boolean;
}

export interface DadosDaShopify {
  configurado: boolean;
  temLoja: boolean;
  shopDomain: string | null;
  /** `null` quando a loja nunca conectou; a coluna anda junto com o token. */
  escopos: string[] | null;
  escoposPedidos: string;
  caminho: CaminhoDaConexao | null;
  clientId: string | null;
}

/**
 * Em que pé está a conexão desta loja?
 *
 * O sinal de "conectada" é `shopify_scopes`, e não o token: a coluna do token
 * é invisível para o painel por `grant` de coluna, e as duas são gravadas e
 * apagadas juntas — na conexão, na desconexão e no `app/uninstalled`.
 */
export function situacaoDaShopify(dados: DadosDaShopify): SituacaoDaShopify {
  const dominio = dados.shopDomain ?? '';
  const concedidos = (dados.escopos ?? []).map((escopo) => escopo.trim()).filter((e) => e !== '');
  const base = {
    dominio,
    caminho: dados.caminho,
    clientId: dados.clientId,
    oauthDisponivel: dados.configurado,
  };

  /*
   * Sem loja vem ANTES do app público: "cadastre uma loja" é o passo que
   * realmente falta, e dizer "em preparação" a quem nem loja tem mandaria a
   * pessoa esperar por algo que não a destravaria.
   *
   * E `nao_configurado` deixou de ser um estado da tela: o caminho manual não
   * depende do app público, então uma loja sem OAuth disponível é uma loja
   * simplesmente desconectada, com um caminho a menos para conectar.
   */
  if (!dados.temLoja) return { ...base, estado: 'sem_loja', faltando: [], concedidos };
  if (dados.escopos === null) {
    return { ...base, estado: 'desconectada', faltando: [], concedidos };
  }

  const faltando = listarFaltantes(dados.escoposPedidos, concedidos);
  return {
    ...base,
    estado: faltando.length > 0 ? 'escopos_faltando' : 'conectada',
    faltando,
    concedidos,
  };
}

/** Escopos pedidos que não vieram na resposta da Shopify. */
function listarFaltantes(pedidos: string, concedidos: string[]): string[] {
  const tem = new Set(concedidos);
  return pedidos
    .split(',')
    .map((escopo) => escopo.trim())
    .filter((escopo) => escopo !== '' && !tem.has(escopo));
}

export type TomDoAviso = 'sucesso' | 'atencao' | 'erro';

export interface AvisoDoRetorno {
  tom: TomDoAviso;
  titulo: string;
  texto: string;
}

/**
 * O que cada código de `?shopify=` quer dizer, em pt-BR.
 *
 * As rotas de OAuth só sabem redirecionar; é aqui que o código vira frase. Um
 * código desconhecido não vira mensagem nenhuma — ele viria da barra de
 * endereço, e ecoar o que veio de lá na tela é como um XSS começa.
 */
export const AVISOS_DA_SHOPIFY: Record<string, AvisoDoRetorno> = {
  conectada: {
    tom: 'sucesso',
    titulo: 'Loja conectada',
    texto:
      'Já estamos recebendo os pedidos da sua loja. A partir de agora, dá para separar o que veio do app do que veio do site.',
  },
  parcial: {
    tom: 'atencao',
    titulo: 'Conectada, mas faltou registrar um aviso',
    texto:
      'A conexão funcionou, só que a Shopify não aceitou um dos avisos automáticos. Clique em reconectar; se continuar, fale com o suporte.',
  },
  escopos: {
    tom: 'atencao',
    titulo: 'Conectada com permissões a menos',
    texto:
      'Faltou liberar alguma permissão na tela da Shopify. Clique em reconectar e aceite todas para o app funcionar por inteiro.',
  },
  sem_loja: {
    tom: 'erro',
    titulo: 'Cadastre uma loja primeiro',
    texto: 'A conexão com a Shopify é por loja, e esta organização ainda não tem nenhuma.',
  },
  sem_permissao: {
    tom: 'erro',
    titulo: 'Você não tem permissão para isso',
    texto: 'Só o proprietário e os administradores conectam a Shopify. Peça a quem administra.',
  },
  nao_configurado: {
    tom: 'erro',
    titulo: 'A conexão ainda não está disponível',
    texto: 'A Storefy ainda está terminando de configurar o app da Shopify. Fale com o suporte.',
  },
  dominio_invalido: {
    tom: 'erro',
    titulo: 'Esse endereço não parece ser de uma loja Shopify',
    texto: 'Use o endereço que termina em .myshopify.com, como minha-loja.myshopify.com.',
  },
  retorno_invalido: {
    tom: 'erro',
    titulo: 'A autorização não pôde ser confirmada',
    texto:
      'O retorno da Shopify chegou diferente do esperado. Comece de novo por esta tela, sem usar o botão de voltar do navegador.',
  },
  token: {
    tom: 'erro',
    titulo: 'A autorização expirou',
    texto: 'A permissão da Shopify vale poucos minutos. Clique em conectar e conclua sem parar.',
  },
  desconectada: {
    tom: 'sucesso',
    titulo: 'Loja desconectada',
    texto:
      'Paramos de receber os pedidos desta loja. Os números que já estavam no painel continuam aqui.',
  },
  erro: {
    tom: 'erro',
    titulo: 'Não conseguimos concluir agora',
    texto: 'Tente de novo em alguns instantes. Se continuar, fale com o suporte.',
  },
};

export function avisoDaShopify(codigo: string | null | undefined): AvisoDoRetorno | null {
  if (codigo == null) return null;
  return AVISOS_DA_SHOPIFY[codigo] ?? null;
}

/**
 * O domínio digitado, pronto para o formulário — ou o erro a mostrar.
 *
 * O servidor confere de novo, sempre. Isto existe para o lojista corrigir na
 * hora em vez de descobrir depois de uma ida e volta à Shopify.
 */
export function conferirDominioDigitado(
  bruto: string,
): { ok: true; shop: string } | { ok: false; erro: string } {
  if (bruto.trim() === '') {
    return { ok: false, erro: 'Digite o endereço da sua loja na Shopify.' };
  }

  const shop = normalizarDominio(bruto);
  if (shop === null) {
    return {
      ok: false,
      erro: 'Use o endereço que termina em .myshopify.com, como minha-loja.myshopify.com.',
    };
  }
  return { ok: true, shop };
}

/** O nome curto de um escopo, do jeito que o lojista entende. */
export const ROTULO_DO_ESCOPO: Record<string, string> = {
  read_products: 'Ver produtos',
  read_orders: 'Ver pedidos',
  read_customers: 'Ver clientes',
  read_fulfillments: 'Ver envios',
  write_products: 'Editar produtos',
  write_orders: 'Editar pedidos',
};

export function rotuloDoEscopo(escopo: string): string {
  return ROTULO_DO_ESCOPO[escopo] ?? escopo;
}
