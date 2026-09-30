/**
 * A página pública de status e as rotinas na A13 (Fase 8).
 *
 * O batimento de cada rotina é gravado pelo job do cron; aqui ele é gravado
 * direto, pela mesma função que o job chama, porque o cron da Vercel não roda
 * na máquina do teste. O que se prova é o caminho do dado até a tela: o
 * público vê a situação sem o erro, e a equipe vê o erro.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './base';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);

test.afterAll(async () => {
  // Os batimentos são do ambiente, e este teste os escreveu: saem junto.
  await bancoDeTeste().from('job_heartbeats').delete().neq('job', '');
  await limparUsuariosDeTeste();
});

function rotina(page: Page, nome: string) {
  return page.getByRole('listitem').filter({ hasText: nome });
}

test('a página de status abre sem login e mostra o batimento de verdade de cada rotina', async ({
  page,
  browser,
}) => {
  const banco = bancoDeTeste();
  await banco.from('job_heartbeats').delete().neq('job', '');

  // Sem login, e sem batimento nenhum: o banco responde, as rotinas aguardam.
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Status do Storefy' })).toBeVisible();
  await expect(rotina(page, 'Banco de dados').getByText('Funcionando')).toBeVisible();
  await expect(rotina(page, 'Envio de notificações').getByText('Aguardando')).toBeVisible();
  await expect(page.getByText('Ainda não rodou neste ambiente.').first()).toBeVisible();

  // O cron roda: o despacho deu certo agora; as estatísticas acabaram de falhar
  // — uma falha só é "instável", porque a próxima execução tenta de novo.
  const certo = await banco.rpc('registrar_batimento', {
    p_job: 'dispatch-push',
    p_ok: true,
    p_duracao_ms: 420,
  });
  expect(certo.error).toBeNull();
  const falhou = await banco.rpc('registrar_batimento', {
    p_job: 'push-stats',
    p_ok: false,
    p_erro: 'OneSignal respondeu 503',
  });
  expect(falhou.error).toBeNull();

  await page.reload();
  await expect(rotina(page, 'Envio de notificações').getByText('Funcionando')).toBeVisible();
  await expect(rotina(page, 'Estatísticas das notificações').getByText('Instável')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    'Parte do sistema está com atraso ou instabilidade.',
  );
  // O texto do erro é da equipe, e não do público.
  await expect(page.getByText('OneSignal respondeu 503')).toHaveCount(0);

  // A equipe vê o erro, na A13.
  const equipe = await (await browser.newContext()).newPage();
  const email = emailDeTeste('status-equipe');
  await tornarPlatformAdmin(await criarUsuarioConfirmado(email, 'Equipe Status'));
  await entrar(equipe, email);
  await equipe.goto('/admin/sistema');
  const rotinas = equipe.getByRole('region', { name: 'Rotinas automáticas' });
  await expect(rotinas.getByText(/OneSignal respondeu 503/)).toBeVisible();
  await expect(rotinas.getByText('A última execução levou 0,4 s.')).toBeVisible();
  await expect(rotinas.getByRole('link', { name: 'página de status' })).toHaveAttribute(
    'href',
    '/status',
  );

  // E o relatório de erro do navegador, sem Sentry configurado, não faz nada.
  // Pelo próprio navegador: é de lá que ele sai, e só ele resolve `app.localhost`.
  const status = await page.evaluate(async () => {
    const resposta = await fetch('/api/erros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'Error', mensagem: 'x', pagina: '/', onde: 'janela' }),
    });
    return resposta.status;
  });
  expect(status).toBe(204);
});
