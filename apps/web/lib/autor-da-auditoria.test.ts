import { describe, expect, it } from 'vitest';
import { rotuloDoAutor } from '@/lib/autor-da-auditoria';

describe('rotuloDoAutor', () => {
  it('sem autor, foi o sistema: gatilho, rotina ou aviso de fora', () => {
    expect(rotuloDoAutor(null, undefined)).toEqual({ tipo: 'sistema', texto: 'O sistema' });
  });

  it('autor que não existe mais: a conta foi excluída, e a linha fica', () => {
    expect(rotuloDoAutor('u-1', undefined)).toEqual({
      tipo: 'excluido',
      texto: 'Conta excluída',
    });
  });

  it('uma pessoa aparece pelo nome, com o e-mail ao lado', () => {
    expect(
      rotuloDoAutor('u-1', { email: 'ana@loja.com', nome: ' Ana Souza ', equipe: false }),
    ).toEqual({ tipo: 'pessoa', texto: 'Ana Souza', detalhe: 'ana@loja.com', equipe: false });
  });

  it('sem nome, o e-mail; e quem é da equipe leva a marca', () => {
    expect(
      rotuloDoAutor('u-2', { email: 'suporte@storefy.app', nome: null, equipe: true }),
    ).toEqual({ tipo: 'pessoa', texto: 'suporte@storefy.app', detalhe: null, equipe: true });
  });
});
