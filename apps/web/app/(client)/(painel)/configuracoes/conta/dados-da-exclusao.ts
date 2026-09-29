import 'server-only';

/**
 * O que a tela de excluir a conta precisa saber antes: o efeito em cada
 * empresa, se a conta tem senha para pedir, e o que impede a exclusão.
 *
 * Usado em Minha conta e na tela de conta sem empresa — quem ficou sem
 * empresa também tem o direito de apagar a conta.
 */
import type { User } from '@supabase/supabase-js';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import type { EfeitoNaEmpresa } from './excluir-conta';

const EFEITOS: readonly EfeitoNaEmpresa['efeito'][] = ['excluida', 'passa_para', 'sai'];

export async function dadosDaExclusao(usuario: User): Promise<{
  efeitos: EfeitoNaEmpresa[];
  pedeSenha: boolean;
  bloqueio: string | null;
}> {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase.rpc('consequencias_de_excluir_minha_conta');
  if (error != null) {
    throw new Error(`Não foi possível conferir suas empresas: ${error.message}`);
  }

  const efeitos = data.flatMap((linha) => {
    const efeito = EFEITOS.find((valor) => valor === linha.efeito);
    return efeito === undefined || linha.empresa == null
      ? []
      : [
          {
            empresa: linha.empresa,
            efeito,
            sucessor: linha.sucessor,
            lojas: linha.lojas ?? 0,
          },
        ];
  });

  /*
   * O último superadmin não sai (a plataforma ficaria sem quem dá acesso à
   * equipe). A contagem é da service role — `outros_superadmins` não é
   * exposta —, depois de saber que quem pergunta é superadmin.
   */
  let bloqueio: string | null = null;
  const { data: admin } = await supabase
    .from('platform_admins')
    .select('role')
    .eq('user_id', usuario.id)
    .maybeSingle();
  if (admin?.role === 'superadmin') {
    const { data: outros } = await criarClientServiceRole().rpc('outros_superadmins', {
      p_exceto: usuario.id,
    });
    if (typeof outros !== 'number' || outros === 0) {
      bloqueio =
        'Você é o único superadmin da Storefy. Promova outra pessoa em Admin › Equipe antes de excluir a conta.';
    }
  }

  return {
    efeitos,
    pedeSenha: (usuario.identities ?? []).some((identidade) => identidade.provider === 'email'),
    bloqueio,
  };
}
