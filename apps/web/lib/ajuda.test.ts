/**
 * Os artigos da central de ajuda (C17) descrevem telas de verdade. O teste
 * confere o que dá para conferir sem ler o texto: todo atalho leva a uma
 * página que existe, os endereços são únicos e nenhum artigo nasceu vazio.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIGOS, artigoPorSlug } from './ajuda';

const PAINEL = resolve(import.meta.dirname, '../app/(client)/(painel)');

describe('artigos da ajuda', () => {
  it('endereços únicos e só com letras, números e hífen', () => {
    const slugs = ARTIGOS.map((artigo) => artigo.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('nenhum artigo vazio', () => {
    for (const artigo of ARTIGOS) {
      expect(artigo.titulo.length, artigo.slug).toBeGreaterThan(5);
      expect(artigo.resumo.length, artigo.slug).toBeGreaterThan(20);
      expect(artigo.secoes.length, artigo.slug).toBeGreaterThan(0);
      for (const secao of artigo.secoes) {
        const conteudo = secao.paragrafos.length + (secao.passos?.length ?? 0);
        expect(conteudo, `${artigo.slug} › ${secao.titulo}`).toBeGreaterThan(0);
      }
    }
  });

  it('todo atalho leva a uma tela que existe no painel', () => {
    for (const artigo of ARTIGOS) {
      for (const atalho of artigo.atalhos) {
        const pagina = join(PAINEL, atalho.href, 'page.tsx');
        expect(existsSync(pagina), `${artigo.slug} → ${atalho.href}`).toBe(true);
      }
    }
  });

  it('acha pelo endereço, e o desconhecido não vira artigo', () => {
    expect(artigoPorSlug('primeiros-passos')?.titulo).toContain('Primeiros passos');
    expect(artigoPorSlug('nao-existe')).toBeNull();
    expect(artigoPorSlug('../../etc')).toBeNull();
  });
});
