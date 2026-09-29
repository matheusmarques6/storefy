import { describe, expect, it } from 'vitest';
import {
  ETAPAS,
  ROTULO_DA_ETAPA,
  ROTULO_DO_MOTIVO,
  lerFiltros,
  rotuloDoMotivo,
  temFiltro,
} from '@/lib/clientes-do-admin';

const PLANO = '11111111-1111-4111-8111-111111111111';

describe('lerFiltros', () => {
  it('lê os filtros conhecidos e devolve os mesmos para os links', () => {
    expect(
      lerFiltros({ situacao: 'past_due', plano: PLANO, etapa: 'publicado', saude: 'critica' }),
    ).toEqual({
      filtros: { situacao: 'past_due', plano: PLANO, etapa: 'publicado', saude: 'critica' },
      extras: { situacao: 'past_due', plano: PLANO, etapa: 'publicado', saude: 'critica' },
    });
  });

  it('"teste" é o filtro de quem ainda não assinou', () => {
    expect(lerFiltros({ plano: 'TESTE' }).filtros).toEqual({ plano: 'teste' });
  });

  /* A URL é de quem a escreve: valor estranho some, e não vira consulta. */
  it('ignora o que não é valor conhecido', () => {
    expect(
      lerFiltros({
        situacao: 'hackeado',
        plano: "1' or '1'='1",
        etapa: ['no_ar', 'sem_loja'],
        saude: '',
      }),
    ).toEqual({ filtros: {}, extras: {} });
  });
});

describe('rótulos', () => {
  it('toda etapa e todo motivo têm frase', () => {
    for (const etapa of ETAPAS) expect(ROTULO_DA_ETAPA[etapa].length).toBeGreaterThan(3);
    for (const motivo of [
      'cobranca_em_atraso',
      'teste_acabou',
      'revisao_recusada',
      'build_com_erro',
      'conta_com_erro',
      'acima_do_limite',
      'sem_atividade',
    ]) {
      expect(ROTULO_DO_MOTIVO[motivo], motivo).toBeDefined();
    }
    // Motivo novo no banco antes da tela aparece pelo código, e não some.
    expect(rotuloDoMotivo('motivo_novo')).toBe('motivo_novo');
  });

  it('temFiltro distingue a lista filtrada da lista inteira', () => {
    expect(temFiltro({}, '')).toBe(false);
    expect(temFiltro({}, 'oak')).toBe(true);
    expect(temFiltro({ saude: 'boa' }, '')).toBe(true);
  });
});
