/**
 * O que se prova aqui é a decisão de CHAMAR ALGO DE PROBLEMA.
 *
 * Uma tela de operação que acusa demais deixa de ser lida, e uma que acusa de
 * menos não serve para nada. O meio-termo mora em dois números — o piso de
 * volume e o teto de falha — e os dois têm que estar sob teste, senão alguém
 * "ajusta" um deles seis meses depois sem perceber o que quebrou.
 */
import { describe, expect, it } from 'vitest';
import {
  FALHA_PREOCUPANTE,
  MINIMO_PARA_JULGAR,
  lerLinha,
  lerPeriodo,
  totais,
  type LinhaDePushBruta,
} from '@/lib/push-admin';

const VAZIA: LinhaDePushBruta = {
  app_id: 'app-1',
  loja: 'Loja Teste',
  organizacao: 'Org Teste',
  campanhas_enviadas: 0,
  campanhas_falhas: 0,
  entregues: 0,
  abertos: 0,
  automacoes_enviadas: 0,
  automacoes_falhas: 0,
  aparelhos: 0,
  ativos: 0,
};

describe('lerLinha', () => {
  it('soma campanha e automação, porque a fatura não distingue as duas', () => {
    const linha = lerLinha({
      ...VAZIA,
      campanhas_enviadas: 10,
      automacoes_enviadas: 15,
      campanhas_falhas: 1,
      automacoes_falhas: 2,
    });

    expect(linha.enviados).toBe(25);
    expect(linha.falhas).toBe(3);
  });

  /*
   * Tentativas é envio + falha. Dividir só pelos que deram certo daria taxa
   * acima de 100% — 10 falhas sobre 10 enviados viraria "100%" quando o certo
   * é 50%, e a tela acusaria o dobro do que existe.
   */
  it('a taxa de falha usa as tentativas, não só os que deram certo', () => {
    const linha = lerLinha({ ...VAZIA, campanhas_enviadas: 10, campanhas_falhas: 10 });
    expect(linha.taxaDeFalha).toBe(0.5);
  });

  it('sem tentativa nenhuma não há taxa, e não há zero por cento', () => {
    expect(lerLinha(VAZIA).taxaDeFalha).toBeNull();
    expect(lerLinha(VAZIA).taxaDeAbertura).toBeNull();
  });

  /*
   * O piso de volume. Um único envio que falhou é "100% de falha" na
   * matemática e é um teste abandonado na vida real — e uma tela que grita por
   * causa disso todo dia para de ser lida.
   */
  it('pouco volume não vira alarme, mesmo falhando tudo', () => {
    const linha = lerLinha({ ...VAZIA, campanhas_enviadas: 0, campanhas_falhas: 1 });

    expect(linha.taxaDeFalha).toBe(1);
    expect(linha.preocupante).toBe(false);
  });

  it('com volume suficiente, falha alta vira alarme', () => {
    const linha = lerLinha({
      ...VAZIA,
      campanhas_enviadas: MINIMO_PARA_JULGAR,
      campanhas_falhas: MINIMO_PARA_JULGAR,
    });

    expect(linha.preocupante).toBe(true);
  });

  /* Push falha um pouco sempre. Quem está dentro do normal não pode acusar. */
  it('falha dentro do normal não vira alarme', () => {
    const linha = lerLinha({ ...VAZIA, campanhas_enviadas: 990, campanhas_falhas: 10 });

    expect(linha.taxaDeFalha).toBeLessThan(FALHA_PREOCUPANTE);
    expect(linha.preocupante).toBe(false);
  });

  it('nulo do banco vira zero, nunca NaN na tela', () => {
    const nula = Object.fromEntries(
      Object.keys(VAZIA).map((chave) => [chave, null]),
    ) as unknown as LinhaDePushBruta;
    const linha = lerLinha(nula);

    expect(linha.enviados).toBe(0);
    expect(linha.ativos).toBe(0);
    expect(Number.isNaN(linha.enviados)).toBe(false);
    expect(linha.loja).toBe('Loja removida');
  });
});

describe('totais', () => {
  it('soma os ativos de todos os apps', () => {
    const soma = totais([
      lerLinha({ ...VAZIA, ativos: 100, campanhas_enviadas: 5 }),
      lerLinha({ ...VAZIA, ativos: 250, campanhas_enviadas: 3 }),
    ]);

    expect(soma.apps).toBe(2);
    expect(soma.ativos).toBe(350);
    expect(soma.enviados).toBe(8);
  });

  it('conta quantos apps merecem atenção', () => {
    const soma = totais([
      lerLinha({ ...VAZIA, campanhas_enviadas: 100, campanhas_falhas: 100 }),
      lerLinha({ ...VAZIA, campanhas_enviadas: 100, campanhas_falhas: 1 }),
    ]);

    expect(soma.preocupantes).toBe(1);
  });

  it('plataforma sem app nenhum não estoura', () => {
    expect(totais([])).toEqual({ apps: 0, enviados: 0, falhas: 0, ativos: 0, preocupantes: 0 });
  });
});

describe('lerPeriodo', () => {
  it('o padrão é 30 dias, que é o ciclo da fatura', () => {
    expect(lerPeriodo(undefined)).toBe(30);
    expect(lerPeriodo('')).toBe(30);
    expect(lerPeriodo('365')).toBe(30);
    expect(lerPeriodo('abacaxi')).toBe(30);
  });

  it('aceita os períodos que a tela oferece', () => {
    expect(lerPeriodo('7')).toBe(7);
    expect(lerPeriodo('90')).toBe(90);
  });
});
