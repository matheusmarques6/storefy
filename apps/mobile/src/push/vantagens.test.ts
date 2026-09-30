import { describe, expect, it } from 'vitest';
import { vantagensDoPrePrompt } from './vantagens.ts';

const textos = (avisos: Parameters<typeof vantagensDoPrePrompt>[0]): string[] =>
  vantagensDoPrePrompt(avisos).map((vantagem) => vantagem.texto);

describe('vantagensDoPrePrompt', () => {
  it('sem automação ligada, promete só as promoções', () => {
    expect(textos([])).toEqual(['Promoções e cupons antes de acabarem']);
  });

  it('cada aviso ligado vira uma linha, e só ele', () => {
    expect(textos(['pedido'])).toEqual([
      'Promoções e cupons antes de acabarem',
      'Aviso quando o seu pedido sair para entrega',
    ]);
    expect(textos(['carrinho', 'estoque'])).toEqual([
      'Promoções e cupons antes de acabarem',
      'Um lembrete do que ficou no carrinho',
      'O produto que você queria de volta ao estoque',
    ]);
  });

  it('não repete a linha de um aviso repetido', () => {
    expect(textos(['pedido', 'pedido'])).toHaveLength(2);
  });

  it('cada linha tem o seu ícone', () => {
    const icones = vantagensDoPrePrompt(['carrinho', 'pedido', 'estoque']).map((v) => v.icone);
    expect(new Set(icones).size).toBe(4);
  });
});
