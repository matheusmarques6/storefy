/**
 * O `test` de todos os e2e: o do Playwright com uma trava a mais — nenhum
 * teste passa com erro no console ou exceção na página (regra 4 do
 * CLAUDE.md: "nunca entregue com erro no console").
 *
 * Toda página do teste tem os erros anotados, com o endereço onde
 * apareceram — a principal, as que ele abrir e as dos contextos que ele criar
 * com `browser.newContext()` (o cliente e a equipe lado a lado); no fim, o
 * teste falha se sobrou algum que ele não declarou. O teste que provoca um erro de
 * propósito (a internet que cai, o site de fora que tenta enquadrar o
 * painel) diz qual espera com `errosDoConsole.esperar(/.../)`.
 *
 * "Failed to load resource" não conta: é o navegador registrando uma
 * resposta 4xx ou 5xx, e os testes pedem muitas de propósito (o webhook sem
 * assinatura, a página que não existe, a rota sem sessão). O que a trava
 * procura é o código da página: exceção sem tratamento, erro de hidratação,
 * `console.error` do React, do Next ou nosso.
 */
import { test as base, type BrowserContext, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

export interface ErrosDoConsole {
  /** Declara um erro que o teste provoca de propósito. */
  esperar: (padrao: RegExp) => void;
}

const RESPOSTA_COM_ERRO = 'Failed to load resource: ';

export const test = base.extend<{ errosDoConsole: ErrosDoConsole }>({
  errosDoConsole: [
    async ({ browser, context }, usar, info) => {
      const vistos: string[] = [];
      const esperados: RegExp[] = [];

      function observar(pagina: Page) {
        pagina.on('console', (mensagem) => {
          if (mensagem.type() !== 'error' || mensagem.text().startsWith(RESPOSTA_COM_ERRO)) return;
          vistos.push(`${pagina.url()} → ${mensagem.text()}`);
        });
        pagina.on('pageerror', (erro) => {
          vistos.push(`${pagina.url()} → exceção: ${erro.message}`);
        });
      }
      function observarContexto(contexto: BrowserContext) {
        contexto.pages().forEach(observar);
        contexto.on('page', observar);
      }
      observarContexto(context);

      /*
       * O navegador é o mesmo durante o arquivo inteiro, e os testes rodam um
       * de cada vez: o `newContext` vigiado vale só enquanto este teste roda.
       */
      const criarContexto = browser.newContext.bind(browser);
      browser.newContext = async (...opcoes) => {
        const contexto = await criarContexto(...opcoes);
        observarContexto(contexto);
        return contexto;
      };
      try {
        await usar({
          esperar: (padrao) => {
            esperados.push(padrao);
          },
        });
      } finally {
        browser.newContext = criarContexto;
      }

      const inesperados = vistos.filter((erro) => !esperados.some((padrao) => padrao.test(erro)));
      if (inesperados.length > 0) {
        throw new Error(
          `"${info.title}" terminou com ${String(inesperados.length)} erro(s) no console:\n` +
            inesperados.map((erro) => `  - ${erro}`).join('\n'),
        );
      }
    },
    { auto: true },
  ],
});
