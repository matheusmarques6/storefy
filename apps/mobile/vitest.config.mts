import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Só a lógica pura. Componentes React Native precisam de aparelho ou de
    // um runner nativo; testá-los com mock de módulo nativo prova pouco.
    include: ['src/**/*.test.ts'],
  },
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
});
