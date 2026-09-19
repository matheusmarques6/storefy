import { describe, expect, it } from 'vitest';
import { passoAPasso } from '@/lib/passo-manual';

const ACOES = ['play_primeiro_envio', 'envio_manual'] as const;

describe('passoAPasso', () => {
  it('com arquivo, o primeiro passo é baixá-lo', () => {
    for (const acao of ACOES) {
      expect(passoAPasso(acao, true).passos[0]).toContain('Baixe o arquivo');
    }
  });

  /*
   * Um build que morreu antes de gerar o binário não tem o que baixar, e o
   * botão de download não aparece. Um passo dizendo "baixe o arquivo no botão
   * abaixo" ao lado de nenhum botão faz o lojista procurar o que não existe.
   */
  it('sem arquivo, nenhum passo manda apertar um botão que não está lá', () => {
    for (const acao of ACOES) {
      const { passos } = passoAPasso(acao, false);
      expect(passos.join(' ')).not.toContain('botão abaixo');
      expect(passos.length).toBeGreaterThan(0);
    }
  });

  it('sem arquivo, sempre sobra um caminho para o lojista seguir', () => {
    for (const acao of ACOES) {
      const texto = passoAPasso(acao, false).passos.join(' ');
      expect(texto).toMatch(/suporte|Publique de novo/);
    }
  });

  /** O título diz de cara que não é defeito, e sim regra da loja. */
  it('o primeiro envio ao Google tem título próprio', () => {
    expect(passoAPasso('play_primeiro_envio', true).titulo).toContain('primeiro envio');
    expect(passoAPasso('envio_manual', true).titulo).toContain('pronto');
  });

  it('todos os passos são frases completas em pt-BR', () => {
    for (const acao of ACOES) {
      for (const comArquivo of [true, false]) {
        for (const passo of passoAPasso(acao, comArquivo).passos) {
          expect(passo.length).toBeGreaterThan(10);
          expect(passo.endsWith('.')).toBe(true);
        }
      }
    }
  });
});
