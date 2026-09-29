'use server';

/**
 * A equipe interna da Storefy (A11).
 *
 * É a tela que dá e tira acesso ao painel que enxerga TODOS os clientes. Por
 * isso cada ação aqui:
 *
 *   confere o papel de quem pediu no banco, a cada request;
 *   reconfere as travas de `lib/equipe-admin` com o número de superadmins
 *   lido AGORA — a tela esconde o botão, mas entre ela carregar e o clique
 *   chegar outra aba pode ter removido alguém;
 *   grava em `audit_logs` com quem fez, porque `platform_admins` não tem
 *   trigger de auditoria (as que têm são as tabelas ligadas a uma
 *   organização, e esta não é de ninguém).
 *
 * `org_id` fica NULO na auditoria de propósito: dar acesso ao painel não
 * pertence a organização nenhuma, e pendurar numa qualquer faria a linha
 * aparecer no histórico de um cliente que não tem nada com isso.
 */
import { revalidatePath } from 'next/cache';
import type { Json, PlatformAdminRole } from '@storefy/db';
import { ehUuid } from '@/lib/app-config-publica';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { mensagemDaFalha } from '@/lib/erros';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';
import {
  criarOuReenviarConvite,
  entregarConvite,
  mensagemDaEntrega,
  nomeDeQuemConvida,
} from '@/lib/convites-servidor';
import {
  emailNormalizado,
  podeConvidar,
  podeMudarPapel,
  podeRemover,
  type Permissao,
} from '@/lib/equipe-admin';

export interface EstadoDaEquipe {
  ok?: boolean;
  mensagem?: string;
  /** Quando a pessoa ainda não tinha conta: o link do convite, uma vez só. */
  link?: string;
}

type Servico = ReturnType<typeof criarClientServiceRole>;

/** Quantos superadmins existem além deste, conferido no banco e não na tela. */
async function outrosSuperadmins(servico: Servico, exceto: string): Promise<number> {
  const { data } = await servico.rpc('outros_superadmins', { p_exceto: exceto });
  return typeof data === 'number' ? data : 0;
}

/** O papel de um admin, ou `null` se ele não estiver mais na equipe. */
async function papelDe(servico: Servico, userId: string): Promise<PlatformAdminRole | null> {
  const { data } = await servico
    .from('platform_admins')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

async function auditar(
  servico: Servico,
  autor: string,
  acao: 'create' | 'update' | 'delete',
  alvo: string,
  diff: Json,
): Promise<void> {
  await servico.from('audit_logs').insert({
    actor_id: autor,
    org_id: null,
    action: acao,
    entity: 'platform_admins',
    entity_id: alvo,
    diff,
  });
}

export async function convidarAdmin(
  _anterior: EstadoDaEquipe,
  dados: FormData,
): Promise<EstadoDaEquipe> {
  const { usuario, papel } = await exigirPlatformAdminComPapel();

  const permitido: Permissao = podeConvidar({ papel });
  if (!permitido.ok) return { mensagem: permitido.motivo };

  const email = emailNormalizado(texto(dados.get('email')));
  if (email === null) return { mensagem: 'Digite um e-mail válido.' };

  const novoPapel = texto(dados.get('papel'));
  if (novoPapel !== 'superadmin' && novoPapel !== 'support') {
    return { mensagem: 'Escolha um papel.' };
  }

  const servico = criarClientServiceRole();

  const { data: alvo } = await servico.rpc('admin_usuario_por_email', { p_email: email });
  if (alvo == null) {
    /*
     * Sem conta, vai um CONVITE: a pessoa cria a conta pelo link — vale com o
     * cadastro fechado — e já nasce na equipe, com o papel escolhido. Antes a
     * tela mandava "se cadastrar primeiro", o que o cadastro fechado tornava
     * impossível. Criar a conta daqui seria criar um usuário sem senha.
     */
    const supabase = await criarClientServidor();
    const gravado = await criarOuReenviarConvite(
      supabase,
      { tipo: 'equipe', email, papelNaPlataforma: novoPapel },
      usuario.id,
    );
    if (!gravado.ok) return { mensagem: gravado.mensagem };

    const entrega = await entregarConvite(email, gravado.segredo, {
      tipo: 'equipe',
      papelNaPlataforma: novoPapel,
      convidadoPor: nomeDeQuemConvida(usuario),
    });
    revalidatePath('/admin/equipe');
    return {
      ok: true,
      mensagem: `${email} ainda não tinha conta. ${mensagemDaEntrega(email, entrega, gravado.reenviado)}`,
      link: entrega.link,
    };
  }

  if ((await papelDe(servico, alvo)) !== null) {
    return { mensagem: 'Essa pessoa já está na equipe.' };
  }

  const { error } = await servico
    .from('platform_admins')
    .insert({ user_id: alvo, role: novoPapel });

  if (error != null) return { mensagem: 'Não conseguimos adicionar. Tente de novo.' };

  await auditar(servico, usuario.id, 'create', alvo, { email, role: novoPapel });
  revalidatePath('/admin/equipe');

  return { ok: true, mensagem: `${email} agora faz parte da equipe.` };
}

export async function mudarPapelDoAdmin(
  alvoId: string,
  novoPapel: PlatformAdminRole,
): Promise<EstadoDaEquipe> {
  const { usuario, papel } = await exigirPlatformAdminComPapel();
  const servico = criarClientServiceRole();

  const papelDoAlvo = await papelDe(servico, alvoId);
  if (papelDoAlvo === null) return { mensagem: 'Essa pessoa não está mais na equipe.' };

  const permitido = podeMudarPapel(
    { id: usuario.id, papel },
    { id: alvoId, papel: papelDoAlvo },
    novoPapel,
    await outrosSuperadmins(servico, alvoId),
  );
  if (!permitido.ok) return { mensagem: permitido.motivo };

  const { error } = await servico
    .from('platform_admins')
    .update({ role: novoPapel })
    .eq('user_id', alvoId);

  if (error != null) return { mensagem: 'Não conseguimos mudar o papel. Tente de novo.' };

  await auditar(servico, usuario.id, 'update', alvoId, { de: papelDoAlvo, para: novoPapel });
  revalidatePath('/admin/equipe');

  return { ok: true, mensagem: 'Papel alterado.' };
}

export async function removerAdmin(alvoId: string): Promise<EstadoDaEquipe> {
  const { usuario, papel } = await exigirPlatformAdminComPapel();
  const servico = criarClientServiceRole();

  const papelDoAlvo = await papelDe(servico, alvoId);
  if (papelDoAlvo === null) return { mensagem: 'Essa pessoa não está mais na equipe.' };

  const permitido = podeRemover(
    { id: usuario.id, papel },
    { id: alvoId, papel: papelDoAlvo },
    await outrosSuperadmins(servico, alvoId),
  );
  if (!permitido.ok) return { mensagem: permitido.motivo };

  const { error } = await servico.from('platform_admins').delete().eq('user_id', alvoId);
  if (error != null) return { mensagem: 'Não conseguimos remover. Tente de novo.' };

  await auditar(servico, usuario.id, 'delete', alvoId, { role: papelDoAlvo });
  revalidatePath('/admin/equipe');

  return { ok: true, mensagem: 'Pessoa removida da equipe.' };
}

/**
 * Redefine o segundo fator de alguém da equipe — quem perdeu o celular.
 *
 * As regras (só superadmin, nunca o próprio, só de quem é da equipe e tem o
 * app) moram na função do banco, que também apaga os fatores, encerra as
 * sessões da pessoa e grava a auditoria na mesma transação. A tela usa
 * `podeRedefinirSegundoFator` só para decidir se mostra o botão.
 */
export async function redefinirSegundoFatorDoAdmin(alvoId: string): Promise<EstadoDaEquipe> {
  const { usuario } = await exigirPlatformAdminComPapel();
  if (!ehUuid(alvoId)) return { mensagem: 'Essa pessoa não está mais na equipe.' };

  const { error } = await criarClientServiceRole().rpc('admin_redefinir_segundo_fator', {
    p_ator: usuario.id,
    p_alvo: alvoId,
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'equipe.segundo-fator',
        error,
        'Não conseguimos redefinir a verificação. Tente de novo.',
      ),
    };
  }

  revalidatePath('/admin/equipe');
  return {
    ok: true,
    mensagem:
      'Verificação redefinida. A pessoa saiu de todas as sessões e cadastra o app autenticador de novo no próximo acesso.',
  };
}

/**
 * O campo como texto, sem confiar no que o `FormData` devolve.
 *
 * `get` devolve string OU File. `String()` em cima de um File vira
 * "[object Object]", e o convite sairia com esse endereço de e-mail.
 */
function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}
