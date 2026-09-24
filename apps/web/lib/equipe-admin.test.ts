/**
 * As travas que impedem a plataforma de ficar sem dono.
 *
 * O erro que elas evitam não dá erro na hora: remover o último superadmin
 * funciona, a tela responde "pronto", e o estrago só aparece na próxima vez
 * que alguém precisar dar acesso a um colega — quando a única saída é rodar o
 * script de bootstrap direto no banco de produção.
 */
import { describe, expect, it } from 'vitest';
import {
  emailNormalizado,
  lerEquipe,
  podeConvidar,
  podeMudarPapel,
  podeRemover,
} from '@/lib/equipe-admin';

const CHEFE = { id: 'a', papel: 'superadmin' as const };
const OUTRO_CHEFE = { id: 'b', papel: 'superadmin' as const };
const SUPORTE = { id: 'c', papel: 'support' as const };

describe('podeRemover', () => {
  it('superadmin remove um suporte', () => {
    expect(podeRemover(CHEFE, SUPORTE, 0)).toEqual({ ok: true });
  });

  it('suporte não remove ninguém', () => {
    const r = podeRemover(SUPORTE, OUTRO_CHEFE, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('superadmin');
  });

  /* Sem outro superadmin, quem se remove tranca a porta por fora. */
  it('ninguém remove a si mesmo', () => {
    const r = podeRemover(CHEFE, CHEFE, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('a si mesmo');
  });

  it('o último superadmin não sai', () => {
    const r = podeRemover(CHEFE, OUTRO_CHEFE, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('último superadmin');
  });

  it('havendo outro superadmin, dá para remover um', () => {
    expect(podeRemover(CHEFE, OUTRO_CHEFE, 1)).toEqual({ ok: true });
  });
});

describe('podeMudarPapel', () => {
  it('superadmin promove um suporte', () => {
    expect(podeMudarPapel(CHEFE, SUPORTE, 'superadmin', 0)).toEqual({ ok: true });
  });

  /*
   * Rebaixar o último superadmin faz o mesmo estrago que removê-lo, e é o
   * caminho que passa despercebido: "só mudei o papel".
   */
  it('rebaixar o último superadmin é tão proibido quanto removê-lo', () => {
    const r = podeMudarPapel(CHEFE, OUTRO_CHEFE, 'support', 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('último superadmin');
  });

  it('ninguém muda o próprio papel', () => {
    const r = podeMudarPapel(CHEFE, CHEFE, 'support', 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('próprio papel');
  });

  it('trocar pelo papel que já tem é recusado, e não vira escrita à toa', () => {
    const r = podeMudarPapel(CHEFE, SUPORTE, 'support', 2);
    expect(r.ok).toBe(false);
  });

  it('suporte não muda papel de ninguém', () => {
    expect(podeMudarPapel(SUPORTE, OUTRO_CHEFE, 'support', 3).ok).toBe(false);
  });
});

describe('podeConvidar', () => {
  it('só superadmin convida', () => {
    expect(podeConvidar(CHEFE)).toEqual({ ok: true });
    expect(podeConvidar(SUPORTE).ok).toBe(false);
  });
});

describe('emailNormalizado', () => {
  /* O Supabase guarda em minúsculas: um e-mail com maiúscula não acharia a
   * conta que existe, e a tela diria "usuário não encontrado" sobre alguém
   * que está ali. */
  it('normaliza caixa e espaço', () => {
    expect(emailNormalizado('  Fulano@Empresa.COM  ')).toBe('fulano@empresa.com');
  });

  it('recusa o que não parece e-mail', () => {
    expect(emailNormalizado('fulano')).toBeNull();
    expect(emailNormalizado('fulano@empresa')).toBeNull();
    expect(emailNormalizado('')).toBeNull();
    expect(emailNormalizado('a b@c.com')).toBeNull();
  });
});

describe('lerEquipe', () => {
  const BRUTO = {
    user_id: 'u1',
    email: 'fulano@storefy.com.br',
    role: 'support' as const,
    created_at: '2026-01-10T12:00:00Z',
  };

  it('normaliza uma linha completa', () => {
    expect(lerEquipe([BRUTO])).toEqual([
      {
        userId: 'u1',
        email: 'fulano@storefy.com.br',
        papel: 'support',
        desde: '2026-01-10T12:00:00Z',
      },
    ]);
  });

  /*
   * Linha sem id ou sem papel não é linha incompleta a desenhar com traços: os
   * botões dela não teriam em quem agir, e "Remover" apontando para `null`
   * chegaria ao servidor como uma remoção sem alvo.
   */
  it('descarta linha sem id ou sem papel', () => {
    expect(lerEquipe([{ ...BRUTO, user_id: null }])).toEqual([]);
    expect(lerEquipe([{ ...BRUTO, user_id: '' }])).toEqual([]);
    expect(lerEquipe([{ ...BRUTO, role: null }])).toEqual([]);
  });

  /*
   * O e-mail é o único que pode faltar: a pessoa tem acesso de qualquer jeito,
   * e esconder a linha esconderia um acesso que existe — o contrário do que
   * esta tela serve para fazer.
   */
  it('linha sem e-mail continua aparecendo, porque o acesso existe', () => {
    const [membro] = lerEquipe([{ ...BRUTO, email: null }]);
    expect(membro?.userId).toBe('u1');
    expect(membro?.email).toBe('sem e-mail');
  });

  it('lista vazia não estoura', () => {
    expect(lerEquipe([])).toEqual([]);
  });
});
