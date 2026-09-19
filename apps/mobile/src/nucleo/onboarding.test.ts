import { describe, expect, it } from 'vitest';
import { estadoDoOnboarding } from './onboarding';

const SLIDES = [{ title: 'Bem-vindo', body: 'A Oak Vintage agora cabe no seu bolso.', image: '' }];

describe('estadoDoOnboarding', () => {
  it('mostra os slides no primeiro uso', () => {
    expect(estadoDoOnboarding(SLIDES, false)).toBe('mostrar');
  });

  it('não repete para quem já viu', () => {
    expect(estadoDoOnboarding(SLIDES, true)).toBe('pular');
  });

  it('espera o disco em vez de piscar a loja antes dos slides', () => {
    expect(estadoDoOnboarding(SLIDES, null)).toBe('lendo');
  });

  it('não espera o disco quando a loja não configurou slide nenhum', () => {
    // É o caso comum: segurar a primeira tela por causa de uma leitura que
    // não muda nada seria atraso de graça em toda abertura.
    expect(estadoDoOnboarding([], null)).toBe('pular');
    expect(estadoDoOnboarding([], false)).toBe('pular');
    expect(estadoDoOnboarding([], true)).toBe('pular');
  });
});
