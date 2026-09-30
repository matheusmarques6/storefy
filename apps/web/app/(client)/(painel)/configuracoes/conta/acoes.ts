'use server';

/**
 * Minha conta — excluir a própria conta (LGPD).
 *
 * É a ação mais destrutiva que um lojista tem: as empresas em que ele é a
 * única pessoa vão junto, com as lojas e os apps. Por isso:
 *
 *   a pessoa digita o próprio e-mail e (tendo senha) a senha — uma sessão
 *   esquecida aberta não basta para apagar a conta de alguém;
 *   o efeito em cada empresa é recalculado AQUI, na hora, e é ele que vai
 *   para a trilha de auditoria;
 *   o último superadmin da Storefy não sai: a plataforma ficaria sem quem
 *   dá acesso à equipe (a mesma trava da A11).
 *
 * A exclusão é pela service role (o Auth só apaga conta pela API admin),
 * DEPOIS de todas as conferências.
 */
import { cookies } from 'next/headers';
import type { Json } from '@storefy/db';
import { COOKIE_LOJA, COOKIE_ORG } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { cancelarAssinaturaDaEmpresa } from '@/lib/cobranca-servidor';
import { visitaDoPedido } from '@/lib/visita';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';
import { log } from '@/lib/log';

export interface EstadoDaExclusao {
  ok?: boolean;
  mensagem?: string;
  erros?: { confirmacao?: string; senha?: string };
  /** O e-mail digitado volta ao campo; a senha, nunca. */
  valores?: { confirmacao?: string };
  destino?: string;
}

/** A conta tem senha? Quem entrou só pelo Google não tem o que digitar. */
function temSenha(identidades: readonly { provider: string }[] | undefined): boolean {
  return (identidades ?? []).some((identidade) => identidade.provider === 'email');
}

export async function excluirMinhaConta(
  _anterior: EstadoDaExclusao,
  dados: FormData,
): Promise<EstadoDaExclusao> {
  const bruto = dados.get('confirmacao');
  const confirmacao = typeof bruto === 'string' ? bruto.trim() : '';
  const valores = { confirmacao };
  const senha = dados.get('senha');

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email == null) {
    return { mensagem: 'Sua sessão expirou. Entre de novo para excluir a conta.', valores };
  }
  if ((await visitaDoPedido(supabase, user.id)) != null) {
    return { mensagem: 'Durante a visita ao painel de um cliente, nada muda.', valores };
  }

  if (confirmacao.toLowerCase() !== user.email.toLowerCase()) {
    return {
      erros: { confirmacao: 'Digite o seu e-mail exatamente como aparece acima.' },
      valores,
    };
  }

  if (temSenha(user.identities)) {
    if (typeof senha !== 'string' || senha === '') {
      return { erros: { senha: 'Digite sua senha.' }, valores };
    }
    // Reautentica: uma sessão esquecida aberta não pode apagar a conta de ninguém.
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: senha,
    });
    if (error != null) return { erros: { senha: 'Senha incorreta.' }, valores };
  }

  const servico = criarClientServiceRole();

  // O último superadmin não sai: ninguém mais daria acesso à equipe.
  /*
   * Sem conseguir ler, não segue: pular esta conferência com o banco fora
   * deixaria o último superadmin excluir a conta.
   */
  const { data: admin, error: erroDoAdmin } = await servico
    .from('platform_admins')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (erroDoAdmin != null) {
    log.erro('conta.admin-nao-conferido', { falha: erroDoAdmin });
    return { mensagem: 'Não conseguimos conferir a sua conta agora. Tente de novo.', valores };
  }
  if (admin?.role === 'superadmin') {
    const { data: outros, error: erroDosOutros } = await servico.rpc('outros_superadmins', {
      p_exceto: user.id,
    });
    if (erroDosOutros != null) {
      log.erro('conta.superadmins-nao-conferidos', { falha: erroDosOutros });
      return { mensagem: 'Não conseguimos conferir a sua conta agora. Tente de novo.', valores };
    }
    if (outros === 0) {
      return {
        mensagem:
          'Você é o único superadmin da Storefy. Promova outra pessoa em Admin › Equipe antes de excluir a conta.',
        valores,
      };
    }
  }

  // O efeito em cada empresa, calculado agora, é o que vai para a trilha.
  const { data: efeitos, error: erroEfeitos } = await supabase.rpc(
    'consequencias_de_excluir_minha_conta',
  );
  if (erroEfeitos != null) {
    log.erro('conta.efeitos-da-exclusao-nao-lidos', { falha: erroEfeitos });
    return { mensagem: 'Não conseguimos conferir suas empresas. Tente de novo.', valores };
  }

  /*
   * A empresa que vai junto com a conta não pode levar a assinatura acesa: a
   * Asaas continuaria cobrando o cartão de quem já foi embora. Cancela lá
   * ANTES — e, se a Asaas não responder, nada é excluído (o banco também
   * recusa excluir empresa com assinatura viva).
   */
  for (const efeito of efeitos) {
    if (efeito.efeito !== 'excluida' || efeito.org_id == null) continue;
    const cancelada = await cancelarAssinaturaDaEmpresa(efeito.org_id, user.id);
    if (!cancelada.ok) {
      return {
        mensagem: `Não conseguimos cancelar a assinatura de ${efeito.empresa ?? 'uma empresa'}: ${cancelada.motivo} Nada foi excluído.`,
        valores,
      };
    }
  }

  const { error: erroExclusao } = await servico.auth.admin.deleteUser(user.id);
  if (erroExclusao != null) {
    log.erro('conta.exclusao-recusada', { falha: erroExclusao });
    return { mensagem: 'Não conseguimos excluir a conta agora. Tente de novo.', valores };
  }

  /*
   * A trilha de cada empresa diz quem saiu e o que aconteceu com ela. O
   * `actor_id` vira nulo junto com a conta (é a regra da chave); o e-mail no
   * `diff` é o que continua dizendo quem foi.
   */
  const { error: erroTrilha } = await servico.from('audit_logs').insert(
    efeitos.map((efeito) => ({
      actor_id: null,
      org_id: efeito.org_id,
      action: 'delete' as const,
      entity: 'conta',
      entity_id: user.id,
      diff: {
        email: { de: user.email ?? null, para: null },
        efeito: { de: null, para: efeito.efeito },
        ...(efeito.efeito === 'passa_para'
          ? { sucessor: { de: null, para: efeito.sucessor } }
          : {}),
      } satisfies Json,
    })),
  );
  if (erroTrilha != null) log.erro('conta.exclusao-sem-trilha', { falha: erroTrilha });

  const { error: erroAoSair } = await supabase.auth.signOut();
  // A sessão sai deste navegador mesmo assim (o supabase-js apaga o cookie); o
  // que falhou foi derrubá-la no servidor, e isso precisa aparecer no log.
  if (erroAoSair != null) log.aviso('conta.saida-sem-revogar', { falha: erroAoSair });
  const armazem = await cookies();
  for (const nome of [COOKIE_ORG, COOKIE_LOJA, COOKIE_VISITA, COOKIE_LOJA_DA_VISITA]) {
    armazem.delete(nome);
  }

  return { ok: true, destino: '/entrar?aviso=conta-excluida' };
}
