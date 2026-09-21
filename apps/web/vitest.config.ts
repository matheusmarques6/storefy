import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  /*
   * O `tsconfig.json` do Next usa `jsx: preserve`, porque quem transforma o
   * JSX é o compilador dele. O vitest não passa por ali: sem esta linha,
   * qualquer teste que importe um `.tsx` morre no parser, e o erro aponta para
   * a primeira linha de JSX do arquivo importado — que parece um erro de
   * sintaxe do componente.
   */
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
      // Ver `test/server-only.ts`: é marca de build, não código.
      'server-only': resolve(import.meta.dirname, 'test/server-only.ts'),
    },
  },
});
