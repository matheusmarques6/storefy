/**
 * Lint do app web: regras do Next.js somadas às regras com tipos da raiz.
 *
 * ORDEM IMPORTA. O eslint-config-next define o próprio parser para todos os
 * arquivos. Se ele vier por último, sobrescreve o parser do typescript-eslint e
 * toda regra que precisa de tipo falha com "don't have parserOptions set to
 * generate type information". Por isso o Next entra primeiro, restrito aos
 * arquivos de código, e a configuração da raiz fecha — inclusive o bloco que
 * desliga as regras tipadas nos arquivos de configuração.
 *
 * O eslint-config-next 16 exporta flat config nativa; FlatCompat não serve.
 */
import next from 'eslint-config-next/core-web-vitals';
import raiz from '../../eslint.config.mjs';

const nextConfigs = (Array.isArray(next) ? next : [next]).map((config) => ({
  ...config,
  files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'middleware.ts'],
}));

export default [
  ...nextConfigs,
  ...raiz,
  {
    // O eslint-plugin-react resolve a versão do React subindo por node_modules,
    // e o layout estrito do pnpm não expõe o pacote nesse caminho.
    settings: { react: { version: '19.3' } },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  },
];
