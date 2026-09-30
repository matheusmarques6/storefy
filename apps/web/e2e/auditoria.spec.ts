/**
 * A12 e A04 — quem fez o quê.
 *
 * A trilha guardava o autor de cada ação desde a Fase 0, e a tela nunca o
 * mostrava. Aqui: o lojista aparece pelo e-mail, a ação do sistema aparece
 * como sistema, e a A04 leva à trilha só daquele cliente.
 */
import { expect, test } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
  tornarPlatformAdmin,
} from './apoio';
import { varrer } from './axe';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('a auditoria diz quem fez: o lojista pelo e-mail, e a A04 leva à trilha do cliente', async ({
  browser,
}) => {
  const cliente = await browser.newContext();
  const equipe = await browser.newContext();
  const paginaDoCliente = await cliente.newPage();
  const paginaDaEquipe = await equipe.newPage();

  const dono = emailDeTeste('auditoria-dono');
  const empresa = `Empresa Auditada ${Math.random().toString(36).slice(2, 8)}`;
  await criarUsuarioConfirmado(dono, empresa);
  await entrar(paginaDoCliente, dono);
  const lojaId = await criarLojaPelaTela(paginaDoCliente, 'Loja Auditada', 'loja-auditada.com.br');
  const { data: loja, error } = await bancoDeTeste()
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  if (error != null) throw new Error(error.message);

  const admin = emailDeTeste('auditoria-equipe');
  const adminId = await criarUsuarioConfirmado(admin, 'Equipe Storefy Auditoria');
  await tornarPlatformAdmin(adminId);
  await entrar(paginaDaEquipe, admin);

  // Na A04, as últimas ações do cliente — com quem fez.
  await paginaDaEquipe.goto(`/admin/organizacoes/${loja.org_id}`);
  const ultimas = paginaDaEquipe.getByRole('region', { name: 'Últimas ações' });
  await expect(ultimas.getByText(dono).first()).toBeVisible();

  // "Ver toda a trilha" abre a A12 só com este cliente, e o autor em cada linha.
  await ultimas.getByRole('link', { name: 'Ver toda a trilha' }).click();
  await paginaDaEquipe.waitForURL(`**/admin/logs?org=${loja.org_id}`);
  await expect(paginaDaEquipe.getByText('Só as ações de', { exact: false })).toContainText(empresa);
  const linhaDaLoja = paginaDaEquipe.getByRole('row').filter({ hasText: 'stores' }).first();
  await expect(linhaDaLoja).toContainText(dono);
  await varrer(paginaDaEquipe, 'A04 com a trilha');

  // A busca mantém o filtro do cliente.
  await paginaDaEquipe.getByRole('searchbox').fill('stores');
  await paginaDaEquipe.getByRole('button', { name: 'Buscar' }).click();
  await expect(paginaDaEquipe).toHaveURL(new RegExp(`org=${loja.org_id}`));
  await expect(paginaDaEquipe.getByText('Só as ações de', { exact: false })).toContainText(empresa);

  // Sem autor, foi o sistema: um build movido pelo workflow, por exemplo.
  const { data: app } = await bancoDeTeste()
    .from('apps')
    .select('id')
    .eq('store_id', lojaId)
    .single();
  await bancoDeTeste()
    .from('builds')
    .insert({ app_id: app?.id ?? '', platform: 'ios', profile: 'production', status: 'queued' });
  await paginaDaEquipe.goto(`/admin/logs?org=${loja.org_id}`);
  await expect(paginaDaEquipe.getByRole('cell', { name: 'O sistema' }).first()).toBeVisible();
  await varrer(paginaDaEquipe, 'A12 com a trilha do cliente');

  // Página depois da última (link antigo) volta para a primeira, com o filtro — sem tela de erro.
  await paginaDaEquipe.goto(`/admin/logs?org=${loja.org_id}&pagina=999`);
  await expect(paginaDaEquipe).toHaveURL(new RegExp(`/admin/logs\\?org=${loja.org_id}$`));
  await expect(paginaDaEquipe.getByRole('cell', { name: 'O sistema' }).first()).toBeVisible();

  // Filtro que não é id de nada não quebra a tela.
  await paginaDaEquipe.goto('/admin/logs?org=nao-e-um-id');
  await expect(paginaDaEquipe.getByRole('heading', { name: 'Auditoria' })).toBeVisible();
  await expect(paginaDaEquipe.getByText('Só as ações de', { exact: false })).toHaveCount(0);

  await cliente.close();
  await equipe.close();
});
