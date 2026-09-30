import { describe, expect, it } from 'vitest';
import {
  AVISOS_GUARDADOS,
  avisosParaGuardar,
  caixaDesatualizada,
  lerCaixaGuardada,
  lerLidos,
  marcarLido,
  marcarTodosLidos,
  montarCaixa,
  naoLidos,
  quandoChegou,
  situacaoDaCaixa,
} from './caixa.ts';
import type { AvisoDaCaixa } from './api.ts';

function aviso(id: string, sentAt: string): AvisoDaCaixa {
  return { id, title: `Aviso ${id}`, body: 'corpo', deepLink: null, imagePath: null, sentAt };
}

const A = aviso('a', '2026-09-19T10:00:00.000Z');
const B = aviso('b', '2026-09-19T12:00:00.000Z');
const C = aviso('c', '2026-09-18T08:00:00.000Z');

describe('montarCaixa', () => {
  it('põe o mais novo primeiro, seja qual for a ordem que chegou', () => {
    expect(montarCaixa([A, B, C], []).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('marca o que já foi lido', () => {
    const caixa = montarCaixa([A, B], ['a']);
    expect(caixa.find((x) => x.id === 'a')?.lido).toBe(true);
    expect(caixa.find((x) => x.id === 'b')?.lido).toBe(false);
  });

  it('não altera a lista recebida', () => {
    const original = [A, B, C];
    montarCaixa(original, []);
    expect(original.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('id lido de um aviso que não existe mais não estraga nada', () => {
    expect(montarCaixa([A], ['sumiu']).every((x) => !x.lido)).toBe(true);
  });
});

describe('naoLidos', () => {
  it('conta o que falta abrir', () => {
    expect(naoLidos(montarCaixa([A, B, C], ['a']))).toBe(2);
    expect(naoLidos(montarCaixa([A, B, C], ['a', 'b', 'c']))).toBe(0);
    expect(naoLidos([])).toBe(0);
  });
});

describe('marcarLido', () => {
  it('acrescenta sem duplicar', () => {
    expect(marcarLido(['a'], 'b', [A, B]).sort()).toEqual(['a', 'b']);
    expect(marcarLido(['a'], 'a', [A])).toEqual(['a']);
  });

  /*
   * Sem a poda, a lista de lidos cresceria para sempre no disco do cliente,
   * guardando ids de campanhas que o servidor já nem devolve.
   */
  it('poda ids de avisos que não existem mais', () => {
    expect(marcarLido(['antigo-1', 'antigo-2', 'a'], 'b', [A, B]).sort()).toEqual(['a', 'b']);
  });

  it('marcar todos marca exatamente o que está na caixa', () => {
    expect(marcarTodosLidos([A, B, C]).sort()).toEqual(['a', 'b', 'c']);
    expect(marcarTodosLidos([])).toEqual([]);
  });
});

describe('lerLidos', () => {
  it('lê o que foi guardado', () => {
    expect(lerLidos(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
  });

  /*
   * O que está no disco foi escrito por uma versão anterior do app. Um parse
   * que lance aqui deixaria a aba de avisos sem abrir — bem pior do que
   * perder a marcação de lidos.
   */
  it('aguenta qualquer lixo sem lançar', () => {
    for (const bruto of [null, '', '   ', 'não é json', '{}', '42', '"a"', 'null']) {
      expect(lerLidos(bruto)).toEqual([]);
    }
  });

  it('descarta o que não é texto dentro da lista', () => {
    expect(lerLidos('["a",1,null,"",{"x":1},"b"]')).toEqual(['a', 'b']);
  });
});

describe('quandoChegou', () => {
  const AGORA = Date.parse('2026-09-19T12:00:00.000Z');

  it('fala como todo app que o cliente já usa', () => {
    const casos: [string, string][] = [
      ['2026-09-19T11:59:40.000Z', 'agora'],
      ['2026-09-19T11:45:00.000Z', 'há 15 min'],
      ['2026-09-19T09:00:00.000Z', 'há 3 h'],
      ['2026-09-18T10:00:00.000Z', 'ontem'],
      ['2026-09-16T12:00:00.000Z', 'há 3 dias'],
      ['2026-09-10T12:00:00.000Z', 'há 1 semana'],
      ['2026-08-25T12:00:00.000Z', 'há 3 semanas'],
      ['2026-06-19T12:00:00.000Z', 'há 3 meses'],
    ];
    for (const [quando, esperado] of casos) {
      expect(quandoChegou(quando, AGORA)).toBe(esperado);
    }
  });

  it('usa singular quando é um só', () => {
    expect(quandoChegou('2026-09-12T12:00:00.000Z', AGORA)).toBe('há 1 semana');
    expect(quandoChegou('2026-08-15T12:00:00.000Z', AGORA)).toBe('há 1 mês');
  });

  it('data ilegível vira texto vazio, e não "NaN"', () => {
    // "há NaN min" na tela do cliente é pior do que não mostrar quando foi.
    expect(quandoChegou('não é data', AGORA)).toBe('');
    expect(quandoChegou('', AGORA)).toBe('');
  });

  it('relógio do aparelho adiantado não vira número negativo', () => {
    expect(quandoChegou('2026-09-19T13:00:00.000Z', AGORA)).toBe('agora');
  });
});

describe('a caixa guardada no aparelho', () => {
  it('guarda os mais novos, até o limite', () => {
    const muitos = Array.from({ length: AVISOS_GUARDADOS + 5 }, (_, i) =>
      aviso(`x${String(i)}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()),
    );
    const guardados = avisosParaGuardar(muitos);
    expect(guardados).toHaveLength(AVISOS_GUARDADOS);
    expect(guardados[0]?.id).toBe(`x${String(AVISOS_GUARDADOS + 4)}`);
  });

  it('volta do disco como foi, e "nada guardado" é diferente de "vazia"', () => {
    expect(lerCaixaGuardada(JSON.stringify([A, B]))).toEqual([A, B]);
    expect(lerCaixaGuardada('[]')).toEqual([]);
    expect(lerCaixaGuardada(null)).toBeNull();
    expect(lerCaixaGuardada('')).toBeNull();
  });

  it('lixo no disco não derruba a aba: o aviso estranho fica de fora', () => {
    expect(lerCaixaGuardada('{nao e json')).toBeNull();
    expect(lerCaixaGuardada('{"id":"a"}')).toBeNull();
    expect(
      lerCaixaGuardada(
        JSON.stringify([A, { id: 'sem-titulo', body: 'x' }, null, 'b', { ...B, deepLink: 3 }]),
      ),
    ).toEqual([A]);
  });
});

describe('situacaoDaCaixa', () => {
  const base = {
    notificacoes: 'ligadas' as const,
    comCredenciais: true,
    temAvisos: false,
    jaLeu: true,
    falhou: false,
  };

  it('com avisos na tela, mostra a lista — mesmo sem internet', () => {
    expect(situacaoDaCaixa({ ...base, temAvisos: true, falhou: true })).toBe('pronta');
    expect(caixaDesatualizada({ temAvisos: true, falhou: true })).toBe(true);
    expect(caixaDesatualizada({ temAvisos: true, falhou: false })).toBe(false);
  });

  it('a leitura que falhou sem nada guardado é erro, e não "nenhum aviso"', () => {
    expect(situacaoDaCaixa({ ...base, falhou: true })).toBe('erro');
    expect(caixaDesatualizada({ temAvisos: false, falhou: true })).toBe(false);
  });

  it('antes da primeira resposta, carregando; depois dela, vazia é vazia', () => {
    expect(situacaoDaCaixa({ ...base, jaLeu: false })).toBe('carregando');
    expect(situacaoDaCaixa({ ...base, notificacoes: 'carregando', jaLeu: false })).toBe(
      'carregando',
    );
    expect(situacaoDaCaixa(base)).toBe('pronta');
  });

  it('sem notificações ligadas, a caixa diz como ligar', () => {
    expect(situacaoDaCaixa({ ...base, notificacoes: 'desligadas', jaLeu: false })).toBe(
      'desligada',
    );
    expect(situacaoDaCaixa({ ...base, notificacoes: 'bloqueadas', falhou: true })).toBe(
      'bloqueada',
    );
  });

  it('o app que não fala com a Storefy não finge que carrega', () => {
    expect(situacaoDaCaixa({ ...base, comCredenciais: false, jaLeu: false })).toBe('indisponivel');
    expect(situacaoDaCaixa({ ...base, notificacoes: 'indisponivel' })).toBe('indisponivel');
  });
});
