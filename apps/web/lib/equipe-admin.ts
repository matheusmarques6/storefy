/**
 * As regras de quem pode mexer na equipe da plataforma (A11).
 *
 * TRÊS TRAVAS, e todas existem para impedir que a plataforma fique sem dono:
 *
 *   só `superadmin` mexe. `support` lê a equipe e não a altera — é o papel de
 *   quem atende cliente, não de quem dá acesso ao painel inteiro;
 *
 *   ninguém se remove nem se rebaixa. O caminho de volta seria pedir a outro
 *   superadmin, e se não houver outro não há caminho nenhum;
 *
 *   o último superadmin não sai. Remover ou rebaixar o único que resta deixa a
 *   plataforma sem quem possa dar acesso a alguém, e a volta é rodar o script
 *   de bootstrap direto no banco de produção.
 *
 * As três moram aqui, testadas sem banco, e são conferidas DE NOVO no
 * servidor: a tela esconde o botão, mas entre ela carregar e o clique chegar
 * outra aba pode ter mudado a equipe.
 */
import type { PlatformAdminRole } from '@storefy/db';

export const ROTULO_PAPEL_ADMIN: Record<PlatformAdminRole, string> = {
  superadmin: 'Superadmin',
  support: 'Suporte',
};

export const EXPLICACAO_PAPEL: Record<PlatformAdminRole, string> = {
  superadmin: 'Vê tudo e altera a equipe.',
  support: 'Vê tudo, mas não altera a equipe.',
};

export interface Recusa {
  ok: false;
  motivo: string;
}
export type Permissao = { ok: true } | Recusa;

const SO_SUPERADMIN: Recusa = {
  ok: false,
  motivo: 'Só um superadmin altera a equipe.',
};

/**
 * Pode remover este admin?
 *
 * `outrosSuperadmins` é quantos superadmins existem ALÉM do alvo — o número
 * que o banco calcula, e não o que a tela contou.
 */
export function podeRemover(
  quemPede: { id: string; papel: PlatformAdminRole },
  alvo: { id: string; papel: PlatformAdminRole },
  outrosSuperadmins: number,
): Permissao {
  if (quemPede.papel !== 'superadmin') return SO_SUPERADMIN;

  if (quemPede.id === alvo.id) {
    return {
      ok: false,
      motivo: 'Você não pode remover a si mesmo. Peça a outro superadmin.',
    };
  }

  if (alvo.papel === 'superadmin' && outrosSuperadmins === 0) {
    return {
      ok: false,
      motivo: 'É o último superadmin. Promova outra pessoa antes de remover esta.',
    };
  }

  return { ok: true };
}

/** Pode trocar o papel deste admin? */
export function podeMudarPapel(
  quemPede: { id: string; papel: PlatformAdminRole },
  alvo: { id: string; papel: PlatformAdminRole },
  novoPapel: PlatformAdminRole,
  outrosSuperadmins: number,
): Permissao {
  if (quemPede.papel !== 'superadmin') return SO_SUPERADMIN;

  if (novoPapel === alvo.papel) {
    return { ok: false, motivo: 'Esse já é o papel desta pessoa.' };
  }

  if (quemPede.id === alvo.id) {
    return {
      ok: false,
      motivo: 'Você não pode mudar o próprio papel. Peça a outro superadmin.',
    };
  }

  /*
   * Rebaixar o último superadmin é o mesmo estrago que removê-lo: sobra uma
   * plataforma onde ninguém pode dar acesso a ninguém.
   */
  if (alvo.papel === 'superadmin' && novoPapel !== 'superadmin' && outrosSuperadmins === 0) {
    return {
      ok: false,
      motivo: 'É o último superadmin. Promova outra pessoa antes de rebaixar esta.',
    };
  }

  return { ok: true };
}

/** Pode convidar alguém para a equipe? */
export function podeConvidar(quemPede: { papel: PlatformAdminRole }): Permissao {
  return quemPede.papel === 'superadmin' ? { ok: true } : SO_SUPERADMIN;
}

/**
 * O e-mail digitado, normalizado — ou `null` quando não parece e-mail.
 *
 * Minúsculas e sem espaço porque é assim que o Supabase guarda, e um e-mail
 * com maiúscula não acharia a conta que existe. A validação é frouxa de
 * propósito: quem decide se o e-mail existe é a busca no banco, não um regex.
 */
export function emailNormalizado(bruto: string): string | null {
  const texto = bruto.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto) ? texto : null;
}

/** Uma linha do `admin_equipe`, com os nulos que o tipo gerado permite. */
export interface MembroBruto {
  user_id: string | null;
  email: string | null;
  role: PlatformAdminRole | null;
  created_at: string | null;
}

export interface Membro {
  userId: string;
  email: string;
  papel: PlatformAdminRole;
  desde: string | null;
}

/**
 * Normaliza as linhas da equipe, e DESCARTA as que não dá para usar.
 *
 * Toda coluna de retorno de função é anulável para o gerador de tipos, mesmo
 * quando o banco garante que não é. Aqui isso deixa de ser um `??` espalhado
 * pela tela: uma linha sem `user_id` ou sem papel não é uma linha incompleta a
 * desenhar com traços — é uma linha em que os BOTÕES não teriam em quem
 * agir. Melhor não existir do que existir quebrada.
 *
 * O e-mail é o único que aceita ausência: a pessoa está na equipe de qualquer
 * jeito, e esconder a linha por falta do e-mail esconderia um acesso que
 * existe — exatamente o que esta tela serve para mostrar.
 */
export function lerEquipe(brutas: MembroBruto[]): Membro[] {
  const membros: Membro[] = [];

  for (const bruta of brutas) {
    if (bruta.user_id == null || bruta.user_id === '' || bruta.role == null) continue;

    membros.push({
      userId: bruta.user_id,
      email: bruta.email ?? 'sem e-mail',
      papel: bruta.role,
      desde: bruta.created_at,
    });
  }

  return membros;
}
