import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta.
 *
 * Precisam de um Supabase alcançável (local via `supabase start`, ou um projeto
 * de teste) com as migrations aplicadas. Sem isso, os testes são pulados com
 * mensagem explicando o que falta, em vez de falharem de um jeito confuso.
 *
 * Os usuários criados aqui são reais, no ambiente de teste, e removidos no
 * final — é a exceção prevista na regra 1 do CLAUDE.md.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://app.localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  workers: 1,
  reporter: process.env.CI === 'true' ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer:
    process.env.E2E_SEM_SERVIDOR === 'true'
      ? undefined
      : {
          command: 'pnpm dev',
          url: BASE_URL,
          reuseExistingServer: process.env.CI !== 'true',
          timeout: 120_000,
        },
});
