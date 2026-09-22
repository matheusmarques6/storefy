/**
 * A separação entre "precisa de você" e "como está a plataforma".
 *
 * O que se prova aqui é a decisão de ESCONDER: um zero que vira cartão faz a
 * seção de pendências ter cinco itens todo dia, e uma seção que está sempre
 * cheia para de ser lida. E o inverso — a pendência que existe e não aparece —
 * é pior ainda, porque a tela passa a mentir que está tudo bem.
 */
import { describe, expect, it } from 'vitest';
import { pendencias, panorama, plataformaVazia, type ResumoBruto } from '@/lib/resumo-admin';

const ZERADO: ResumoBruto = {
  orgs_ativas: 0,
  orgs_em_trial: 0,
  trials_vencendo_7d: 0,
  orgs_inadimplentes: 0,
  lojas_live: 0,
  lojas_em_revisao: 0,
  builds_na_fila: 0,
  builds_com_erro_7d: 0,
  builds_rejeitados_7d: 0,
  contas_dev_com_erro: 0,
};

describe('pendencias', () => {
  it('plataforma sem problema nenhum não gera pendência', () => {
    expect(pendencias(ZERADO)).toEqual([]);
  });

  it('só o que é maior que zero vira pendência', () => {
    const lista = pendencias({ ...ZERADO, builds_com_erro_7d: 3 });

    expect(lista).toHaveLength(1);
    expect(lista[0]?.chave).toBe('builds_com_erro');
    expect(lista[0]?.valor).toBe(3);
  });

  /*
   * A ordem é a da urgência, e não a do banco: o cliente que parou de pagar
   * vem antes do build que quebrou. Se alguém reordenar a lista achando que é
   * cosmético, este teste cai.
   */
  it('o que é mais urgente vem primeiro', () => {
    const lista = pendencias({
      ...ZERADO,
      contas_dev_com_erro: 1,
      builds_com_erro_7d: 1,
      orgs_inadimplentes: 1,
      trials_vencendo_7d: 1,
      builds_rejeitados_7d: 1,
    });

    expect(lista.map((item) => item.chave)).toEqual([
      'inadimplentes',
      'trials_vencendo',
      'builds_com_erro',
      'builds_rejeitados',
      'contas_dev',
    ]);
  });

  /*
   * `count(*)` não devolve nulo, mas o tipo gerado permite — toda coluna de
   * retorno de função é anulável para o gerador. Um nulo escapando viraria
   * "NaN" na cara do admin.
   */
  it('nulo vira zero, e não some nem vira NaN', () => {
    const nulo = Object.fromEntries(
      Object.keys(ZERADO).map((chave) => [chave, null]),
    ) as unknown as ResumoBruto;

    expect(pendencias(nulo)).toEqual([]);
    for (const item of panorama(nulo)) {
      expect(item.valor).toBe(0);
      expect(Number.isNaN(item.valor)).toBe(false);
    }
  });

  /* Pendência não leva a lugar nenhum se a tela ainda não existe (A05). */
  it('pendência só aponta para tela que existe', () => {
    const lista = pendencias({
      ...ZERADO,
      orgs_inadimplentes: 1,
      builds_com_erro_7d: 1,
    });

    expect(lista.find((i) => i.chave === 'inadimplentes')?.href).toBe('/admin/organizacoes');
    expect(lista.find((i) => i.chave === 'builds_com_erro')?.href).toBeUndefined();
  });
});

describe('panorama', () => {
  it('aparece inteiro mesmo zerado, porque zero aqui é informação', () => {
    const lista = panorama(ZERADO);

    expect(lista).toHaveLength(5);
    expect(lista.every((item) => item.valor === 0)).toBe(true);
  });

  it('cada número tem rótulo e ajuda em pt-BR', () => {
    for (const item of panorama({ ...ZERADO, orgs_ativas: 2 })) {
      expect(item.rotulo.length).toBeGreaterThan(0);
      expect(item.ajuda.length).toBeGreaterThan(0);
    }
  });
});

describe('plataformaVazia', () => {
  it('sem cliente e sem loja, a plataforma está vazia', () => {
    expect(plataformaVazia(ZERADO)).toBe(true);
  });

  /*
   * A distinção que importa: um build rodando prova que alguém existe, mesmo
   * sem organização ATIVA — é o cliente em trial montando o primeiro app. Só
   * que quem conta gente é organização e loja, não build; por isso o build
   * sozinho não tira a tela do estado vazio, e um trial tira.
   */
  it('um cliente em teste já não é plataforma vazia', () => {
    expect(plataformaVazia({ ...ZERADO, orgs_em_trial: 1 })).toBe(false);
  });

  it('uma loja no ar já não é plataforma vazia', () => {
    expect(plataformaVazia({ ...ZERADO, lojas_live: 1 })).toBe(false);
  });
});
