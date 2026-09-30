/** A01, A02 e a guarda do painel admin. */
import { expect, test } from './base';
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
import { cifrarComoOServidor } from './shopify-de-teste';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

test('usuário comum autenticado é barrado no admin', async ({ page }) => {
  const email = emailDeTeste('cliente-no-admin');
  await criarUsuarioConfirmado(email, 'Empresa Cliente');
  await entrar(page, email);

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sem-acesso/);
  await expect(page.getByText('Acesso restrito')).toBeVisible();
  // Nada de dado de outras organizações vaza nessa tela.
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('visitante sem sessão é mandado para o login do admin', async ({ page }) => {
  await page.goto('/admin/lojas');
  await expect(page).toHaveURL(/\/admin\/entrar/);
});

test('platform admin enxerga organizações e lojas de todos os clientes', async ({ browser }) => {
  const contextoCliente = await browser.newContext();
  const contextoAdmin = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  const paginaAdmin = await contextoAdmin.newPage();

  const emailCliente = emailDeTeste('cliente-visivel');
  const empresa = `Empresa Visivel ${Math.random().toString(36).slice(2, 8)}`;
  await criarUsuarioConfirmado(emailCliente, empresa);

  await entrar(paginaCliente, emailCliente);
  await paginaCliente.goto('/lojas/nova');
  await paginaCliente.getByLabel('Nome da loja').fill('Loja Visivel');
  await paginaCliente.getByLabel('Endereço da loja').fill('loja-visivel.com.br');
  await paginaCliente.getByRole('button', { name: 'Criar loja' }).click();
  await paginaCliente.waitForURL(/\/lojas\/[0-9a-f-]+/);

  const emailAdmin = emailDeTeste('equipe');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe Storefy');
  await tornarPlatformAdmin(idAdmin);

  await entrar(paginaAdmin, emailAdmin);

  /*
   * A02 primeiro: `/admin` é a visão geral, e a lista de organizações mudou
   * para `/admin/organizacoes`. O cliente criado acima nasce `trialing`, então
   * a plataforma não está vazia e o panorama aparece com "Em teste" contando
   * pelo menos ele.
   */
  await paginaAdmin.goto('/admin');
  await expect(paginaAdmin.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(paginaAdmin.getByRole('heading', { name: 'A plataforma hoje' })).toBeVisible();
  // Faturamento não é inventado: o MRR sai das assinaturas em dia, em reais.
  await expect(
    paginaAdmin.getByRole('link', { name: /^Receita recorrente \(MRR\): R\$\s[\d.]+,\d{2}$/ }),
  ).toBeVisible();

  // E daqui se chega à lista pelo menu.
  await paginaAdmin.getByRole('link', { name: 'Organizações' }).first().click();
  await expect(paginaAdmin).toHaveURL(/\/admin\/organizacoes/);

  await paginaAdmin.getByRole('searchbox').fill(empresa);
  await paginaAdmin.getByRole('button', { name: 'Buscar' }).click();
  await expect(paginaAdmin.getByRole('cell', { name: empresa })).toBeVisible();
  // Sem assinatura, a coluna do plano diz até quando vai o teste.
  await expect(
    paginaAdmin.getByRole('row', { name: new RegExp(empresa) }).getByText(/^Teste até \d/),
  ).toBeVisible();

  // Detalhe mostra loja e membro.
  await paginaAdmin.getByRole('link', { name: 'Detalhes' }).first().click();
  // A loja aparece na tabela de lojas e no bloco "App e push".
  await expect(paginaAdmin.getByRole('cell', { name: 'Loja Visivel' })).toBeVisible();
  await expect(
    paginaAdmin.getByRole('region', { name: 'App e push' }).getByRole('heading', {
      name: 'Loja Visivel',
    }),
  ).toBeVisible();
  await expect(
    paginaAdmin.getByRole('region', { name: 'Membros' }).getByText(emailCliente),
  ).toBeVisible();

  // A auditoria registrou a criação da loja.
  await paginaAdmin.goto('/admin/logs');
  await expect(paginaAdmin.getByRole('cell', { name: 'stores' }).first()).toBeVisible();

  await contextoCliente.close();
  await contextoAdmin.close();
});

/*
 * A equipe da plataforma também é cliente: tem a própria organização. Ao abrir
 * o painel do cliente, é ELA que precisa aparecer.
 *
 * O defeito: o contexto do painel buscava os vínculos confiando só na RLS, e a
 * RLS deixa a equipe ler os vínculos de TODO mundo. O admin caía na
 * organização mais antiga da plataforma — de outro cliente —, com o papel de
 * outra pessoa.
 */
test('admin no painel do cliente vê a própria organização, e não a de outro cliente', async ({
  browser,
}) => {
  const contextoCliente = await browser.newContext();
  const contextoAdmin = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  const paginaAdmin = await contextoAdmin.newPage();

  // O cliente vem PRIMEIRO: a organização dele é mais antiga que a do admin.
  const sufixo = Math.random().toString(36).slice(2, 8);
  const emailCliente = emailDeTeste('cliente-alheio');
  await criarUsuarioConfirmado(emailCliente, `Empresa Alheia ${sufixo}`);
  await entrar(paginaCliente, emailCliente);
  await paginaCliente.goto('/lojas/nova');
  await paginaCliente.getByLabel('Nome da loja').fill(`Loja Alheia ${sufixo}`);
  await paginaCliente.getByLabel('Endereço da loja').fill(`loja-alheia-${sufixo}.com.br`);
  await paginaCliente.getByRole('button', { name: 'Criar loja' }).click();
  await paginaCliente.waitForURL(/\/lojas\/[0-9a-f-]+/);

  const emailAdmin = emailDeTeste('equipe-cliente');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, `Equipe Propria ${sufixo}`);
  await tornarPlatformAdmin(idAdmin);
  await entrar(paginaAdmin, emailAdmin);

  await expect(
    paginaAdmin.getByText(`Storefy by Convertfy · Equipe Propria ${sufixo}`),
  ).toBeVisible();

  await paginaAdmin.goto('/lojas');
  await expect(paginaAdmin.getByText(`Loja Alheia ${sufixo}`)).toHaveCount(0);
  await expect(paginaAdmin.getByText(`Empresa Alheia ${sufixo}`)).toHaveCount(0);

  await contextoCliente.close();
  await contextoAdmin.close();
});

/*
 * A03: a equipe anda pela base pelos filtros — plano, situação, etapa do
 * começo e saúde —, e cada linha diz se o cliente precisa de alguém e por quê.
 */
test('A03: os filtros acham o cliente que precisa de alguém, e dizem por quê', async ({ page }) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const emailParado = emailDeTeste('a03-parado');
  const idParado = await criarUsuarioConfirmado(emailParado, `Cliente Parado ${sufixo}`);
  const emailEmDia = emailDeTeste('a03-em-dia');
  await criarUsuarioConfirmado(emailEmDia, `Cliente Em Dia ${sufixo}`);

  // O teste do "parado" acabou ontem, e ele não assinou.
  const banco = bancoDeTeste();
  const { data: vinculo } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', idParado)
    .single();
  const { error } = await banco
    .from('organizations')
    .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
    .eq('id', vinculo?.org_id ?? '');
  expect(error).toBeNull();

  const emailAdmin = emailDeTeste('equipe-a03');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A03');
  await tornarPlatformAdmin(idAdmin);
  await entrar(page, emailAdmin);

  await page.goto(`/admin/organizacoes?q=${encodeURIComponent(sufixo)}`);
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }),
  ).toBeVisible();

  // Saúde crítica: só o parado, com o motivo e a etapa na linha.
  await page.getByLabel('Saúde').selectOption('critica');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(/saude=critica/);
  await expect(page).toHaveURL(new RegExp(`q=${sufixo}`));
  const parado = page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) });
  await expect(parado).toBeVisible();
  await expect(parado.getByText('Crítica')).toBeVisible();
  await expect(parado.getByText('O teste acabou sem assinatura')).toBeVisible();
  await expect(parado.getByText('Sem loja')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) })).toHaveCount(
    0,
  );

  // A busca mantém o filtro; filtro sem resultado diz "nada encontrado".
  await page.getByLabel('Etapa do começo').selectOption('no_ar');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByText('Nada encontrado')).toBeVisible();
  await expect(
    page.getByText('Nenhuma organização corresponde à busca e aos filtros escolhidos.'),
  ).toBeVisible();

  // Limpar tira os filtros e mantém a busca — e os seletores voltam a "Todos".
  await page.getByRole('link', { name: 'Limpar filtros' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/organizacoes\\?q=${sufixo}$`));
  await expect(page.getByLabel('Saúde')).toHaveValue('');
  await expect(page.getByLabel('Etapa do começo')).toHaveValue('');
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }),
  ).toBeVisible();
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Em Dia ${sufixo}`) }).getByText('Boa'),
  ).toBeVisible();

  // Filtro inventado na URL é ignorado, e não vira erro.
  await page.goto(`/admin/organizacoes?q=${sufixo}&saude=hackeada&etapa=%27%3B`);
  await expect(
    page.getByRole('row', { name: new RegExp(`Cliente Parado ${sufixo}`) }),
  ).toBeVisible();
});

/*
 * A06: cada app na revisão diz o próximo passo. O Android vai para a trilha
 * interna, que não passa por revisão — ali não há "revisão parada", e sim o
 * lojista que ainda não promoveu a versão.
 */
test('A06: o próximo passo de cada revisão, sem alarme falso no Android', async ({ page }) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const email = emailDeTeste('a06-cliente');
  const idCliente = await criarUsuarioConfirmado(email, `Empresa Revisao ${sufixo}`);
  const banco = bancoDeTeste();
  const { data: vinculo } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', idCliente)
    .single();
  const { data: loja } = await banco
    .from('stores')
    .insert({
      org_id: vinculo?.org_id ?? '',
      name: `Loja Revisao ${sufixo}`,
      primary_url: `https://revisao-${sufixo}.com.br`,
    })
    .select('id')
    .single();
  const { data: app } = await banco
    .from('apps')
    .select('id')
    .eq('store_id', loja?.id ?? '')
    .single();

  // O que o pipeline de build gravaria: um Android na trilha interna há 20
  // dias e um iPhone recusado pela ficha.
  const vinteDias = new Date(Date.now() - 20 * 86_400_000).toISOString();
  const { error } = await banco.from('builds').insert([
    {
      app_id: app?.id ?? '',
      platform: 'android',
      status: 'submitted',
      version: '1.0.0',
      submitted_at: vinteDias,
    },
    {
      app_id: app?.id ?? '',
      platform: 'ios',
      status: 'rejected',
      version: '1.0.0',
      submitted_at: vinteDias,
      error:
        'A Apple recusou as informações da ficha do app (nome, descrição, capturas ou política de privacidade). Corrija no App Store Connect e envie de novo.',
    },
  ]);
  expect(error).toBeNull();

  const emailAdmin = emailDeTeste('equipe-a06');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A06');
  await tornarPlatformAdmin(idAdmin);
  await entrar(page, emailAdmin);
  await page.goto('/admin/revisoes');

  const android = page
    .getByRole('row', { name: new RegExp(`Loja Revisao ${sufixo}`) })
    .filter({ hasText: 'Google' });
  await expect(android.getByText('Na trilha interna', { exact: true })).toBeVisible();
  await expect(android.getByText('Promover para produção')).toBeVisible();
  await expect(android.getByText('Cobrar', { exact: false })).toHaveCount(0);

  const iphone = page
    .getByRole('row', { name: new RegExp(`Loja Revisao ${sufixo}`) })
    .filter({ hasText: 'Apple' });
  await expect(iphone.getByText('Corrigir a ficha do app')).toBeVisible();
  await varrer(page, 'A06 com as revisões');
  await expect(iphone.getByRole('link', { name: `Empresa Revisao ${sufixo}` })).toHaveAttribute(
    'href',
    `/admin/organizacoes/${vinculo?.org_id ?? ''}`,
  );
});

/*
 * A07: a equipe confere de novo a credencial de um cliente. O que está
 * guardado e não serve deixa a conta "com erro", com o motivo — e a
 * conferência fica na auditoria com quem fez. Conta sem credencial não tem o
 * que conferir, e nem mostra o botão.
 */
test('A07: revalidar a credencial marca o erro com o motivo e fica na auditoria', async ({
  page,
}) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const email = emailDeTeste('a07-cliente');
  const idCliente = await criarUsuarioConfirmado(email, `Empresa Contas ${sufixo}`);
  const banco = bancoDeTeste();
  const { data: vinculo } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', idCliente)
    .single();
  const orgId = vinculo?.org_id ?? '';

  // Uma conta do Google "verificada" cujo arquivo guardado não é mais um JSON
  // (o caso de uma credencial corrompida), e uma Apple que nunca começou.
  const { data: contas, error } = await banco
    .from('developer_accounts')
    .insert([
      {
        org_id: orgId,
        platform: 'google',
        status: 'verified',
        verified_at: new Date().toISOString(),
        google_service_account_enc: cifrarComoOServidor('{isto não é o json da conta'),
        notes: 'storefy@exemplo.iam.gserviceaccount.com',
      },
      { org_id: orgId, platform: 'apple', status: 'pending' },
    ])
    .select('id, platform');
  expect(error).toBeNull();
  const idGoogle = contas?.find((conta) => conta.platform === 'google')?.id ?? '';

  const emailAdmin = emailDeTeste('equipe-a07');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A07');
  await tornarPlatformAdmin(idAdmin);
  await entrar(page, emailAdmin);
  await page.goto('/admin/contas');

  const linhaGoogle = page
    .getByRole('row', { name: new RegExp(`Empresa Contas ${sufixo}`) })
    .filter({ hasText: 'Google' });
  const linhaApple = page
    .getByRole('row', { name: new RegExp(`Empresa Contas ${sufixo}`) })
    .filter({ hasText: 'Apple' });
  await expect(linhaGoogle.getByText('Verificada')).toBeVisible();
  await expect(linhaApple.getByRole('button', { name: /Revalidar/ })).toHaveCount(0);

  await linhaGoogle
    .getByRole('button', { name: `Revalidar a conta Google de Empresa Contas ${sufixo}` })
    .click();
  await expect(
    page.getByText('A credencial da Google não vale mais:', { exact: false }),
  ).toBeVisible();
  await expect(linhaGoogle.getByText('Com erro')).toBeVisible();
  await expect(
    linhaGoogle.getByText('Esse arquivo não é um JSON válido', { exact: false }),
  ).toBeVisible();
  await varrer(page, 'A07 com as contas');

  const { data: conta } = await banco
    .from('developer_accounts')
    .select('status, verified_at')
    .eq('id', idGoogle)
    .single();
  expect(conta).toEqual({ status: 'error', verified_at: null });

  // A trilha diz QUEM conferiu: a mudança é gravada pela sessão da equipe.
  const { data: trilha } = await banco
    .from('audit_logs')
    .select('actor_id, diff')
    .eq('entity', 'developer_accounts')
    .eq('entity_id', idGoogle)
    .eq('action', 'update');
  expect(trilha).toHaveLength(1);
  expect(trilha?.[0]).toMatchObject({
    actor_id: idAdmin,
    diff: { status: { de: 'verified', para: 'error' }, verified_at: { para: null } },
  });
});

test('A10: o preset nasce de uma loja no ar, com o tema dela, e chega ao lojista daquele tema', async ({
  browser,
}) => {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const loja = `Loja Modelo ${sufixo}`;
  const empresa = `Empresa Modelo ${sufixo}`;
  const preset = `Dawn — modelo ${sufixo}`;

  // A loja modelo: publicada, com o tema lido da página (como o cadastro grava).
  const cliente = await (await browser.newContext()).newPage();
  const emailCliente = emailDeTeste('a10-cliente');
  await criarUsuarioConfirmado(emailCliente, empresa);
  await entrar(cliente, emailCliente);
  const lojaId = await criarLojaPelaTela(cliente, loja, `loja-modelo-${sufixo}.com.br`);
  await cliente.goto('/app');
  await cliente.waitForLoadState('networkidle');
  const barra = cliente.getByRole('region', { name: 'Publicação do app' });
  await barra.getByRole('button', { name: /Publicar alterações/ }).click();
  await cliente.getByRole('button', { name: 'Publicar agora' }).click();
  await expect(cliente.getByText(/Versão \d+ publicada/)).toBeVisible();
  const { error } = await bancoDeTeste()
    .from('stores')
    .update({ shopify_theme: 'Dawn' })
    .eq('id', lojaId);
  expect(error).toBeNull();

  const admin = await (await browser.newContext()).newPage();
  const emailAdmin = emailDeTeste('equipe-a10');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A10');
  await tornarPlatformAdmin(idAdmin);
  await entrar(admin, emailAdmin);
  await admin.goto('/admin/presets');

  // A loja aparece com o tema dela, e escolhê-la preenche o tema do preset.
  await admin.getByLabel('Copiar de').selectOption({ label: `${loja} · ${empresa} · tema Dawn` });
  await expect(admin.getByLabel('Tema da Shopify')).toHaveValue('Dawn');
  await admin.getByLabel('Nome', { exact: true }).fill(preset);
  await admin.getByRole('button', { name: 'Criar preset' }).click();
  await expect(admin.getByText(`Preset "${preset}" criado a partir dessa loja.`)).toBeVisible();
  const linha = admin.getByRole('row', { name: new RegExp(preset) });
  await expect(linha).toContainText('Dawn');
  await expect(linha.getByText('Visível')).toBeVisible();
  await varrer(admin, 'A10 com o preset');

  // A curadoria fica na trilha, com quem da equipe fez.
  const { data: criado } = await bancoDeTeste()
    .from('config_presets')
    .select('id')
    .eq('nome', preset)
    .single();
  const idDoPreset = criado?.id ?? '';
  const trilha = async (acao: 'create' | 'update' | 'delete') => {
    const { data } = await bancoDeTeste()
      .from('audit_logs')
      .select('actor_id')
      .eq('entity', 'config_presets')
      .eq('entity_id', idDoPreset)
      .eq('action', acao);
    return (data ?? []).map((linhaDaTrilha) => linhaDaTrilha.actor_id);
  };
  expect(await trilha('create')).toEqual([idAdmin]);

  try {
    // O lojista do tema Dawn vê o preset em primeiro, marcado.
    const itemDoPreset = cliente.locator('li').filter({ hasText: preset });
    const abrirLoja = async () => {
      await cliente.reload();
      await cliente.waitForLoadState('networkidle');
      await cliente
        .getByRole('navigation', { name: 'Seções do editor' })
        .getByRole('button', { name: 'Loja' })
        .click();
    };
    await abrirLoja();
    await expect(cliente.getByTestId('tema-da-loja')).toContainText('Sua loja usa o tema Dawn.');
    await expect(itemDoPreset).toContainText('Feito para o seu tema');

    // Desligado, some da lista do lojista.
    await linha.getByRole('button', { name: 'Desligar' }).click();
    await expect(linha.getByText('Desligado')).toBeVisible();
    expect(await trilha('update')).toEqual([idAdmin]);
    await abrirLoja();
    await expect(itemDoPreset).toHaveCount(0);
  } finally {
    // Apagado, some da curadoria — e não fica para os outros testes.
    await linha.getByRole('button', { name: 'Apagar' }).click();
    await admin.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();
    await expect(linha).toHaveCount(0);
    await expect.poll(() => trilha('delete')).toEqual([idAdmin]);
  }
});

/*
 * A05: a fila de builds recortada como o suporte procura — pela loja ou pelo
 * cliente, pela plataforma, e a partir do detalhe do cliente (A04). Os
 * recortes somam, vivem na URL e sobrevivem à troca de situação.
 */
test('A05: a fila de builds filtra por loja, cliente e plataforma', async ({ page }) => {
  test.setTimeout(90_000);
  const sufixo = Math.random().toString(36).slice(2, 8);
  const banco = bancoDeTeste();

  async function clienteComBuilds(rotulo: string, plataformas: ('ios' | 'android')[]) {
    const idCliente = await criarUsuarioConfirmado(
      emailDeTeste(`a05-${rotulo}`),
      `Empresa ${rotulo} ${sufixo}`,
    );
    const { data: vinculo } = await banco
      .from('memberships')
      .select('org_id')
      .eq('user_id', idCliente)
      .single();
    const orgId = vinculo?.org_id ?? '';
    const { data: loja } = await banco
      .from('stores')
      .insert({
        org_id: orgId,
        name: `Loja ${rotulo} ${sufixo}`,
        primary_url: `https://${rotulo}-${sufixo}.com.br`,
      })
      .select('id')
      .single();
    const { data: app } = await banco
      .from('apps')
      .select('id')
      .eq('store_id', loja?.id ?? '')
      .single();
    const { error } = await banco.from('builds').insert(
      plataformas.map((platform) => ({
        app_id: app?.id ?? '',
        platform,
        status: 'errored' as const,
        error: `Falhou no ${platform} da ${rotulo}`,
      })),
    );
    expect(error).toBeNull();
    return orgId;
  }

  const orgAlfa = await clienteComBuilds('Alfa', ['ios', 'android']);
  await clienteComBuilds('Beta', ['ios']);

  const emailAdmin = emailDeTeste('equipe-a05');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A05');
  await tornarPlatformAdmin(idAdmin);
  await entrar(page, emailAdmin);

  const linhas = page.getByRole('row').filter({ hasText: sufixo });

  // Pela loja: só a Alfa, nas duas plataformas.
  await page.goto('/admin/builds');
  await page.getByLabel('Buscar pela loja ou pelo cliente').fill(`Loja Alfa ${sufixo}`);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(linhas).toHaveCount(2);
  await expect(linhas.filter({ hasText: 'Loja Beta' })).toHaveCount(0);

  // A plataforma soma com a busca, e as duas ficam na URL.
  await page
    .getByRole('navigation', { name: 'Plataforma' })
    .getByRole('link', { name: 'iOS', exact: true })
    .click();
  await expect(page).toHaveURL(/plataforma=ios/);
  await expect(page).toHaveURL(/q=Loja/);
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toContainText('Falhou no ios da Alfa');
  await varrer(page, 'A05 com builds');

  // Trocar a situação não perde os outros recortes.
  await page
    .getByRole('navigation', { name: 'Filtrar builds' })
    .getByRole('link', { name: 'Todos' })
    .click();
  await expect(page).toHaveURL(/filtro=todos/);
  await expect(page).toHaveURL(/plataforma=ios/);
  await expect(linhas).toHaveCount(1);

  // Pelo nome do cliente (duas tabelas abaixo do build).
  await page.goto('/admin/builds');
  await page.getByLabel('Buscar pela loja ou pelo cliente').fill(`Empresa Beta ${sufixo}`);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toContainText(`Loja Beta ${sufixo}`);

  // Nada casa: o vazio diz que é o filtro, e não a fila.
  await page.getByLabel('Buscar pela loja ou pelo cliente').fill(`nada-${sufixo}`);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('Nenhum build com esses filtros')).toBeVisible();

  // Do detalhe do cliente, a fila só dele — e o caminho de volta para todos.
  await page.goto(`/admin/organizacoes/${orgAlfa}`);
  await page.getByRole('link', { name: 'Ver todos os builds deste cliente' }).click();
  await expect(page).toHaveURL(new RegExp(`org=${orgAlfa}`));
  await expect(page.getByText(`Só os builds de Empresa Alfa ${sufixo}`)).toBeVisible();
  await varrer(page, 'A04 com os builds');
  await expect(linhas).toHaveCount(2);
  await page.getByRole('link', { name: 'Ver de todos os clientes' }).click();
  await expect(page).not.toHaveURL(/org=/);

  // Um cliente que não existe sai do filtro; um valor que não é id é ignorado.
  await page.goto('/admin/builds?filtro=todos&org=00000000-0000-4000-8000-000000000000');
  await expect(page).not.toHaveURL(/org=/);
  await page.goto('/admin/builds?filtro=todos&org=nao-e-um-id');
  await expect(page.getByText('Só os builds de')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Builds' })).toBeVisible();
});

/*
 * O build que parou no meio — na fila há horas, o workflow morreu antes da
 * EAS — travava a loja para sempre: a publicação recusa com um em andamento,
 * e o reexecutar só aceita o que falhou. Agora o lojista lê que pode ter
 * parado, e a equipe o encerra na A05, com o nome dela na trilha.
 */
test('A05: o build parado aparece com problema, e a equipe o encerra', async ({ browser }) => {
  test.setTimeout(90_000);
  const sufixo = Math.random().toString(36).slice(2, 8);
  const banco = bancoDeTeste();

  const emailCliente = emailDeTeste('a05-parado');
  const idCliente = await criarUsuarioConfirmado(emailCliente, `Empresa Parada ${sufixo}`);
  const contextoCliente = await browser.newContext();
  const paginaCliente = await contextoCliente.newPage();
  await entrar(paginaCliente, emailCliente);
  const lojaId = await criarLojaPelaTela(
    paginaCliente,
    `Loja Parada ${sufixo}`,
    `parada-${sufixo}.com.br`,
  );
  const { data: app } = await banco.from('apps').select('id').eq('store_id', lojaId).single();

  // Na fila há duas horas: o workflow nunca chamou a Storefy de volta.
  const duasHoras = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: build, error } = await banco
    .from('builds')
    .insert({
      app_id: app?.id ?? '',
      platform: 'ios',
      status: 'queued',
      triggered_by: idCliente,
      created_at: duasHoras,
    })
    .select('id')
    .single();
  if (error != null) throw new Error(error.message);

  // O lojista lê que pode ter parado, e não "esperando a vez".
  await paginaCliente.goto('/publicacao');
  await expect(paginaCliente.getByText('Está demorando mais que o normal')).toBeVisible();
  await varrer(paginaCliente, 'C12 com o build demorando');
  await expect(paginaCliente.getByText('Esperando a vez.')).toHaveCount(0);

  // A equipe o vê em "Com problema", o recorte com que a A05 abre.
  const emailAdmin = emailDeTeste('equipe-a05-parado');
  const idAdmin = await criarUsuarioConfirmado(emailAdmin, 'Equipe A05 Parado');
  await tornarPlatformAdmin(idAdmin);
  const contextoAdmin = await browser.newContext();
  const paginaAdmin = await contextoAdmin.newPage();
  await entrar(paginaAdmin, emailAdmin);
  await paginaAdmin.goto(`/admin/builds?q=${encodeURIComponent(`Loja Parada ${sufixo}`)}`);
  const linha = paginaAdmin.getByRole('row', { name: new RegExp(`Loja Parada ${sufixo}`) });
  await expect(linha.getByText(/Parado · Na fila há 2 h/)).toBeVisible();
  await varrer(paginaAdmin, 'A05 com o build parado');

  // Encerrar pede confirmação, e "Voltar" não mexe em nada.
  await linha.getByRole('button', { name: 'Encerrar' }).click();
  const confirmacao = paginaAdmin.getByRole('alertdialog');
  await expect(confirmacao).toContainText('confira nos logs');
  await varrer(paginaAdmin, 'A05 com a confirmação de encerrar');
  await confirmacao.getByRole('button', { name: 'Voltar' }).click();
  await linha.getByRole('button', { name: 'Encerrar' }).click();
  await confirmacao.getByRole('button', { name: 'Encerrar build' }).click();
  await expect(paginaAdmin.getByText('Build encerrado.', { exact: false })).toBeVisible();
  await expect(linha.getByText('Parado', { exact: false })).toHaveCount(0);

  // O build vira falha com o motivo, e a trilha diz quem encerrou.
  const { data: encerrado } = await banco
    .from('builds')
    .select('status, error')
    .eq('id', build.id)
    .single();
  expect(encerrado?.status).toBe('errored');
  expect(encerrado?.error).toContain('encerrada pela equipe da Storefy');
  // Na organização da loja, para aparecer no detalhe do cliente (A04) e na A12.
  const { data: lojaDoBuild } = await banco
    .from('stores')
    .select('org_id')
    .eq('id', lojaId)
    .single();
  await expect
    .poll(async () => {
      const { data } = await banco
        .from('audit_logs')
        .select('actor_id, org_id')
        .eq('entity', 'builds')
        .eq('entity_id', build.id)
        .eq('action', 'update');
      return (data ?? []).map((trilha) => `${trilha.actor_id ?? ''}:${trilha.org_id ?? ''}`);
    })
    .toContain(`${idAdmin}:${lojaDoBuild?.org_id ?? ''}`);

  // O lojista vê o motivo, e a publicação deixa de estar travada.
  await paginaCliente.goto('/publicacao');
  await expect(paginaCliente.getByText('encerrada pela equipe da Storefy')).toBeVisible();
  await varrer(paginaCliente, 'C12 com o build encerrado');
  await expect(paginaCliente.getByText('Está demorando mais que o normal')).toHaveCount(0);

  await contextoCliente.close();
  await contextoAdmin.close();
});

test('A-OTA: a rodada parada trava a próxima correção até a equipe encerrá-la', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sufixo = Math.random().toString(36).slice(2, 8);
  const banco = bancoDeTeste();

  const email = emailDeTeste('equipe-ota-parada');
  const idAdmin = await criarUsuarioConfirmado(email, `Equipe OTA ${sufixo}`);
  await tornarPlatformAdmin(idAdmin);

  // Uma loja em que a rodada anterior falhou, para a lista dizer onde.
  const { data: membro } = await banco
    .from('memberships')
    .select('org_id')
    .eq('user_id', idAdmin)
    .single();
  const { data: loja, error: erroDaLoja } = await banco
    .from('stores')
    .insert({
      org_id: membro?.org_id ?? '',
      name: `Loja Sem Correção ${sufixo}`,
      primary_url: `https://sem-correcao-${sufixo}.com.br`,
    })
    .select('id')
    .single();
  if (erroDaLoja != null) throw new Error(erroDaLoja.message);

  // A de três horas falhou numa loja; a de duas está na fila até hoje.
  const horasAtras = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();
  const { data: rodadas, error } = await banco
    .from('ota_updates')
    .insert(
      [
        {
          message: `Rodada com falha ${sufixo}`,
          status: 'errored',
          total: 2,
          concluidas: 1,
          falhas: 1,
          lojas_contadas: [loja.id, crypto.randomUUID()],
          lojas_com_falha: [loja.id],
          created_at: horasAtras(3),
          finished_at: horasAtras(3),
        },
        { message: `Rodada parada ${sufixo}`, triggered_by: idAdmin, created_at: horasAtras(2) },
        // Sem isto, a coluna que só a primeira linha traz vai nula na segunda.
      ],
      { defaultToNull: false },
    )
    .select('id, message');
  if (error != null) throw new Error(error.message);
  const idDaParada = rodadas.find((rodada) => rodada.message.startsWith('Rodada parada'))?.id ?? '';

  try {
    await entrar(page, email);
    await page.goto('/admin/ota');

    // A lista diz em que loja a correção falhou, com o caminho até o cliente.
    const comFalha = page.getByRole('listitem').filter({ hasText: `Rodada com falha ${sufixo}` });
    await expect(comFalha.getByRole('link', { name: `Loja Sem Correção ${sufixo}` })).toBeVisible();

    // A rodada parada trava o formulário, e a tela diz por quê e o que fazer.
    await expect(
      page.getByText('A rodada anterior parou no meio.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar em todas as lojas' })).toHaveCount(0);
    const parada = page.getByRole('listitem').filter({ hasText: `Rodada parada ${sufixo}` });
    await expect(parada.getByText('Parada · Na fila há 2 h')).toBeVisible();
    await varrer(page, 'A-OTA com a rodada parada');

    // Encerrar pede confirmação, e "Voltar" não mexe em nada.
    await parada.getByRole('button', { name: 'Encerrar' }).click();
    const confirmacao = page.getByRole('alertdialog');
    await expect(confirmacao).toContainText('Actions › ota-update');
    await confirmacao.getByRole('button', { name: 'Voltar' }).click();
    const { data: antes } = await banco
      .from('ota_updates')
      .select('status')
      .eq('id', idDaParada)
      .single();
    expect(antes?.status).toBe('queued');

    await parada.getByRole('button', { name: 'Encerrar' }).click();
    await confirmacao.getByRole('button', { name: 'Encerrar rodada' }).click();
    await expect(page.getByText('Rodada encerrada.', { exact: false })).toBeVisible();
    await expect(parada.getByText('Com falha')).toBeVisible();
    await expect(parada.getByText('Encerrada pela equipe', { exact: false })).toBeVisible();
    await expect(parada.getByText(/^Parada ·/)).toHaveCount(0);

    // O formulário volta: a próxima correção já pode sair.
    await expect(page.getByRole('button', { name: 'Publicar em todas as lojas' })).toBeVisible();

    // A trilha diz quem encerrou, sem organização: a correção é da plataforma.
    await expect
      .poll(async () => {
        const { data } = await banco
          .from('audit_logs')
          .select('actor_id, org_id')
          .eq('entity', 'ota_updates')
          .eq('entity_id', idDaParada)
          .eq('action', 'update');
        return (data ?? []).map(
          (trilha) => `${trilha.actor_id ?? ''}:${trilha.org_id ?? 'sem-org'}`,
        );
      })
      .toContain(`${idAdmin}:sem-org`);
  } finally {
    await banco
      .from('ota_updates')
      .delete()
      .in(
        'id',
        rodadas.map((rodada) => rodada.id),
      );
  }
});
