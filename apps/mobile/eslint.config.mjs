import raiz from '../../eslint.config.mjs';

export default [
  ...raiz,
  { ignores: ['.expo/**', 'android/**', 'ios/**', 'expo-env.d.ts'] },
  {
    // `@types/node` está no projeto por causa de `app.config.ts` e dos testes,
    // mas no aparelho não existe Node: um `import 'node:fs'` no código do app
    // compilaria e só quebraria na mão do cliente.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'O app roda no aparelho, onde não existe Node.',
            },
          ],
        },
      ],
    },
  },
];
