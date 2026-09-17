// Configuração raiz do ESLint (flat config).
// `apps/web` estende esta base e acrescenta as regras do Next.js.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      // Skills e agents instalados: conteúdo de terceiros, versionado como veio.
      '.claude/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.generated.ts',
      'packages/db/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Regra 1 do CLAUDE.md: nada de `any` sem justificativa explícita.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `catch` que engole erro é proibido pela regra 3.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Evita `if (erro)` silencioso em valores possivelmente nulos.
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Arquivos de configuração da raiz não pertencem a nenhum tsconfig de
    // pacote, então o project service não consegue tipá-los. Sem desligar as
    // regras que exigem tipos, o lint quebra com "was not found by the
    // project service".
    files: ['*.config.{js,mjs,ts}', 'eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Scripts operacionais rodam fora do bundle da aplicação e lidam com JSON
    // externo, onde o tipo só é conhecido em tempo de execução.
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
