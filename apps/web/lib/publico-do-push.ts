/**
 * Quem recebe a campanha (C08): o público, do formulário até o filtro da
 * OneSignal.
 *
 * Mandar tudo para todo mundo é a forma mais rápida de treinar o cliente a
 * ignorar notificação. O app marca, sozinho, cada aparelho no OneSignal (ver
 * `apps/mobile/src/push/tags.ts`): se já comprou pelo app, se tem carrinho
 * aberto, quando abriu o app pela última vez. Cada público aqui é uma dessas
 * marcas, em palavras de lojista.
 *
 * O público mora em `push_campaigns.segment`, como `{ publico, dias? }`. Vazio
 * (`{}`) é todo mundo — e é o único que aparece na caixa de avisos do app,
 * que é a mesma para todos os clientes da loja.
 */

/** As marcas que o app grava no OneSignal — as mesmas de `apps/mobile/src/push/tags.ts`. */
const TAG_COMPROU = 'has_purchased';
const TAG_CARRINHO = 'cart_count';

export const TIPOS_DE_PUBLICO = [
  'todos',
  'compradores',
  'sem_compra',
  'com_carrinho',
  'inativos',
  'ativos',
] as const;

export type TipoDePublico = (typeof TIPOS_DE_PUBLICO)[number];

export type Publico =
  | { tipo: 'todos' | 'compradores' | 'sem_compra' | 'com_carrinho' }
  | { tipo: 'inativos' | 'ativos'; dias: number };

export const DIAS_MINIMOS = 1;
export const DIAS_MAXIMOS = 365;

/** O prazo que já vem sugerido em cada público com dias. */
export const DIAS_SUGERIDOS: Record<'inativos' | 'ativos', number> = {
  inativos: 14,
  ativos: 7,
};

export const ROTULO_DO_PUBLICO: Record<TipoDePublico, string> = {
  todos: 'Todos que aceitaram notificações',
  compradores: 'Quem já comprou pelo app',
  sem_compra: 'Quem ainda não comprou pelo app',
  com_carrinho: 'Quem está com o carrinho aberto',
  inativos: 'Quem não abre o app há alguns dias',
  ativos: 'Quem abriu o app nos últimos dias',
};

export const EXPLICACAO_DO_PUBLICO: Record<TipoDePublico, string> = {
  todos: 'Chega em todos os aparelhos com o app e as notificações ligadas.',
  compradores: 'Bom para lançamento, reposição e programa de fidelidade.',
  sem_compra: 'Bom para o cupom de primeira compra.',
  com_carrinho: 'Quem deixou produto no carrinho e ainda não finalizou.',
  inativos: 'Para chamar de volta quem sumiu.',
  ativos: 'Quem anda olhando a loja: bom para novidade e oferta relâmpago.',
};

function ehTipo(valor: unknown): valor is TipoDePublico {
  return typeof valor === 'string' && (TIPOS_DE_PUBLICO as readonly string[]).includes(valor);
}

function precisaDeDias(tipo: TipoDePublico): tipo is 'inativos' | 'ativos' {
  return tipo === 'inativos' || tipo === 'ativos';
}

/** Como o público aparece numa frase: "Quem não abre o app há 14 dias". */
export function descricaoDoPublico(publico: Publico): string {
  if (publico.tipo === 'inativos') {
    return `Quem não abre o app há ${String(publico.dias)} ${publico.dias === 1 ? 'dia' : 'dias'}`;
  }
  if (publico.tipo === 'ativos') {
    return publico.dias === 1
      ? 'Quem abriu o app nas últimas 24 horas'
      : `Quem abriu o app nos últimos ${String(publico.dias)} dias`;
  }
  return ROTULO_DO_PUBLICO[publico.tipo];
}

/**
 * O público guardado na campanha. Qualquer coisa que não seja um público
 * conhecido volta como "todos" — é o que a campanha de fato fez: sem filtro
 * que dê para traduzir, a OneSignal manda para todo mundo.
 */
export function publicoDoSegmento(segmento: unknown): Publico {
  if (segmento === null || typeof segmento !== 'object' || Array.isArray(segmento)) {
    return { tipo: 'todos' };
  }
  const bruto = segmento as { publico?: unknown; dias?: unknown };
  if (!ehTipo(bruto.publico) || bruto.publico === 'todos') return { tipo: 'todos' };
  if (!precisaDeDias(bruto.publico)) return { tipo: bruto.publico };

  const dias = typeof bruto.dias === 'number' ? bruto.dias : Number.NaN;
  if (!Number.isInteger(dias) || dias < DIAS_MINIMOS || dias > DIAS_MAXIMOS) {
    return { tipo: 'todos' };
  }
  return { tipo: bruto.publico, dias };
}

/** O que vai para `push_campaigns.segment`. Todos é `{}`, como sempre foi. */
export function segmentoDoPublico(publico: Publico): Record<string, string | number> {
  if (publico.tipo === 'todos') return {};
  if (publico.tipo === 'inativos' || publico.tipo === 'ativos') {
    return { publico: publico.tipo, dias: publico.dias };
  }
  return { publico: publico.tipo };
}

/**
 * O público escolhido no formulário, conferido. `dias` chega como texto do
 * campo e só conta nos públicos que perguntam por ele.
 */
export function lerPublico(
  tipo: string,
  dias: string,
): { ok: true; publico: Publico } | { ok: false; mensagem: string } {
  if (!ehTipo(tipo)) return { ok: false, mensagem: 'Escolha quem recebe a campanha.' };
  if (!precisaDeDias(tipo)) return { ok: true, publico: { tipo } };

  const texto = dias.trim();
  const numero = /^\d+$/.test(texto) ? Number(texto) : Number.NaN;
  if (!Number.isInteger(numero) || numero < DIAS_MINIMOS || numero > DIAS_MAXIMOS) {
    return {
      ok: false,
      mensagem: `Diga quantos dias, de ${String(DIAS_MINIMOS)} a ${String(DIAS_MAXIMOS)}.`,
    };
  }
  return { ok: true, publico: { tipo, dias: numero } };
}

/**
 * O filtro da OneSignal para o público. `null` é "todos os inscritos".
 *
 * Os campos são os da API de notificações da OneSignal: `tag` compara a marca
 * que o app gravou; `last_session` com `hours_ago` compara a última vez que o
 * app foi aberto — ">" é "há MAIS de N horas" (sumiu), "<" é "há MENOS" (ativo).
 */
export function filtrosDoPublico(publico: Publico): Record<string, string>[] | null {
  switch (publico.tipo) {
    case 'todos':
      return null;
    case 'compradores':
      return [{ field: 'tag', key: TAG_COMPROU, relation: '=', value: 'true' }];
    case 'sem_compra':
      return [{ field: 'tag', key: TAG_COMPROU, relation: 'not_exists' }];
    case 'com_carrinho':
      return [{ field: 'tag', key: TAG_CARRINHO, relation: '>', value: '0' }];
    case 'inativos':
      return [{ field: 'last_session', relation: '>', hours_ago: String(publico.dias * 24) }];
    case 'ativos':
      return [{ field: 'last_session', relation: '<', hours_ago: String(publico.dias * 24) }];
  }
}
