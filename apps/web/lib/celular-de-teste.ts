/**
 * O celular de teste do lojista (C08) — o que o painel e a página pública
 * precisam saber, sem banco e sem servidor.
 *
 * O envio de teste listava os aparelhos vistos por último, e depois do
 * lançamento "testar" mandava uma notificação ainda sem revisão para o
 * celular de um cliente. Agora o lojista PAREIA o próprio celular:
 *
 *   1. o painel gera um código de uso único (10 minutos) e mostra um QR;
 *   2. o QR abre a página pública `/celular-de-teste` no navegador do
 *      celular — qualquer câmera abre um link https, e nem toda câmera do
 *      Android abre o esquema do app direto;
 *   3. a página tem o botão que abre o app da loja com o código, e o app se
 *      apresenta à Storefy (`POST /api/public/test-device`).
 *
 * O código vai no FRAGMENTO do link (`#loja=...&codigo=...`): o navegador não
 * o manda para o servidor, e ele não fica em log de acesso nenhum.
 */

/** Oito caracteres, sem os que se confundem (0 e O, 1 e I) — como o banco gera. */
export const FORMATO_DO_CODIGO = /^[A-HJ-NP-Z2-9]{8}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quanto o código vale, como o banco decide (`criar_codigo_de_teste`). */
export const MINUTOS_DO_CODIGO = 10;

/** O maior nome que o banco aceita para o celular. */
export const MAXIMO_DO_NOME = 60;

/**
 * O esquema de URL do app da loja. O MESMO de `slugDoProjeto`, que o build
 * grava no app — o teste confere que os dois não se separam.
 */
export function esquemaDoApp(storeId: string): string {
  return `storefy-${storeId}`;
}

/** O link que o QR carrega: a página pública, com a loja e o código no fragmento. */
export function linkDoQr(site: string, storeId: string, codigo: string): string {
  const parametros = new URLSearchParams({ loja: storeId, codigo });
  return `${site.replace(/\/+$/, '')}/celular-de-teste#${parametros.toString()}`;
}

/** O link que a página abre: o app da loja, na tela do pareamento. */
export function linkDoApp(storeId: string, codigo: string): string {
  return `${esquemaDoApp(storeId)}://celular-de-teste?codigo=${codigo}`;
}

/**
 * A loja e o código do fragmento, conferidos, ou `null`.
 *
 * Conferir é o que impede a página de virar um trampolim: sem isso, um link
 * com outro "esquema" faria o botão abrir qualquer coisa no celular de quem o
 * recebesse.
 */
export function lerFragmento(fragmento: string): { storeId: string; codigo: string } | null {
  const parametros = new URLSearchParams(fragmento.replace(/^#/, ''));
  const storeId = (parametros.get('loja') ?? '').trim().toLowerCase();
  const codigo = (parametros.get('codigo') ?? '').trim().toUpperCase();
  if (!UUID.test(storeId) || !FORMATO_DO_CODIGO.test(codigo)) return null;
  return { storeId, codigo };
}

/** Um celular de teste, como o painel mostra. */
export interface CelularDeTeste {
  /** O id do pareamento (`test_devices.id`), e não o do aparelho. */
  id: string;
  nome: string;
  platform: 'ios' | 'android';
  appVersion: string | null;
  lastSeenAt: string;
  /** Sem a inscrição do push, o celular está pareado mas não recebe o teste. */
  recebePush: boolean;
  pareadoEm: string;
}

/** "iPhone · versão 1.2.0 · visto há 2 min" — o suficiente para se reconhecer. */
export function descreverCelular(celular: CelularDeTeste, agoraMs: number): string {
  const sistema = celular.platform === 'ios' ? 'iPhone' : 'Android';
  const versao = celular.appVersion === null ? null : `versão ${celular.appVersion}`;
  return [sistema, versao, `visto ${haQuanto(celular.lastSeenAt, agoraMs)}`]
    .filter((parte) => parte !== null)
    .join(' · ');
}

export function haQuanto(iso: string, agoraMs: number): string {
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return 'em algum momento';

  const minutos = Math.floor((agoraMs - instante) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${String(minutos)} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${String(horas)} h`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${String(dias)} dias`;
}

/**
 * O celular que o QR acabou de parear, ou `null`.
 *
 * O painel não sabe qual código o app usou; sabe quando o código nasceu. O
 * celular pareado depois disso é o deste QR — novo ou pareado de novo, que
 * troca só o nome e o instante. Os dois instantes vêm do relógio do banco.
 */
export function pareadoDepoisDe(
  celulares: readonly CelularDeTeste[],
  geradoEm: string,
): CelularDeTeste | null {
  const desde = Date.parse(geradoEm);
  if (Number.isNaN(desde)) return null;
  return celulares.find((celular) => Date.parse(celular.pareadoEm) >= desde) ?? null;
}
