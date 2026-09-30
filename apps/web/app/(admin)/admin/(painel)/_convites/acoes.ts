'use server';

/**
 * Convites da PLATAFORMA: o lojista piloto (A03) e os colegas da equipe
 * (A11). São a porta de entrada com o cadastro fechado.
 *
 * Lojista, qualquer pessoa da equipe convida (é o trabalho do suporte levar
 * uma loja piloto para dentro). Colega, só superadmin — a mesma regra da A11,
 * conferida de novo aqui e na RLS da tabela.
 *
 * Gravam com o cliente de quem pediu, e não com a service role: a policy é a
 * autorização, e a trilha de auditoria fica com o autor certo.
 */
import { revalidatePath } from 'next/cache';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { conviteDePlataformaSchema } from '@/lib/convites';
import {
  criarOuReenviarConvite,
  entregarConvite,
  mensagemDaEntrega,
  nomeDeQuemConvida,
} from '@/lib/convites-servidor';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';
import { log } from '@/lib/log';

export interface EstadoDoConviteDaPlataforma {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** O link, uma vez só: o banco guarda apenas o hash. */
  link?: string;
}

/** Convites de plataforma por hora. Freia spam pelo nosso domínio de e-mail. */
const POR_HORA = 60;

/** Com o banco fora, nenhuma das conferências abaixo dá "sim" nem "não". */
const SEM_CONFERIR = 'Não conseguimos conferir agora. Tente de novo em instantes.';

/** `null` quando não deu para conferir: o banco fora não é "dentro do limite". */
async function dentroDoLimite(): Promise<boolean | null> {
  const { data, error } = await criarClientServiceRole().rpc('consumir_limite', {
    p_chave: 'convites:plataforma',
    p_maximo: POR_HORA,
    p_janela_segundos: 3600,
  });
  if (error != null) {
    log.erro('convites.limite-nao-conferido', { falha: error });
    return null;
  }
  return data;
}

/**
 * `null` quando não deu para conferir. Tratar a falha como "não tem conta"
 * mandaria um convite de cadastro para quem já tem conta.
 */
async function jaTemConta(email: string): Promise<boolean | null> {
  const { data, error } = await criarClientServiceRole().rpc('admin_usuario_por_email', {
    p_email: email,
  });
  if (error != null) {
    log.erro('convites.conta-nao-conferida', { falha: error });
    return null;
  }
  return data != null;
}

export async function convidarLojista(
  _anterior: EstadoDoConviteDaPlataforma,
  dados: FormData,
): Promise<EstadoDoConviteDaPlataforma> {
  const { usuario } = await exigirPlatformAdminComPapel();
  const valores = valoresDigitados(dados, ['email']);

  const analise = conviteDePlataformaSchema.safeParse({ email: dados.get('email') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };
  const { email } = analise.data;

  const temConta = await jaTemConta(email);
  if (temConta === null) return { mensagem: SEM_CONFERIR, valores };
  if (temConta) {
    return {
      erros: {
        email: 'Esse e-mail já tem conta na Storefy: a pessoa entra normalmente, sem convite.',
      },
      valores,
    };
  }
  const cabe = await dentroDoLimite();
  if (cabe === null) return { mensagem: SEM_CONFERIR, valores };
  if (!cabe) {
    return {
      mensagem: 'Muitos convites em pouco tempo. Espere um pouco e tente de novo.',
      valores,
    };
  }

  const supabase = await criarClientServidor();
  const gravado = await criarOuReenviarConvite(supabase, { tipo: 'conta', email }, usuario.id);
  if (!gravado.ok) return { mensagem: gravado.mensagem, valores };

  const entrega = await entregarConvite(email, gravado.segredo, {
    tipo: 'conta',
    convidadoPor: nomeDeQuemConvida(usuario),
  });

  revalidatePath('/admin/organizacoes');
  return {
    ok: true,
    mensagem: mensagemDaEntrega(email, entrega, gravado.reenviado),
    link: entrega.link,
    valores: {},
  };
}

/**
 * O convite de plataforma em aberto, lido com o cliente de quem pede (RLS).
 * `falhou` separa o banco fora de "o convite não está mais em aberto".
 */
async function conviteEmAberto(id: string) {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('invitations')
    .select('id, kind, email, platform_role')
    .eq('id', id)
    .in('kind', ['conta', 'equipe'])
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();
  if (error != null) log.erro('convites.convite-nao-lido', { falha: error });
  return { supabase, convite: data, falhou: error != null };
}

export async function reenviarConviteDaPlataforma(
  id: string,
): Promise<EstadoDoConviteDaPlataforma> {
  const { usuario, papel } = await exigirPlatformAdminComPapel();
  const { supabase, convite, falhou } = await conviteEmAberto(id);
  if (falhou) return { mensagem: SEM_CONFERIR };
  if (convite == null)
    return { mensagem: 'Esse convite não está mais em aberto. Atualize a página.' };
  if (convite.kind === 'equipe' && papel !== 'superadmin') {
    return { mensagem: 'Só superadmin mexe nos convites da equipe.' };
  }
  const cabe = await dentroDoLimite();
  if (cabe === null) return { mensagem: SEM_CONFERIR };
  if (!cabe) {
    return { mensagem: 'Muitos convites em pouco tempo. Espere um pouco e tente de novo.' };
  }

  const gravado = await criarOuReenviarConvite(
    supabase,
    convite.kind === 'equipe'
      ? {
          tipo: 'equipe',
          email: convite.email,
          papelNaPlataforma: convite.platform_role ?? 'support',
        }
      : { tipo: 'conta', email: convite.email },
    usuario.id,
  );
  if (!gravado.ok) return { mensagem: gravado.mensagem };

  const entrega = await entregarConvite(convite.email, gravado.segredo, {
    tipo: convite.kind,
    papelNaPlataforma: convite.platform_role,
    convidadoPor: nomeDeQuemConvida(usuario),
  });

  revalidatePath('/admin/organizacoes');
  revalidatePath('/admin/equipe');
  return {
    ok: true,
    mensagem: mensagemDaEntrega(convite.email, entrega, true),
    link: entrega.link,
  };
}

export async function cancelarConviteDaPlataforma(
  id: string,
): Promise<EstadoDoConviteDaPlataforma> {
  const { papel } = await exigirPlatformAdminComPapel();
  const { supabase, convite, falhou } = await conviteEmAberto(id);
  if (falhou) return { mensagem: SEM_CONFERIR };
  if (convite == null)
    return { mensagem: 'Esse convite não está mais em aberto. Atualize a página.' };
  if (convite.kind === 'equipe' && papel !== 'superadmin') {
    return { mensagem: 'Só superadmin mexe nos convites da equipe.' };
  }

  const { data, error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('email')
    .maybeSingle();
  if (error != null || data == null) {
    if (error != null) log.erro('convites.cancelamento-recusado', { falha: error });
    return { mensagem: 'Não conseguimos cancelar. Atualize a página e tente de novo.' };
  }

  revalidatePath('/admin/organizacoes');
  revalidatePath('/admin/equipe');
  return { ok: true, mensagem: `Convite de ${data.email} cancelado. O link deixou de valer.` };
}
