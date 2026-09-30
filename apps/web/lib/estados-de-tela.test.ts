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

/**
 * Páginas que esperam algo no servidor antes de desenhar — as que fazem o
 * usuário esperar. Toda espera conta, e não só a de um helper conhecido: a
 * página pública que lê o banco pela service role também congela.
 */
const paginasAssincronas = arquivos.filter(
  (caminho) =>
    caminho.endsWith('/page.tsx') &&
    readFileSync(caminho, 'utf8').includes('export default async function'),
);

/**
 * Páginas assíncronas SEM `loading.tsx`, de propósito, cada uma com o porquê.
 * Com `loading.tsx` a resposta começa antes de a página decidir, e o que ela
 * decide deixa de ser HTTP: o redirect vira uma troca feita pelo navegador, e
 * o 404 sai como 200.
 */
const SEM_CARREGAMENTO: Record<string, string> = {
  '(admin)/admin/ativar-2fa/page.tsx': 'decide por redirect, lendo só a sessão',
  '(admin)/admin/entrar/page.tsx': 'só lê o endereço (searchParams)',
  '(admin)/admin/verificar/page.tsx': 'decide por redirect, lendo só a sessão',
  '(client)/(publico)/confirmar-email/page.tsx': 'só lê o endereço (searchParams)',
  '(client)/(publico)/entrar/page.tsx': 'só lê o endereço (searchParams)',
  'privacy/[loja]/page.tsx': 'a loja que não existe precisa sair como 404',
  'privacy/app/[appId]/page.tsx': 'só redireciona ou dá 404: não desenha nada',
};

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
  it('encontra as páginas que esperam o servidor', () => {
    // Guarda contra o teste virar vazio por uma mudança de convenção: sem
    // páginas encontradas, todas as asserções abaixo passariam à toa.
    expect(paginasAssincronas.length).toBeGreaterThanOrEqual(40);
  });

  it.each(paginasAssincronas.map((caminho) => [relative(RAIZ_DO_APP, caminho), caminho]))(
    'app/%s tem estado de carregamento',
    (rotulo, caminho) => {
      expect(cobertaPor(caminho, 'loading.tsx') || rotulo in SEM_CARREGAMENTO).toBe(true);
    },
  );

  it.each(paginasAssincronas.map((caminho) => [relative(RAIZ_DO_APP, caminho), caminho]))(
    'app/%s tem fronteira de erro',
    (_rotulo, caminho) => {
      expect(cobertaPor(caminho, 'error.tsx')).toBe(true);
    },
  );

  /* A lista não pode esconder nada: só página que existe, espera e não tem o arquivo. */
  it.each(Object.keys(SEM_CARREGAMENTO))('a exceção app/%s continua valendo', (rotulo) => {
    const caminho = join(RAIZ_DO_APP, rotulo);
    expect(paginasAssincronas).toContain(caminho);
    expect(cobertaPor(caminho, 'loading.tsx')).toBe(false);
  });

  it('tem a rede de segurança para falha no layout raiz', () => {
    // `error.tsx` não cobre erro no próprio layout raiz; só `global-error.tsx`.
    expect(arquivos).toContain(join(RAIZ_DO_APP, 'global-error.tsx'));
  });

  it('tem tela de não encontrado', () => {
    expect(arquivos).toContain(join(RAIZ_DO_APP, 'not-found.tsx'));
  });
});
