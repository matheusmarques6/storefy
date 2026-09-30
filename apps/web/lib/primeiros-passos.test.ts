import { describe, expect, it } from 'vitest';
import {
  primeirosPassos,
  progressoDosPassos,
  type EntradaDosPrimeirosPassos,
} from '@/lib/primeiros-passos';

const NOVA: EntradaDosPrimeirosPassos = {
  iconePronto: false,
  splashPronta: false,
  versaoPublicada: null,
  shopifyConectada: false,
  appleConectada: false,
  googleConectada: false,
  statusDosBuilds: [],
  ultimoPassoPendente: false,
};

const feitos = (entrada: EntradaDosPrimeirosPassos) =>
  primeirosPassos(entrada)
    .filter((passo) => passo.feito)
    .map((passo) => passo.chave);

describe('primeirosPassos', () => {
  it('a loja recém-criada tem só o cadastro feito', () => {
    expect(feitos(NOVA)).toEqual(['loja']);
    expect(progressoDosPassos(primeirosPassos(NOVA))).toEqual({
      feitos: 1,
      total: 7,
      concluido: false,
    });
  });

  it('ícone sem tela de abertura ainda não conta: as lojas exigem os dois', () => {
    expect(feitos({ ...NOVA, iconePronto: true })).not.toContain('imagens');
    expect(feitos({ ...NOVA, iconePronto: true, splashPronta: true })).toContain('imagens');
  });

  it('as contas contam juntas: sem as duas, o app não sai nas duas lojas', () => {
    expect(feitos({ ...NOVA, appleConectada: true })).not.toContain('contas');
    expect(feitos({ ...NOVA, appleConectada: true, googleConectada: true })).toContain('contas');
  });

  it('build gerado não é build enviado; enviado não é aprovado', () => {
    expect(feitos({ ...NOVA, statusDosBuilds: ['finished', 'errored'] })).not.toContain('enviado');
    const emRevisao = feitos({ ...NOVA, statusDosBuilds: ['in_review'] });
    expect(emRevisao).toContain('enviado');
    expect(emRevisao).not.toContain('no-ar');
    expect(feitos({ ...NOVA, statusDosBuilds: ['rejected', 'approved'] })).toEqual(
      expect.arrayContaining(['enviado', 'no-ar']),
    );
  });

  /* "Acompanhar a revisão" de um app que ninguém mandou revisar era a mentira. */
  it('com o último passo pendente, o checklist manda fazê-lo, e não esperar', () => {
    const noAr = (entrada: EntradaDosPrimeirosPassos) =>
      primeirosPassos(entrada).find((passo) => passo.chave === 'no-ar');
    expect(
      noAr({ ...NOVA, statusDosBuilds: ['submitted'], ultimoPassoPendente: true }),
    ).toMatchObject({
      feito: false,
      acao: 'Fazer o último passo',
      caminho: '/publicacao',
    });
    expect(noAr({ ...NOVA, statusDosBuilds: ['in_review'] })?.acao).toBe('Acompanhar a revisão');
  });

  it('com tudo feito, o checklist acaba', () => {
    const tudo: EntradaDosPrimeirosPassos = {
      iconePronto: true,
      splashPronta: true,
      versaoPublicada: 3,
      shopifyConectada: true,
      appleConectada: true,
      googleConectada: true,
      statusDosBuilds: ['approved'],
      ultimoPassoPendente: false,
    };
    expect(progressoDosPassos(primeirosPassos(tudo))).toEqual({
      feitos: 7,
      total: 7,
      concluido: true,
    });
  });

  it('cada passo que falta diz por que importa e para onde ir', () => {
    for (const passo of primeirosPassos(NOVA)) {
      expect(passo.porque.length).toBeGreaterThan(20);
      expect(passo.caminho.startsWith('/')).toBe(true);
      expect(passo.acao.length).toBeGreaterThan(0);
    }
  });
});
