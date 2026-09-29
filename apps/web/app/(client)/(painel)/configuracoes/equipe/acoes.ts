'use server';

/**
 * C16 — a equipe da empresa: convidar, reenviar, cancelar, mudar papel,
 * remover e sair.
 *
 * Toda escrita vai com o cliente de QUEM PEDIU. A RLS é a autorização de
 * verdade (só o proprietário convida e mexe em papéis; cada um sai por si), e
 * a trilha de auditoria registra o autor certo. As conferências daqui existem
 * para dizer o PORQUÊ em português, em vez de "nada aconteceu".
 */
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ROTULO_PAPEL, type MembershipRole } from '@storefy/db';
import { COOKIE_LOJA, COOKIE_ORG, exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  CONVITES_POR_HORA,
  MAXIMO_DE_CONVITES_EM_ABERTO,
  conviteParaEmpresaSchema,
} from '@/lib/convites';
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
import { mensagemDaFalha } from '@/lib/erros';

export interface EstadoDaEquipe {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** O link do convite, uma vez só: o banco guarda apenas o hash. */
  link?: string;
}

const SO_O_PROPRIETARIO = 'Só o proprietário da empresa convida pessoas e muda papéis.';

/** A empresa ativa e quem pede, com o papel conferido no banco. */
async function contexto() {
  const ctx = await exigirContextoCliente();
  return { ...ctx, supabase: await criarClientServidor() };
}

async function dentroDoLimite(orgId: string): Promise<boolean> {
  // Tabela de sistema, sem policy: o contador vai pela service role, DEPOIS
  // de conferido que quem pede é o proprietário.
  const { data } = await criarClientServiceRole().rpc('consumir_limite', {
    p_chave: `convites:${orgId}`,
    p_maximo: CONVITES_POR_HORA,
    p_janela_segundos: 3600,
  });
  return data !== false;
}

export async function convidarParaEquipe(
  _anterior: EstadoDaEquipe,
  dados: FormData,
): Promise<EstadoDaEquipe> {
  const valores = valoresDigitados(dados, ['email', 'papel']);
  const { organizacao, papel, usuario, supabase } = await contexto();
  if (papel !== 'owner') return { mensagem: SO_O_PROPRIETARIO, valores };

  const analise = conviteParaEmpresaSchema.safeParse({
    email: dados.get('email'),
    papel: dados.get('papel'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };
  const { email, papel: papelDoConvite } = analise.data;

  if (email === usuario.email?.toLowerCase()) {
    return { erros: { email: 'Esse é o seu e-mail: você já está na equipe.' }, valores };
  }

  const { data: membros, error: erroMembros } = await supabase.rpc('membros_da_organizacao', {
    p_org_id: organizacao.id,
  });
  if (erroMembros != null) {
    return {
      mensagem: mensagemDaFalha(
        'equipe',
        erroMembros,
        'Não conseguimos conferir a equipe. Tente de novo.',
      ),
      valores,
    };
  }
  if (membros.some((membro) => membro.email?.toLowerCase() === email)) {
    return { erros: { email: 'Essa pessoa já faz parte da equipe.' }, valores };
  }

  const { count } = await supabase
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', organizacao.id)
    .is('accepted_at', null)
    .is('revoked_at', null);
  if ((count ?? 0) >= MAXIMO_DE_CONVITES_EM_ABERTO) {
    return {
      mensagem: `A empresa já tem ${String(MAXIMO_DE_CONVITES_EM_ABERTO)} convites em aberto. Cancele os que não vão ser usados antes de convidar mais gente.`,
      valores,
    };
  }

  if (!(await dentroDoLimite(organizacao.id))) {
    return {
      mensagem: 'Muitos convites em pouco tempo. Espere um pouco e tente de novo.',
      valores,
    };
  }

  const gravado = await criarOuReenviarConvite(
    supabase,
    { tipo: 'organizacao', email, orgId: organizacao.id, papel: papelDoConvite },
    usuario.id,
  );
  if (!gravado.ok) return { mensagem: gravado.mensagem, valores };

  const entrega = await entregarConvite(email, gravado.segredo, {
    tipo: 'organizacao',
    empresa: organizacao.name,
    papel: papelDoConvite,
    convidadoPor: nomeDeQuemConvida(usuario),
  });

  revalidatePath('/configuracoes/equipe');
  // Deu certo: o formulário volta limpo para o próximo convite.
  return {
    ok: true,
    mensagem: mensagemDaEntrega(email, entrega, gravado.reenviado),
    link: entrega.link,
    valores: {},
  };
}

export async function reenviarConvite(id: string): Promise<EstadoDaEquipe> {
  const { organizacao, papel, usuario, supabase } = await contexto();
  if (papel !== 'owner') return { mensagem: SO_O_PROPRIETARIO };

  const { data: convite } = await supabase
    .from('invitations')
    .select('id, email, org_role')
    .eq('id', id)
    .eq('org_id', organizacao.id)
    .eq('kind', 'organizacao')
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();
  if (convite == null) {
    return { mensagem: 'Esse convite não está mais em aberto. Atualize a página.' };
  }

  if (!(await dentroDoLimite(organizacao.id))) {
    return { mensagem: 'Muitos convites em pouco tempo. Espere um pouco e tente de novo.' };
  }

  const papelDoConvite = convite.org_role ?? 'member';
  const gravado = await criarOuReenviarConvite(
    supabase,
    { tipo: 'organizacao', email: convite.email, orgId: organizacao.id, papel: papelDoConvite },
    usuario.id,
  );
  if (!gravado.ok) return { mensagem: gravado.mensagem };

  const entrega = await entregarConvite(convite.email, gravado.segredo, {
    tipo: 'organizacao',
    empresa: organizacao.name,
    papel: papelDoConvite,
    convidadoPor: nomeDeQuemConvida(usuario),
  });

  revalidatePath('/configuracoes/equipe');
  return {
    ok: true,
    mensagem: mensagemDaEntrega(convite.email, entrega, true),
    link: entrega.link,
  };
}

export async function cancelarConvite(id: string): Promise<EstadoDaEquipe> {
  const { organizacao, papel, supabase } = await contexto();
  if (papel !== 'owner') return { mensagem: SO_O_PROPRIETARIO };

  const { data, error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', organizacao.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('email')
    .maybeSingle();

  if (error != null) {
    return {
      mensagem: mensagemDaFalha('equipe', error, 'Não conseguimos cancelar. Tente de novo.'),
    };
  }
  if (data == null) {
    return {
      mensagem:
        'Esse convite não está mais em aberto: pode ter sido aceito agora há pouco. Atualize a página.',
    };
  }

  revalidatePath('/configuracoes/equipe');
  return { ok: true, mensagem: `Convite de ${data.email} cancelado. O link deixou de valer.` };
}

const PAPEIS: readonly MembershipRole[] = ['owner', 'admin', 'member'];

/** A trava do banco que segura a empresa com pelo menos um proprietário. */
function ehTravaDoUltimoDono(falha: { code?: string; message?: string }): boolean {
  return falha.code === '23514' && (falha.message ?? '').includes('pelo menos um owner');
}

export async function mudarPapel(alvoId: string, novoPapel: string): Promise<EstadoDaEquipe> {
  const { organizacao, papel, usuario, supabase } = await contexto();
  if (papel !== 'owner') return { mensagem: SO_O_PROPRIETARIO };

  const escolhido = PAPEIS.find((item) => item === novoPapel);
  if (escolhido === undefined) return { mensagem: 'Escolha um papel da lista.' };
  if (alvoId === usuario.id) {
    return {
      mensagem:
        'Você não muda o próprio papel. Para deixar de ser proprietário, torne outra pessoa proprietária e peça para ela mudar o seu.',
    };
  }

  const { data, error } = await supabase
    .from('memberships')
    .update({ role: escolhido })
    .eq('org_id', organizacao.id)
    .eq('user_id', alvoId)
    .select('user_id')
    .maybeSingle();

  if (error != null) {
    if (ehTravaDoUltimoDono(error)) {
      return { mensagem: 'A empresa precisa de pelo menos um proprietário.' };
    }
    return {
      mensagem: mensagemDaFalha('equipe', error, 'Não conseguimos mudar o papel. Tente de novo.'),
    };
  }
  if (data == null)
    return { mensagem: 'Essa pessoa não faz mais parte da equipe. Atualize a página.' };

  revalidatePath('/configuracoes/equipe');
  return { ok: true, mensagem: `Papel alterado para ${ROTULO_PAPEL[escolhido]}.` };
}

export async function removerDaEquipe(alvoId: string): Promise<EstadoDaEquipe> {
  const { organizacao, papel, usuario, supabase } = await contexto();
  if (papel !== 'owner') return { mensagem: SO_O_PROPRIETARIO };
  if (alvoId === usuario.id) {
    return { mensagem: 'Para sair da empresa, use "Sair desta empresa".' };
  }

  const { data, error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', organizacao.id)
    .eq('user_id', alvoId)
    .select('user_id')
    .maybeSingle();

  if (error != null) {
    if (ehTravaDoUltimoDono(error)) {
      return { mensagem: 'A empresa precisa de pelo menos um proprietário.' };
    }
    return {
      mensagem: mensagemDaFalha('equipe', error, 'Não conseguimos remover. Tente de novo.'),
    };
  }
  if (data == null)
    return { mensagem: 'Essa pessoa já não fazia parte da equipe. Atualize a página.' };

  revalidatePath('/configuracoes/equipe');
  return { ok: true, mensagem: 'Pessoa removida da equipe. O acesso dela acabou agora.' };
}

/**
 * Sair da empresa ativa. Qualquer papel sai; o último proprietário, não —
 * a empresa ficaria sem dono.
 *
 * Devolve o destino, e quem chamou navega com a página inteira: a empresa e a
 * loja ativas estão em cookie, e o painel tem de nascer de novo sem elas.
 */
export async function sairDaEmpresa(): Promise<EstadoDaEquipe & { destino?: string }> {
  const { organizacao, usuario, visita, supabase } = await contexto();
  if (visita != null) return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.' };

  const { data, error } = await supabase
    .from('memberships')
    .delete()
    .eq('org_id', organizacao.id)
    .eq('user_id', usuario.id)
    .select('user_id')
    .maybeSingle();

  if (error != null) {
    if (ehTravaDoUltimoDono(error)) {
      return {
        mensagem:
          'Você é o único proprietário. Torne outra pessoa proprietária antes de sair, para a empresa não ficar sem dono.',
      };
    }
    return {
      mensagem: mensagemDaFalha(
        'equipe',
        error,
        'Não conseguimos tirar você da empresa. Tente de novo.',
      ),
    };
  }
  if (data == null) return { mensagem: 'Você já não fazia parte desta empresa.' };

  const armazem = await cookies();
  armazem.delete(COOKIE_ORG);
  armazem.delete(COOKIE_LOJA);
  revalidatePath('/', 'layout');
  return { ok: true, mensagem: `Você saiu de ${organizacao.name}.`, destino: '/' };
}
