/**
 * Data e hora no fuso CERTO — o da loja, e não o do servidor.
 *
 * O DEFEITO QUE ISTO CORRIGE, provado com dado real: o lojista agendava uma
 * campanha para 20:00 e ela saía às 17:00. O campo `datetime-local` manda
 * "2026-09-30T20:00" SEM fuso; a ação do servidor fazia `new Date(texto)`, e o
 * JavaScript interpreta string sem fuso no fuso DO PROCESSO — UTC na Vercel.
 * 20:00 UTC são 17:00 em Brasília. A tela de edição convertia de volta também
 * em UTC, mostrando "20:00" de novo, e o erro ficava invisível dos dois lados.
 *
 * A EXIBIÇÃO TINHA O MESMO PROBLEMA, em dezessete lugares: `toLocaleString`
 * sem `timeZone` no servidor mostra hora UTC. Em componente de cliente era
 * pior — o servidor renderizava em UTC e o navegador hidratava no fuso local,
 * trocando o texto na frente do usuário.
 *
 * O FUSO É O DA LOJA porque a hora de um push é a hora dos clientes DELA. É a
 * mesma coluna que o silêncio noturno e o fechamento do dia no analytics já
 * usam no banco; o painel era o único que ignorava.
 */

/** O fuso de quem não disse outro: o da maioria das lojas, e o padrão do banco. */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** O fuso, se o `Intl` o conhece; senão, o padrão. Fuso inválido não derruba tela. */
export function fusoValido(fuso: string | null | undefined): string {
  if (fuso == null || fuso === '') return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/** Quanto o fuso está À FRENTE do UTC no instante dado, em ms (negativo no Brasil). */
function deslocamento(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instante));

  const valor = (tipo: Intl.DateTimeFormatPartTypes): number =>
    Number(partes.find((parte) => parte.type === tipo)?.value ?? '0');

  const relogioComoUtc = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
    valor('second'),
  );
  // Os milissegundos não passam pelo `formatToParts`; tirá-los dos dois lados
  // evita um deslocamento fantasma de até 999 ms.
  return relogioComoUtc - (instante - (instante % 1000));
}

/**
 * O instante UTC de uma hora de relógio NAQUELE fuso.
 *
 * "2026-09-30T20:00" em `America/Sao_Paulo` → 2026-09-30T23:00Z.
 *
 * A conta é feita duas vezes de propósito: no fuso com horário de verão, o
 * deslocamento no palpite ingênuo pode ser o do outro lado da virada. A
 * segunda passada usa o deslocamento do instante já corrigido.
 *
 * Devolve `null` para texto fora do formato ou para data que não existe
 * (31 de fevereiro), em vez de deixar o `Date` rolar para março calado.
 */
export function instanteDaHoraLocal(texto: string, fuso: string): Date | null {
  const achado = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto.trim());
  if (achado == null) return null;

  const [ano, mes, dia, hora, minuto, segundo] = achado
    .slice(1)
    // O grupo dos segundos é opcional: sem ele, o `exec` devolve `undefined`
    // ali, embora o tipo diga `string`.
    .map((parte: string | undefined) => (parte === undefined ? 0 : Number(parte))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const ingenuo = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo);
  const conferido = new Date(ingenuo);
  if (
    conferido.getUTCFullYear() !== ano ||
    conferido.getUTCMonth() !== mes - 1 ||
    conferido.getUTCDate() !== dia ||
    conferido.getUTCHours() !== hora ||
    conferido.getUTCMinutes() !== minuto
  ) {
    return null;
  }

  const zona = fusoValido(fuso);
  const primeiro = ingenuo - deslocamento(ingenuo, zona);
  return new Date(ingenuo - deslocamento(primeiro, zona));
}

/**
 * Um instante UTC no formato do `datetime-local` ("AAAA-MM-DDTHH:mm"), no fuso.
 *
 * É o caminho de volta de `instanteDaHoraLocal`, para a tela de edição
 * mostrar a mesma hora que o lojista escolheu.
 */
export function paraCampoLocal(iso: string | null | undefined, fuso: string): string {
  if (iso == null || iso === '') return '';
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return '';

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fusoValido(fuso),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instante));

  const valor = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? '00';

  return `${valor('year')}-${valor('month')}-${valor('day')}T${valor('hour')}:${valor('minute')}`;
}

type Entrada = string | number | Date | null | undefined;

function paraData(valor: Entrada): Date | null {
  if (valor == null || valor === '') return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** "30/09/2026, 20:00" no fuso. `—` para vazio ou inválido. */
export function formatarDataHora(
  valor: Entrada,
  fuso: string,
  estilo: { dateStyle?: 'short' | 'medium' | 'long'; timeStyle?: 'short' | 'medium' } = {
    dateStyle: 'short',
    timeStyle: 'short',
  },
): string {
  const data = paraData(valor);
  if (data == null) return '—';
  return data.toLocaleString('pt-BR', { ...estilo, timeZone: fusoValido(fuso) });
}

/** "30/09/2026" no fuso. Perto da meia-noite, o fuso decide até o DIA. */
export function formatarData(
  valor: Entrada,
  fuso: string,
  estilo: Intl.DateTimeFormatOptions = {},
): string {
  const data = paraData(valor);
  if (data == null) return '—';
  return data.toLocaleDateString('pt-BR', { ...estilo, timeZone: fusoValido(fuso) });
}

/** "20:00" no fuso. */
export function formatarHora(valor: Entrada, fuso: string): string {
  const data = paraData(valor);
  if (data == null) return '—';
  return data.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: fusoValido(fuso),
  });
}

/**
 * Os fusos do Brasil, do jeito que o lojista os conhece: pelo estado.
 *
 * São oito e não dezesseis. O banco de fusos tem uma entrada por cidade que já
 * teve regra própria — Fortaleza, Recife, Belém, Salvador… —, e hoje todas
 * andam juntas com Brasília. Mostrar as dezesseis faria o lojista de Recife
 * procurar a própria cidade e desconfiar da escolha de "Brasília".
 *
 * A ORDEM IMPORTA: Brasília primeiro, porque é o fuso de quase todo mundo.
 */
const FUSOS_DO_BRASIL: readonly { valor: string; regiao: string; nome: string }[] = [
  {
    valor: 'America/Sao_Paulo',
    // Curto de propósito: no celular o seletor corta o texto, e "horário de
    // Brasília" todo brasileiro reconhece sem a lista de estados.
    regiao: 'Horário de Brasília',
    nome: 'horário de Brasília',
  },
  { valor: 'America/Manaus', regiao: 'Amazonas', nome: 'horário do Amazonas' },
  { valor: 'America/Cuiaba', regiao: 'Mato Grosso', nome: 'horário de Mato Grosso' },
  {
    valor: 'America/Campo_Grande',
    regiao: 'Mato Grosso do Sul',
    nome: 'horário de Mato Grosso do Sul',
  },
  { valor: 'America/Porto_Velho', regiao: 'Rondônia', nome: 'horário de Rondônia' },
  { valor: 'America/Boa_Vista', regiao: 'Roraima', nome: 'horário de Roraima' },
  { valor: 'America/Rio_Branco', regiao: 'Acre', nome: 'horário do Acre' },
  {
    valor: 'America/Noronha',
    regiao: 'Fernando de Noronha',
    nome: 'horário de Fernando de Noronha',
  },
];

/**
 * As outras cidades brasileiras do banco de fusos. Hoje todas andam junto com
 * um dos oito acima, e por isso a tela não as oferece — mas uma loja pode já
 * ter uma delas gravada, e ela continua sendo lida com o nome que o lojista
 * reconhece, em vez de virar "America/Recife".
 *
 * `Map` e não objeto: `'constructor' in {}` é verdade, e o fuso vem do banco.
 */
const OUTRAS_CIDADES_DO_BRASIL: ReadonlyMap<string, { cidade: string; nome: string }> = new Map([
  ['America/Araguaina', { cidade: 'Araguaína', nome: 'horário de Araguaína' }],
  ['America/Bahia', { cidade: 'Salvador', nome: 'horário de Salvador' }],
  ['America/Belem', { cidade: 'Belém', nome: 'horário de Belém' }],
  ['America/Eirunepe', { cidade: 'Oeste do Amazonas', nome: 'horário do oeste do Amazonas' }],
  ['America/Fortaleza', { cidade: 'Fortaleza', nome: 'horário de Fortaleza' }],
  ['America/Maceio', { cidade: 'Maceió', nome: 'horário de Maceió' }],
  ['America/Recife', { cidade: 'Recife', nome: 'horário de Recife' }],
  ['America/Santarem', { cidade: 'Santarém', nome: 'horário de Santarém' }],
]);

/** Nomes que o `Intl` diz de um jeito que o lojista não usaria. */
const NOMES_PROPRIOS: ReadonlyMap<string, string> = new Map([
  ['Europe/Lisbon', 'horário de Lisboa'],
  ['UTC', 'horário UTC'],
]);

function ehDoBrasil(fuso: string): boolean {
  return FUSOS_DO_BRASIL.some((item) => item.valor === fuso) || OUTRAS_CIDADES_DO_BRASIL.has(fuso);
}

/**
 * Todo fuso que a loja pode escolher.
 *
 * É a lista do próprio `Intl` — a mesma base que converte as horas —, e não
 * uma lista nossa: um fuso que o `Intl` não conhece seria aceito no cadastro e
 * cairia no padrão na hora de converter, calado. O `UTC` entra à mão porque o
 * `Intl` só lista fusos de lugares.
 */
export function fusosDisponiveis(): readonly string[] {
  return [...Intl.supportedValuesOf('timeZone'), 'UTC'];
}

/**
 * O fuso, se ele é um dos que a tela oferece; senão `null`.
 *
 * Mais estrito que `fusoValido` de propósito. Aquele serve para LER — um fuso
 * estranho no banco não pode derrubar a tela. Este serve para GRAVAR, e o que
 * se grava precisa ser exatamente um nome da lista: o `Intl` também aceita
 * "america/sao_paulo" e "EST", que o banco trataria diferente.
 */
export function fusoAceito(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (texto === '') return null;
  return fusosDisponiveis().includes(texto) ? texto : null;
}

/** "1 hora a menos que Brasília", pelo deslocamento de AGORA. */
function diferencaParaBrasilia(fuso: string, agoraMs: number): string {
  const horas = Math.round(
    (deslocamento(agoraMs, fuso) - deslocamento(agoraMs, FUSO_PADRAO)) / 3_600_000,
  );
  if (horas === 0) return 'mesmo horário de Brasília';
  const quantas = Math.abs(horas) === 1 ? '1 hora' : `${String(Math.abs(horas))} horas`;
  return `${quantas} a ${horas < 0 ? 'menos' : 'mais'} que Brasília`;
}

export interface OpcaoDeFuso {
  valor: string;
  rotulo: string;
}

export interface GrupoDeFusos {
  rotulo: string;
  opcoes: OpcaoDeFuso[];
}

/**
 * As opções do seletor de fuso, em dois grupos: o Brasil pelos estados, e o
 * resto do mundo pelo nome oficial do fuso.
 *
 * A diferença para Brasília é calculada na hora, e não escrita à mão: se o
 * horário de verão voltar, "1 hora a menos" passa a ser verdade só em parte do
 * ano, e o texto precisa acompanhar.
 *
 * `atual` entra na lista mesmo que ela não o ofereça — uma loja gravada com
 * "America/Recife" antes deste seletor existir abriria o formulário com o
 * primeiro item marcado, e salvar qualquer outra coisa trocaria o fuso dela
 * sem ninguém ter pedido.
 */
export function gruposDeFusos(atual: string, agoraMs: number = Date.now()): GrupoDeFusos[] {
  const brasil: OpcaoDeFuso[] = FUSOS_DO_BRASIL.map(({ valor, regiao }) => ({
    valor,
    rotulo: valor === FUSO_PADRAO ? regiao : `${regiao} (${diferencaParaBrasilia(valor, agoraMs)})`,
  }));

  const cidadeAtual = OUTRAS_CIDADES_DO_BRASIL.get(atual);
  if (cidadeAtual !== undefined) {
    brasil.push({
      valor: atual,
      rotulo: `${cidadeAtual.cidade} (${diferencaParaBrasilia(atual, agoraMs)})`,
    });
  }

  const outros: OpcaoDeFuso[] = fusosDisponiveis()
    .filter((valor) => !ehDoBrasil(valor))
    .map((valor) => ({ valor, rotulo: rotuloDoFuso(valor, agoraMs) }));

  const grupos: GrupoDeFusos[] = [
    { rotulo: 'Brasil', opcoes: brasil },
    { rotulo: 'Outros países', opcoes: outros },
  ];

  const oferecido = grupos.some((grupo) => grupo.opcoes.some((opcao) => opcao.valor === atual));
  if (!oferecido && atual !== '') {
    grupos.unshift({ rotulo: 'Fuso gravado', opcoes: [{ valor: atual, rotulo: atual }] });
  }

  return grupos;
}

/** "Europe/Lisbon — Horário da Europa Ocidental". */
function rotuloDoFuso(fuso: string, agoraMs: number): string {
  if (fuso === 'UTC') return 'UTC — tempo universal';
  const nome = nomeGenerico(fuso, agoraMs);
  return nome === null ? fuso : `${fuso} — ${nome}`;
}

/**
 * O nome do fuso em português, pelo `Intl` ("Horário da Europa Ocidental").
 *
 * `null` quando o `Intl` só sabe dizer o deslocamento ("GMT+03:00"): isso não
 * é um nome, e repetir o número ao lado do fuso não ajuda ninguém.
 */
function nomeGenerico(fuso: string, agoraMs: number): string | null {
  try {
    const nome = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, timeZoneName: 'longGeneric' })
      .formatToParts(new Date(agoraMs))
      .find((parte) => parte.type === 'timeZoneName')?.value;
    if (nome === undefined || nome.startsWith('GMT')) return null;
    return nome;
  } catch {
    return null;
  }
}

/**
 * O nome do fuso para mostrar ao lojista, ao lado do campo de horário.
 *
 * Sem isso ele não tem como saber em que hora está agendando — e é essa
 * dúvida que faz alguém marcar 23:00 "para compensar" um fuso que já estava
 * certo.
 */
export function nomeDoFuso(fuso: string, agoraMs: number = Date.now()): string {
  const zona = fusoValido(fuso);

  const conhecido =
    FUSOS_DO_BRASIL.find((item) => item.valor === zona)?.nome ??
    OUTRAS_CIDADES_DO_BRASIL.get(zona)?.nome ??
    NOMES_PROPRIOS.get(zona);
  if (conhecido !== undefined) return conhecido;

  // "Horário Padrão do Japão" → "horário padrão do Japão": o nome entra no
  // meio da frase, ao lado do campo. Só as duas palavras do começo descem;
  // "Japão" e "Europa Ocidental" são nomes próprios.
  const generico = nomeGenerico(zona, agoraMs);
  if (generico === null) return `fuso ${zona}`;
  return generico.replace(/^Horário Padrão\b/, 'horário padrão').replace(/^Horário\b/, 'horário');
}
