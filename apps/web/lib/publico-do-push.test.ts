import { describe, expect, it } from 'vitest';
import {
  descricaoDoPublico,
  filtrosDoPublico,
  lerPublico,
  publicoDoSegmento,
  segmentoDoPublico,
  type Publico,
} from '@/lib/publico-do-push';

describe('publicoDoSegmento e segmentoDoPublico', () => {
  it('o segmento vazio de sempre é todo mundo, e todo mundo volta a ser vazio', () => {
    expect(publicoDoSegmento({})).toEqual({ tipo: 'todos' });
    expect(segmentoDoPublico({ tipo: 'todos' })).toEqual({});
  });

  it('cada público vai e volta igual', () => {
    const publicos: Publico[] = [
      { tipo: 'compradores' },
      { tipo: 'sem_compra' },
      { tipo: 'com_carrinho' },
      { tipo: 'inativos', dias: 14 },
      { tipo: 'ativos', dias: 1 },
    ];
    for (const publico of publicos) {
      expect(publicoDoSegmento(segmentoDoPublico(publico))).toEqual(publico);
    }
  });

  it('o que não é um público conhecido é todo mundo — é o que a OneSignal faria', () => {
    expect(publicoDoSegmento(null)).toEqual({ tipo: 'todos' });
    expect(publicoDoSegmento([])).toEqual({ tipo: 'todos' });
    expect(publicoDoSegmento({ publico: 'vip' })).toEqual({ tipo: 'todos' });
    expect(publicoDoSegmento({ publico: 'inativos' })).toEqual({ tipo: 'todos' });
    expect(publicoDoSegmento({ publico: 'inativos', dias: 0 })).toEqual({ tipo: 'todos' });
    expect(publicoDoSegmento({ publico: 'ativos', dias: 2.5 })).toEqual({ tipo: 'todos' });
  });
});

describe('lerPublico', () => {
  it('público sem prazo ignora o campo de dias', () => {
    expect(lerPublico('compradores', 'lixo')).toEqual({
      ok: true,
      publico: { tipo: 'compradores' },
    });
  });

  it('público com prazo exige dias de 1 a 365', () => {
    expect(lerPublico('inativos', ' 30 ')).toEqual({
      ok: true,
      publico: { tipo: 'inativos', dias: 30 },
    });
    expect(lerPublico('inativos', '').ok).toBe(false);
    expect(lerPublico('ativos', '0').ok).toBe(false);
    expect(lerPublico('ativos', '366').ok).toBe(false);
    expect(lerPublico('ativos', '7.5').ok).toBe(false);
    expect(lerPublico('ativos', '-3').ok).toBe(false);
  });

  it('tipo desconhecido é recusado', () => {
    expect(lerPublico('vip', '')).toEqual({
      ok: false,
      mensagem: 'Escolha quem recebe a campanha.',
    });
  });
});

describe('filtrosDoPublico', () => {
  it('todos não tem filtro', () => {
    expect(filtrosDoPublico({ tipo: 'todos' })).toBeNull();
  });

  it('compra e carrinho usam as marcas que o app grava', () => {
    expect(filtrosDoPublico({ tipo: 'compradores' })).toEqual([
      { field: 'tag', key: 'has_purchased', relation: '=', value: 'true' },
    ]);
    expect(filtrosDoPublico({ tipo: 'sem_compra' })).toEqual([
      { field: 'tag', key: 'has_purchased', relation: 'not_exists' },
    ]);
    expect(filtrosDoPublico({ tipo: 'com_carrinho' })).toEqual([
      { field: 'tag', key: 'cart_count', relation: '>', value: '0' },
    ]);
  });

  it('sumido é "última sessão há MAIS de N horas"; ativo, "há MENOS"', () => {
    expect(filtrosDoPublico({ tipo: 'inativos', dias: 14 })).toEqual([
      { field: 'last_session', relation: '>', hours_ago: '336' },
    ]);
    expect(filtrosDoPublico({ tipo: 'ativos', dias: 1 })).toEqual([
      { field: 'last_session', relation: '<', hours_ago: '24' },
    ]);
  });
});

describe('descricaoDoPublico', () => {
  it('diz o prazo em palavras', () => {
    expect(descricaoDoPublico({ tipo: 'inativos', dias: 14 })).toBe(
      'Quem não abre o app há 14 dias',
    );
    expect(descricaoDoPublico({ tipo: 'inativos', dias: 1 })).toBe('Quem não abre o app há 1 dia');
    expect(descricaoDoPublico({ tipo: 'ativos', dias: 1 })).toBe(
      'Quem abriu o app nas últimas 24 horas',
    );
    expect(descricaoDoPublico({ tipo: 'compradores' })).toBe('Quem já comprou pelo app');
  });
});
