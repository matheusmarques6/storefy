/**
 * A tela de erro (`components/estado-de-erro.tsx`), renderizada de verdade.
 *
 * Mora em `lib/` só porque é onde o vitest procura. O defeito que isto trava:
 * a tela mostrava `erro.message`, e em produção o Next troca toda mensagem de
 * erro do servidor por uma frase em inglês — era ela que o lojista lia.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}));
vi.mock('@/lib/erros-do-navegador', () => ({ relatarNoNavegador: () => undefined }));

const { EstadoDeErro } = await import('@/components/estado-de-erro');
const { ErroParaATela } = await import('@/lib/erros');

function tela(erro: Error & { digest?: string }): string {
  return renderToStaticMarkup(createElement(EstadoDeErro, { erro, tentarDeNovo: () => undefined }));
}

const FRASE_DO_NEXT =
  'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.';

describe('EstadoDeErro', () => {
  it('o erro do servidor não mostra a frase em inglês do Next, e dá o código ao suporte', () => {
    const html = tela(Object.assign(new Error(FRASE_DO_NEXT), { digest: '4172930511' }));
    expect(html).not.toContain('Server Components');
    expect(html).toContain('Não foi possível carregar esta tela agora');
    expect(html).toContain('informe o código abaixo');
    expect(html).toContain('Código: 4172930511');
    expect(html).toContain('Tentar de novo');
  });

  it('o painel atualizado no meio do uso pede para recarregar, e não "tentar de novo"', () => {
    const html = tela(
      Object.assign(new Error('Loading chunk 812 failed.'), { name: 'ChunkLoadError' }),
    );
    expect(html).toContain('O painel foi atualizado enquanto você o usava');
    expect(html).toContain('Recarregar a página');
    expect(html).not.toContain('Tentar de novo');
  });

  it('sem internet, diz isso', () => {
    expect(tela(new TypeError('Failed to fetch'))).toContain('Sem conexão com a Storefy');
  });

  it('o erro escrito para a tela passa como está; o resto vira uma frase nossa', () => {
    expect(tela(new ErroParaATela('Esta loja não é mais sua.'))).toContain(
      'Esta loja não é mais sua.',
    );
    const html = tela(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(html).not.toContain('Cannot read');
    expect(html).toContain('Algo deu errado nesta tela');
  });
});
