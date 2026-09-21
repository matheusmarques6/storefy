/**
 * O rascunho da ficha do app nas lojas (seção 7 do plano).
 *
 * A App Store Connect e o Play Console pedem meia dúzia de textos com limites
 * de caractere diferentes, e cada um deles é um campo que o lojista trava
 * olhando. O rascunho existe para ele começar de algo pronto, em português, no
 * tamanho certo — e depois trocar as palavras que quiser.
 *
 * TUDO AQUI SAI DE DADO REAL DA LOJA: o nome que ela escolheu, o endereço
 * dela, se o app manda notificação. Não há número inventado, não há "Lorem
 * ipsum", não há promessa que o app não cumpre — texto de ficha que promete o
 * que o app não faz é motivo de recusa na revisão.
 */

/** Limites que as duas lojas de aplicativos impõem, em caracteres. */
export const LIMITES = {
  /** App Store: nome do app. */
  titulo: 30,
  /** App Store: subtítulo, logo abaixo do nome. */
  subtitulo: 30,
  /** Play Store: título curto. */
  tituloPlay: 30,
  /** Play Store: descrição curta, a que aparece na lista. */
  descricaoCurta: 80,
  /** App Store: palavras-chave, separadas por vírgula. */
  palavrasChave: 100,
  /** App Store e Play Store: descrição completa. */
  descricao: 4000,
} as const;

export interface DadosDaFicha {
  nomeDaLoja: string;
  urlDaLoja: string;
  pushLigado: boolean;
}

export interface CampoDaFicha {
  chave: string;
  rotulo: string;
  /** Onde este texto é colado. */
  onde: string;
  valor: string;
  limite: number;
}

export function montarFicha(dados: DadosDaFicha): CampoDaFicha[] {
  const loja = dados.nomeDaLoja.trim() === '' ? 'Sua loja' : dados.nomeDaLoja.trim();
  const dominio = dominioDe(dados.urlDaLoja);

  const beneficios = [
    'Navegue pela loja inteira com a rapidez de um app.',
    'Guarde seu carrinho e volte a ele quando quiser.',
    'Finalize a compra com o mesmo login e os mesmos endereços do site.',
  ];
  if (dados.pushLigado) {
    beneficios.push('Receba avisos de novidades, promoções e do andamento do seu pedido.');
  }

  const descricao = [
    `O app da ${loja} é o jeito mais rápido de comprar na ${dominio}.`,
    '',
    ...beneficios.map((linha) => `• ${linha}`),
    '',
    'Tudo o que você já conhece da loja, agora na tela inicial do seu celular.',
    '',
    `Dúvidas sobre um pedido? Fale com a ${loja} pelos mesmos canais de sempre.`,
  ].join('\n');

  return [
    {
      chave: 'titulo',
      rotulo: 'Nome do app',
      onde: 'App Store e Play Store',
      valor: cortar(loja, LIMITES.titulo),
      limite: LIMITES.titulo,
    },
    {
      chave: 'subtitulo',
      rotulo: 'Subtítulo',
      onde: 'App Store',
      valor: cortar('Compre pelo app, do seu jeito', LIMITES.subtitulo),
      limite: LIMITES.subtitulo,
    },
    {
      chave: 'descricaoCurta',
      rotulo: 'Descrição curta',
      onde: 'Play Store',
      valor: cortar(`O app da ${loja}: compre em poucos toques.`, LIMITES.descricaoCurta),
      limite: LIMITES.descricaoCurta,
    },
    {
      chave: 'palavrasChave',
      rotulo: 'Palavras-chave',
      onde: 'App Store',
      valor: palavrasChave(loja),
      limite: LIMITES.palavrasChave,
    },
    {
      chave: 'descricao',
      rotulo: 'Descrição completa',
      onde: 'App Store e Play Store',
      valor: cortar(descricao, LIMITES.descricao),
      limite: LIMITES.descricao,
    },
  ];
}

/**
 * As palavras-chave da App Store.
 *
 * Separadas por vírgula SEM espaço: o espaço conta no limite de 100
 * caracteres, e a Apple ignora espaços na busca. Repetir o nome do app aqui
 * também é desperdício — ele já é indexado pelo campo do nome.
 */
export function palavrasChave(nomeDaLoja: string): string {
  const doNome = nomeDaLoja
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3);

  const base = ['loja', 'compras', 'pedidos', 'ofertas', 'promoções', 'carrinho', 'entrega'];
  const lista: string[] = [];

  for (const palavra of [...doNome, ...base]) {
    if (lista.includes(palavra)) continue;
    const candidata = [...lista, palavra].join(',');
    if (candidata.length > LIMITES.palavrasChave) break;
    lista.push(palavra);
  }

  return lista.join(',');
}

/** O domínio do endereço, para o texto não repetir "https://". */
export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
  }
}

/**
 * Corta no limite sem partir palavra.
 *
 * Uma descrição cortada no meio de uma palavra é o tipo de coisa que passa
 * despercebida no painel e aparece na loja de aplicativos para sempre.
 */
export function cortar(texto: string, limite: number): string {
  const limpo = texto.trim();
  if (limpo.length <= limite) return limpo;

  const pedaco = limpo.slice(0, limite);
  const ultimoEspaco = pedaco.lastIndexOf(' ');
  return (ultimoEspaco > limite * 0.6 ? pedaco.slice(0, ultimoEspaco) : pedaco).trimEnd();
}
