import 'server-only';

/**
 * "Ver como cliente" (A04): a equipe abre o painel de um cliente, SÓ PARA LER.
 *
 * POR QUE SOMENTE LEITURA, e não "entrar como" o cliente de verdade. Entrar
 * como alguém exigiria uma sessão com a identidade dele — e aí tudo que a
 * equipe fizesse ficaria na trilha como se o cliente tivesse feito, inclusive
 * publicar o app ou mandar push para os clientes DELE. Para o que o suporte
 * precisa — ver o que o lojista está vendo —, ler basta, e ler não tem como
 * dar errado em nome de ninguém.
 *
 * COMO FUNCIONA. A pessoa da equipe continua com a PRÓPRIA sessão. O painel
 * lê os dados do cliente pelas policies de sempre, que já terminam em
 * `or is_platform_admin()`; nenhuma policy de ESCRITA dá passagem à equipe
 * (conferido no `pg_policies`), então o "somente leitura" é do banco. Por
 * cima disso, o proxy recusa toda ação de formulário enquanto a visita está
 * aberta, e a tela esconde os botões de escrever.
 *
 * O TOKEN é assinado com uma chave derivada da `ENCRYPTION_KEY`, traz a
 * organização, QUEM visita e até quando, e vale para uma pessoa só: a sessão
 * que o usa precisa ser a do mesmo admin, e ele precisa continuar na equipe.
 * O convite (o link que sai do admin e abre a visita) vale 5 minutos; a
 * visita, 1 hora.
 */
import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { derivarChave, iguaisEmTempoConstante } from '@/lib/cripto';
import {
  COOKIE_VISITA,
  MOTIVO_MAXIMO_DA_VISITA,
  MOTIVO_MINIMO_DA_VISITA,
} from '@/lib/visita-nomes';

export const DURACAO_DA_VISITA_MS = 60 * 60 * 1000;
export const DURACAO_DO_CONVITE_MS = 5 * 60 * 1000;

/** O convite abre a visita; a visita é o cookie. Um não serve no lugar do outro. */
export type TipoDoToken = 'convite' | 'visita';

export interface DadosDaVisita {
  orgId: string;
  adminId: string;
  /** Instante em que deixa de valer, em ms. */
  expiraEm: number;
}

const VERSAO = 'v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paraBase64Url(dados: Buffer | string): string {
  return Buffer.from(dados).toString('base64url');
}

function assinatura(chave: Buffer, conteudo: string): string {
  return paraBase64Url(createHmac('sha256', chave).update(conteudo).digest());
}

/** Monta o token. `chave` é parâmetro para os testes não dependerem do ambiente. */
export function assinarToken(tipo: TipoDoToken, dados: DadosDaVisita, chave: Buffer): string {
  const carga = paraBase64Url(
    JSON.stringify({ t: tipo, org: dados.orgId, admin: dados.adminId, exp: dados.expiraEm }),
  );
  const conteudo = `${VERSAO}.${carga}`;
  return `${conteudo}.${assinatura(chave, conteudo)}`;
}

/**
 * Lê e confere um token. `null` para QUALQUER coisa fora do lugar — formato,
 * assinatura, tipo, prazo vencido ou prazo longo demais (um token que diz
 * valer por um ano não foi feito aqui).
 */
export function lerToken(
  token: string | null | undefined,
  tipo: TipoDoToken,
  chave: Buffer,
  agoraMs: number,
): DadosDaVisita | null {
  if (token == null || token === '') return null;

  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== VERSAO) return null;
  const [versao = '', carga = '', recebida = ''] = partes;

  if (!iguaisEmTempoConstante(assinatura(chave, `${versao}.${carga}`), recebida)) return null;

  let dados: unknown;
  try {
    dados = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof dados !== 'object' || dados === null) return null;

  const { t, org, admin, exp } = dados as Record<string, unknown>;
  if (t !== tipo) return null;
  if (typeof org !== 'string' || !UUID.test(org)) return null;
  if (typeof admin !== 'string' || !UUID.test(admin)) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;

  const duracao = tipo === 'convite' ? DURACAO_DO_CONVITE_MS : DURACAO_DA_VISITA_MS;
  if (exp <= agoraMs || exp > agoraMs + duracao + 60_000) return null;

  return { orgId: org, adminId: admin, expiraEm: exp };
}

/** A chave desta finalidade. Lança sem `ENCRYPTION_KEY` — quem chama decide. */
function chaveDaVisita(): Buffer {
  return derivarChave('visita-como-cliente');
}

export function criarToken(
  tipo: TipoDoToken,
  orgId: string,
  adminId: string,
  agoraMs = Date.now(),
): string {
  const duracao = tipo === 'convite' ? DURACAO_DO_CONVITE_MS : DURACAO_DA_VISITA_MS;
  return assinarToken(tipo, { orgId, adminId, expiraEm: agoraMs + duracao }, chaveDaVisita());
}

/** Confere um token com a chave do ambiente. Sem chave, não há visita. */
export function conferirToken(
  token: string | null | undefined,
  tipo: TipoDoToken,
  agoraMs = Date.now(),
): DadosDaVisita | null {
  try {
    return lerToken(token, tipo, chaveDaVisita(), agoraMs);
  } catch {
    return null;
  }
}

/**
 * A visita deste pedido, conferida por inteiro: assinatura, prazo, DONO (a
 * sessão é a do admin que abriu) e equipe (ele continua em
 * `platform_admins` — quem sai da equipe perde a visita na hora, e não quando
 * o cookie vencer).
 */
export async function visitaDoPedido(
  supabase: SupabaseClient<Database>,
  usuarioId: string,
): Promise<DadosDaVisita | null> {
  const armazem = await cookies();
  const visita = conferirToken(armazem.get(COOKIE_VISITA)?.value, 'visita');
  if (visita?.adminId !== usuarioId) return null;

  const { data: registro } = await supabase
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', usuarioId)
    .maybeSingle();

  return registro == null ? null : visita;
}

/** Tamanho do motivo: curto demais não diz nada daqui a seis meses. */
export const MOTIVO_MINIMO = MOTIVO_MINIMO_DA_VISITA;
export const MOTIVO_MAXIMO = MOTIVO_MAXIMO_DA_VISITA;

/**
 * O motivo da visita, que vai para a auditoria.
 *
 * Obrigatório. A trilha dizer QUEM abriu o painel de um cliente e QUANDO é
 * metade da informação; a outra metade — por quê — é a que responde ao
 * cliente que perguntar, e a que separa suporte de curiosidade.
 */
export function conferirMotivo(
  bruto: string,
): { ok: true; motivo: string } | { ok: false; mensagem: string } {
  const motivo = bruto.trim().replace(/\s+/g, ' ');
  if (motivo.length < MOTIVO_MINIMO) {
    return {
      ok: false,
      mensagem:
        'Diga em poucas palavras por que você vai abrir o painel deste cliente. Fica registrado na auditoria.',
    };
  }
  if (motivo.length > MOTIVO_MAXIMO) {
    return {
      ok: false,
      mensagem: `O motivo passa de ${String(MOTIVO_MAXIMO)} caracteres. Resuma — o detalhe cabe numa nota interna.`,
    };
  }
  return { ok: true, motivo };
}
