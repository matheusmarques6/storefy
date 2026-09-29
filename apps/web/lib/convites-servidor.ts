import 'server-only';

/**
 * Convites no servidor: o segredo do link, o hash que vai para o banco,
 * criar-ou-reenviar e a entrega por e-mail.
 *
 * O SEGREDO SÓ EXISTE NA MEMÓRIA desta requisição: vai para o e-mail (ou
 * volta uma vez para a tela de quem convidou) e para o banco vai o sha256 —
 * o mesmo que `aceitar_convite` calcula com `digest(p_token, 'sha256')`.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InvitationKind, MembershipRole, PlatformAdminRole } from '@storefy/db';
import { emailConfigurado, enviarEmail } from '@/lib/email';
import { urlDoSite } from '@/lib/env';
import {
  linkDoConvite,
  montarEmailDoConvite,
  vencimentoDoConvite,
  type DadosDoEmailDeConvite,
} from '@/lib/convites';
import { log } from '@/lib/log';

/** Quem convida aparece no e-mail pelo nome; sem nome, pelo e-mail. */
export function nomeDeQuemConvida(usuario: {
  email?: string;
  user_metadata: Record<string, unknown>;
}): string {
  const nome = usuario.user_metadata.full_name;
  return typeof nome === 'string' && nome.trim() !== ''
    ? nome.trim()
    : (usuario.email ?? 'Alguém da equipe');
}

/** 32 bytes aleatórios em base64url: 43 caracteres, bons para URL. */
export function gerarSegredo(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDoSegredo(segredo: string): string {
  return createHash('sha256').update(segredo, 'utf8').digest('hex');
}

export interface AlvoDoConvite {
  tipo: InvitationKind;
  email: string;
  /** Convite de empresa. */
  orgId?: string;
  papel?: MembershipRole;
  /** Convite para a equipe da Storefy. */
  papelNaPlataforma?: PlatformAdminRole;
}

export type ConviteGravado =
  { ok: true; id: string; segredo: string; reenviado: boolean } | { ok: false; mensagem: string };

type Cliente = SupabaseClient<Database>;

/**
 * Cria o convite — ou, se já há um em aberto para a mesma pessoa e destino,
 * dá a ele um segredo e um prazo novos. O link anterior morre na hora: quem
 * "reenviou" porque o primeiro e-mail sumiu não deixa dois links valendo.
 *
 * Grava com o cliente de QUEM PEDIU: a RLS confere que é o proprietário (ou a
 * equipe da Storefy), e a trilha de auditoria registra o autor certo.
 */
export async function criarOuReenviarConvite(
  supabase: Cliente,
  alvo: AlvoDoConvite,
  autorId: string,
  agora: Date = new Date(),
): Promise<ConviteGravado> {
  const segredo = gerarSegredo();
  const campos = {
    token_hash: hashDoSegredo(segredo),
    expires_at: vencimentoDoConvite(agora).toISOString(),
    invited_by: autorId,
    org_role: alvo.tipo === 'organizacao' ? (alvo.papel ?? 'member') : null,
    platform_role: alvo.tipo === 'equipe' ? (alvo.papelNaPlataforma ?? 'support') : null,
  };

  const emAberto = async () => {
    let consulta = supabase
      .from('invitations')
      .select('id')
      .eq('kind', alvo.tipo)
      .eq('email', alvo.email)
      .is('accepted_at', null)
      .is('revoked_at', null);
    consulta =
      alvo.orgId === undefined ? consulta.is('org_id', null) : consulta.eq('org_id', alvo.orgId);
    const { data } = await consulta.maybeSingle();
    return data?.id ?? null;
  };

  const reenviar = async (id: string): Promise<ConviteGravado> => {
    const { data, error } = await supabase
      .from('invitations')
      .update(campos)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error != null || data == null) {
      if (error != null) log.erro('convites.reenvio-recusado', { falha: error });
      return { ok: false, mensagem: 'Não conseguimos reenviar o convite. Tente de novo.' };
    }
    return { ok: true, id: data.id, segredo, reenviado: true };
  };

  const existente = await emAberto();
  if (existente !== null) return reenviar(existente);

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      kind: alvo.tipo,
      org_id: alvo.orgId ?? null,
      email: alvo.email,
      ...campos,
    })
    .select('id')
    .single();

  if (error == null) return { ok: true, id: data.id, segredo, reenviado: false };

  // Outro clique criou o mesmo convite entre a consulta e a gravação.
  if (error.code === '23505') {
    const corrida = await emAberto();
    if (corrida !== null) return reenviar(corrida);
  }

  log.erro('convites.convite-recusado', { falha: error });
  return { ok: false, mensagem: 'Não conseguimos criar o convite. Tente de novo.' };
}

export interface Entrega {
  /** O link, para quem convidou copiar. Só existe nesta resposta. */
  link: string;
  enviadoPorEmail: boolean;
}

/**
 * Manda o link por e-mail quando a Resend está configurada. Sem ela — ou se o
 * envio falhar —, diz que não mandou: a tela mostra o link para copiar.
 */
export async function entregarConvite(
  para: string,
  segredo: string,
  dados: Omit<DadosDoEmailDeConvite, 'link'>,
): Promise<Entrega> {
  const link = linkDoConvite(urlDoSite(), segredo);
  if (!emailConfigurado()) return { link, enviadoPorEmail: false };

  const envio = await enviarEmail({ para: [para], ...montarEmailDoConvite({ ...dados, link }) });
  if (!envio.ok) log.aviso('convites.email-nao-saiu', { motivo: envio.motivo });
  return { link, enviadoPorEmail: envio.ok };
}

/** A frase do resultado, dizendo com todas as letras se o e-mail saiu. */
export function mensagemDaEntrega(email: string, entrega: Entrega, reenviado: boolean): string {
  if (entrega.enviadoPorEmail) {
    return reenviado
      ? `Convite reenviado para ${email}. O link anterior deixou de valer.`
      : `Convite enviado para ${email}.`;
  }
  return reenviado
    ? `Convite renovado para ${email}, mas o e-mail não foi enviado. Copie o link abaixo e mande para a pessoa. O link anterior deixou de valer.`
    : `Convite criado para ${email}, mas o e-mail não foi enviado. Copie o link abaixo e mande para a pessoa.`;
}
