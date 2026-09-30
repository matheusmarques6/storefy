import { describe, expect, it } from 'vitest';
import { descreverDesfechos, type Desfecho } from '@/lib/desfechos-da-automacao';

describe('o que não saiu, em português de quem vende', () => {
  it('cada cancelamento da automação vira o porquê', () => {
    const desfechos: Desfecho[] = [
      { situacao: 'canceled', motivo: 'compra concluída', quantos: 5 },
      { situacao: 'canceled', motivo: 'já recebeu um push de carrinho hoje', quantos: 2 },
      { situacao: 'canceled', motivo: 'voltou a abrir o app', quantos: 1 },
      { situacao: 'canceled', motivo: 'automação desligada', quantos: 1 },
    ];
    expect(descreverDesfechos(desfechos, true)).toEqual([
      { texto: 'Não saíram porque o cliente comprou antes', quantos: 5, tom: 'neutro' },
      {
        texto: 'Não saíram porque o cliente já tinha recebido um lembrete de carrinho no dia',
        quantos: 2,
        tom: 'neutro',
      },
      { texto: 'Não saíram porque o cliente voltou ao app antes', quantos: 1, tom: 'neutro' },
      { texto: 'Não saíram porque a automação foi desligada', quantos: 1, tom: 'neutro' },
    ]);
  });

  /* O despacho não dispara o que ficou agendado numa automação desligada. */
  it('agendado numa automação desligada fica parado, e a tela diz isso', () => {
    const agendados: Desfecho[] = [{ situacao: 'scheduled', motivo: null, quantos: 3 }];
    expect(descreverDesfechos(agendados, true)[0]).toMatchObject({
      texto: 'Esperando a hora de sair',
      tom: 'neutro',
    });
    expect(descreverDesfechos(agendados, false)[0]).toMatchObject({
      texto: 'Paradas: a automação está desligada',
      tom: 'atencao',
    });
  });

  it('falha da OneSignal em inglês não chega à tela; falhas iguais somam', () => {
    const linhas = descreverDesfechos(
      [
        { situacao: 'failed', motivo: 'All included players are not subscribed', quantos: 2 },
        { situacao: 'failed', motivo: 'Nenhum aparelho recebeu.', quantos: 1 },
        {
          situacao: 'failed',
          motivo: 'Esta loja ainda não tem as notificações configuradas.',
          quantos: 4,
        },
        { situacao: 'failed', motivo: 'O servidor de push recusou (500).', quantos: 1 },
      ],
      true,
    );
    expect(linhas).toEqual([
      {
        texto: 'Não saíram porque as notificações da loja não estavam configuradas',
        quantos: 4,
        tom: 'atencao',
      },
      {
        texto: 'Não saíram porque o aparelho não recebe mais notificações',
        quantos: 3,
        tom: 'neutro',
      },
      {
        texto: 'Não saíram por uma falha no servidor de notificações',
        quantos: 1,
        tom: 'atencao',
      },
    ]);
    expect(JSON.stringify(linhas)).not.toMatch(/subscribed|recusou/);
  });

  it('motivo que a tela não conhece não aparece cru; contagem zero não vira linha', () => {
    expect(
      descreverDesfechos(
        [
          { situacao: 'canceled', motivo: 'motivo novo do banco', quantos: 1 },
          { situacao: 'canceled', motivo: null, quantos: 1 },
          { situacao: 'failed', motivo: null, quantos: 0 },
        ],
        true,
      ),
    ).toEqual([{ texto: 'Canceladas antes de sair', quantos: 2, tom: 'neutro' }]);
  });
});
