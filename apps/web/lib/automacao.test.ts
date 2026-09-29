import { describe, expect, it } from 'vitest';
import {
  ATRASOS_SUGERIDOS,
  ATRASO_MAXIMO_MINUTOS,
  DESCRICAO_DO_TIPO,
  TIPOS_DE_AUTOMACAO,
  descricaoDoAtraso,
  ehTipoDeAutomacao,
  opcoesDeAtraso,
  resumoDaAutomacaoLigada,
  validarAutomacao,
} from '@/lib/automacao';

describe('os tipos oferecidos', () => {
  /*
   * Só o que funciona de ponta a ponta. O "inativo" entrou quando ganhou o
   * gatilho (`agendar_inativos`); o "webhook customizado" continua de fora
   * enquanto ninguém o chamar — um card dele seria um botão que não faz nada,
   * o que a regra 3 proíbe.
   */
  it('só os que funcionam de ponta a ponta', () => {
    expect([...TIPOS_DE_AUTOMACAO]).toEqual([
      'welcome',
      'abandoned_cart',
      'order_shipped',
      'back_in_stock',
      'inactive_7d',
    ]);
    expect(ehTipoDeAutomacao('inactive_7d')).toBe(true);
    expect(ehTipoDeAutomacao('custom_webhook')).toBe(false);
    expect(ehTipoDeAutomacao('qualquer coisa')).toBe(false);
  });

  it('cada tipo explica o gatilho e o motivo, sem jargão', () => {
    for (const tipo of TIPOS_DE_AUTOMACAO) {
      const descricao = DESCRICAO_DO_TIPO[tipo];
      expect(descricao.nome.length).toBeGreaterThan(0);
      expect(descricao.gatilho.length).toBeGreaterThan(20);
      expect(descricao.porque.length).toBeGreaterThan(20);
      for (const texto of [descricao.gatilho, descricao.porque]) {
        expect(texto).not.toMatch(/webhook|payload|endpoint|API|RPC/i);
      }
    }
  });

  it('a sugestão de cada tipo cabe nos limites do banco', () => {
    for (const tipo of TIPOS_DE_AUTOMACAO) {
      const { sugestao } = DESCRICAO_DO_TIPO[tipo];
      expect(validarAutomacao({ ...sugestao, enabled: false }).ok).toBe(true);
    }
  });
});

describe('descricaoDoAtraso', () => {
  it('fala como o lojista pensa, não como o banco guarda', () => {
    const casos: [number, string][] = [
      [0, 'na hora'],
      [1, '1 minuto'],
      [30, '30 minutos'],
      [60, '1 hora'],
      [180, '3 horas'],
      [1440, '1 dia'],
      [4320, '3 dias'],
      [90, '1 hora e 30 minutos'],
      [121, '2 horas e 1 minuto'],
    ];
    for (const [minutos, esperado] of casos) {
      expect(descricaoDoAtraso(minutos)).toBe(esperado);
    }
  });

  it('valor impossível vira traço, e não "NaN minutos"', () => {
    for (const ruim of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(descricaoDoAtraso(ruim)).toBe('—');
    }
  });
});

describe('validarAutomacao', () => {
  const base = { title: 'Esqueceu algo?', body: 'Seu carrinho continua aqui.', enabled: true };

  it('aceita uma automação completa', () => {
    expect(validarAutomacao({ ...base, delayMinutes: 60 }).ok).toBe(true);
  });

  it('aceita atraso zero: há loja que quer avisar na hora', () => {
    expect(validarAutomacao({ ...base, delayMinutes: 0 }).ok).toBe(true);
  });

  it('recusa o que o banco recusaria, antes de tentar gravar', () => {
    // Sem isto o erro voltaria como violação de constraint, em inglês e com
    // o nome da tabela — para um lojista.
    expect(validarAutomacao({ ...base, delayMinutes: ATRASO_MAXIMO_MINUTOS + 1 }).ok).toBe(false);
    expect(validarAutomacao({ ...base, delayMinutes: -5 }).ok).toBe(false);
    expect(validarAutomacao({ ...base, delayMinutes: 1.5 }).ok).toBe(false);
    expect(validarAutomacao({ ...base, title: '', delayMinutes: 60 }).ok).toBe(false);
    expect(validarAutomacao({ ...base, title: 'a'.repeat(121), delayMinutes: 60 }).ok).toBe(false);
  });

  it('as mensagens de erro são para o lojista, em pt-BR', () => {
    const r = validarAutomacao({ title: '', body: '', delayMinutes: 99_999, enabled: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const problema of r.problemas) {
        expect(problema.mensagem).not.toMatch(/expected|String|Number|invalid_type/);
      }
    }
  });
});

describe('o horário do "sentimos sua falta"', () => {
  it('é a hora do 7º dia, e não um atraso', () => {
    expect(opcoesDeAtraso('inactive_7d').map((opcao) => opcao.rotulo)).toEqual([
      'Às 8h',
      'Às 10h',
      'Às 12h',
      'Às 15h',
      'Às 18h',
      'Às 20h',
    ]);
    // A sugestão é uma das opções: o select não pode abrir vazio.
    expect(opcoesDeAtraso('inactive_7d').map((opcao) => opcao.minutos)).toContain(
      DESCRICAO_DO_TIPO.inactive_7d.sugestao.delayMinutes,
    );
    expect(opcoesDeAtraso('welcome')).toBe(ATRASOS_SUGERIDOS);
  });

  it('o resumo do card diz quando sai, em palavras', () => {
    expect(resumoDaAutomacaoLigada('inactive_7d', 600)).toBe(
      'Ligada · envia no 7º dia sem abrir o app, às 10h',
    );
    // Antes das 8h a madrugada empurra para as 8h; o resumo não mente.
    expect(resumoDaAutomacaoLigada('inactive_7d', 0)).toBe(
      'Ligada · envia no 7º dia sem abrir o app, às 8h',
    );
    expect(resumoDaAutomacaoLigada('welcome', 10)).toBe('Ligada · envia 10 minutos depois');
    // "envia na hora depois" era o texto de antes para atraso zero.
    expect(resumoDaAutomacaoLigada('back_in_stock', 0)).toBe('Ligada · envia na hora');
  });
});
