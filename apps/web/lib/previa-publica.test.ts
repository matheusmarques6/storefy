import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  ehTokenDePrevia,
  hashDoToken,
  montarRespostaDaPrevia,
  type EntradaDaPrevia,
} from '@/lib/previa-publica';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const RASCUNHO = configInicial({ name: 'Oak Vintage', url: 'https://oakvintage.com.br' }, 5);

function entrada(extra: Partial<EntradaDaPrevia> = {}): EntradaDaPrevia {
  return { token: TOKEN, servidorPronto: true, config: RASCUNHO, ...extra };
}

describe('ehTokenDePrevia', () => {
  it('aceita o formato que o banco gera', () => {
    expect(ehTokenDePrevia(TOKEN)).toBe(true);
    expect(ehTokenDePrevia(TOKEN.toUpperCase())).toBe(true);
    expect(ehTokenDePrevia(` ${TOKEN} `)).toBe(true);
  });

  it('recusa qualquer outra coisa', () => {
    for (const valor of ['', 'abc', `${TOKEN}0`, TOKEN.slice(1), '../../admin', "'or'1'='1"]) {
      expect(ehTokenDePrevia(valor), valor).toBe(false);
    }
  });
});

describe('hashDoToken', () => {
  it('é o mesmo sha256 que o banco grava', () => {
    expect(hashDoToken(TOKEN)).toBe(createHash('sha256').update(TOKEN).digest('hex'));
  });

  it('normaliza antes de somar, para o QR com maiúscula funcionar', () => {
    expect(hashDoToken(` ${TOKEN.toUpperCase()} `)).toBe(hashDoToken(TOKEN));
  });
});

describe('montarRespostaDaPrevia', () => {
  it('entrega o rascunho cru, como o app espera', () => {
    const resposta = montarRespostaDaPrevia(entrada());
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toEqual(RASCUNHO);
  });

  it('NUNCA guarda a resposta em cache', () => {
    // O rascunho muda a cada salvar; uma resposta guardada mostraria o
    // anterior, e o lojista acharia que a prévia não atualiza.
    for (const caso of [
      entrada(),
      entrada({ config: null }),
      entrada({ token: 'x' }),
      entrada({ servidorPronto: false }),
      entrada({ config: { lixo: 1 } }),
    ]) {
      expect(montarRespostaDaPrevia(caso).cabecalhos['Cache-Control']).toBe('no-store');
    }
  });

  it('recusa código malformado antes de qualquer consulta', () => {
    expect(montarRespostaDaPrevia(entrada({ token: 'não-é-token' })).status).toBe(400);
  });

  it('código errado, vencido e app sem rascunho dão a MESMA resposta', () => {
    // Separar os casos contaria a quem está adivinhando quais códigos existem.
    const resposta = montarRespostaDaPrevia(entrada({ config: null }));
    expect(resposta.status).toBe(404);
    expect(resposta.corpo).toEqual({
      erro: 'Esta prévia não existe mais. Gere um código novo no painel.',
    });
  });

  it('rascunho inválido vira erro, e não config quebrada no aparelho', () => {
    expect(montarRespostaDaPrevia(entrada({ config: { version: 1 } })).status).toBe(500);
  });

  it('nenhuma resposta conta o que houve por dentro', () => {
    for (const caso of [
      entrada({ token: 'x' }),
      entrada({ config: null }),
      entrada({ falhaNoBanco: true }),
      entrada({ servidorPronto: false }),
    ]) {
      const texto = JSON.stringify(montarRespostaDaPrevia(caso).corpo);
      expect(texto).not.toMatch(/preview_sessions|token_hash|postgres|supabase|select/i);
    }
  });
});
