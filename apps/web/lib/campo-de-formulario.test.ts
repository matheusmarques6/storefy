/**
 * O `Campo` — o componente de TODO formulário do produto.
 *
 * Mora em `lib/` só porque é onde o vitest procura; o que se prova é o
 * componente de `components/campo.tsx`, renderizado de verdade.
 *
 * Duas regras, e a segunda é a que ninguém vê:
 *
 *   com erro, a dica sai. As duas juntas repetiam a mesma regra em duas
 *   frases, e o e2e tropeçou nisso na primeira vez que rodou;
 *
 *   o `aria-describedby` só aponta para o que existe na tela. Um id de dica
 *   escondida pendurado ali é defeito invisível ao olho e audível para quem
 *   usa leitor de tela.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Campo, propsDoCampo } from '@/components/campo';

function html(erro?: string): string {
  return renderToStaticMarkup(
    Campo({
      id: 'senha',
      rotulo: 'Senha',
      dica: 'Pelo menos 8 caracteres.',
      erro,
      children: createElement('input', propsDoCampo('senha', erro, true)),
    }),
  );
}

describe('Campo', () => {
  it('sem erro, mostra a dica', () => {
    expect(html()).toContain('Pelo menos 8 caracteres.');
    expect(html()).not.toContain('role="alert"');
  });

  /*
   * O caso que o e2e achou: a dica cinza e o erro vermelho dizendo a mesma
   * coisa, um em cima do outro.
   */
  it('com erro, o erro toma o lugar da dica', () => {
    const saida = html('A senha precisa de pelo menos 8 caracteres.');

    expect(saida).toContain('A senha precisa de pelo menos 8 caracteres.');
    expect(saida).not.toContain('Pelo menos 8 caracteres.');
    expect(saida).toContain('role="alert"');
  });

  it('erro vazio conta como sem erro', () => {
    expect(html('')).toContain('Pelo menos 8 caracteres.');
  });
});

describe('propsDoCampo', () => {
  it('sem erro, descreve o campo pela dica', () => {
    const props = propsDoCampo('senha', undefined, true);
    expect(props['aria-describedby']).toBe('senha-dica');
    expect(props['aria-invalid']).toBe(false);
  });

  /*
   * Com erro a dica não está na tela. Apontar para `senha-dica` ali seria
   * apontar para um elemento que não existe — e é exatamente o tipo de
   * defeito que um teste pega e um olho não.
   */
  it('com erro, NÃO aponta para a dica que saiu da tela', () => {
    const props = propsDoCampo('senha', 'Senha curta.', true);
    expect(props['aria-describedby']).toBe('senha-erro');
    expect(props['aria-invalid']).toBe(true);
  });

  it('todo id do aria-describedby existe no HTML renderizado', () => {
    for (const erro of [undefined, '', 'Senha curta.']) {
      const saida = html(erro);
      const alvo = /aria-describedby="([^"]+)"/.exec(saida)?.[1] ?? '';

      for (const id of alvo.split(' ').filter(Boolean)) {
        expect(saida, `${id} referenciado e ausente`).toContain(`id="${id}"`);
      }
    }
  });

  it('campo sem dica e sem erro não tem descrição', () => {
    expect(propsDoCampo('nome')['aria-describedby']).toBeUndefined();
  });
});
