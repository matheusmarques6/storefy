/**
 * A regra 7 do CLAUDE.md exige que toda tela tenha os quatro estados: vazio,
 * carregando (skeleton), erro e sucesso.
 *
 * Carregando e erro são convenções de arquivo do App Router, então dá para
 * verificá-los automaticamente. Este teste existe porque a ausência deles não
 * quebra nada: a página só fica congelada até o servidor responder, e ninguém
 * percebe em desenvolvimento, onde o banco responde em milissegundos.
 */
import { readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ_DO_APP = resolve(import.meta.dirname, '../app');

/** Caminho de todo arquivo abaixo de `app/`. */
function listarArquivos(diretorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(diretorio)) {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...listarArquivos(caminho));
    } else {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

const arquivos = listarArquivos(RAIZ_DO_APP);

/** Páginas que buscam dados no servidor — as que fazem o usuário esperar. */
const paginasComBusca = arquivos.filter((caminho) => {
  if (!caminho.endsWith('/page.tsx')) return false;
  const conteudo = readFileSync(caminho, 'utf8');
  return (
    conteudo.includes('criarClientServidor') ||
    conteudo.includes('exigirContextoCliente') ||
    conteudo.includes('exigirPlatformAdmin')
  );
});

/**
 * Segmento mais próximo que cobre esta página com o arquivo informado.
 * O App Router herda `loading.tsx` e `error.tsx` de segmentos acima.
 */
function cobertaPor(caminhoDaPagina: string, arquivo: string): boolean {
  let diretorio = join(caminhoDaPagina, '..');
  while (diretorio.startsWith(RAIZ_DO_APP)) {
    if (arquivos.includes(join(diretorio, arquivo))) return true;
    diretorio = join(diretorio, '..');
  }
  return false;
}

describe('estados de tela (regra 7)', () => {
  it('encontra as páginas que buscam dados no servidor', () => {
    // Guarda contra o teste virar vazio por uma mudança de nome de helper:
    // sem páginas encontradas, todas as asserções abaixo passariam à toa.
    expect(paginasComBusca.length).toBeGreaterThanOrEqual(10);
  });

  it.each(paginasComBusca.map((caminho) => [relative(RAIZ_DO_APP, caminho), caminho]))(
    'app/%s tem estado de carregamento',
    (_rotulo, caminho) => {
      expect(cobertaPor(caminho, 'loading.tsx')).toBe(true);
    },
  );

  it.each(paginasComBusca.map((caminho) => [relative(RAIZ_DO_APP, caminho), caminho]))(
    'app/%s tem fronteira de erro',
    (_rotulo, caminho) => {
      expect(cobertaPor(caminho, 'error.tsx')).toBe(true);
    },
  );

  it('tem a rede de segurança para falha no layout raiz', () => {
    // `error.tsx` não cobre erro no próprio layout raiz; só `global-error.tsx`.
    expect(arquivos).toContain(join(RAIZ_DO_APP, 'global-error.tsx'));
  });

  it('tem tela de não encontrado', () => {
    expect(arquivos).toContain(join(RAIZ_DO_APP, 'not-found.tsx'));
  });
});
