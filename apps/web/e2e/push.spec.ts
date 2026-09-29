/**
 * Campanhas de push (C07, C08, C10): o ciclo inteiro, pela tela.
 *
 * O primeiro teste é o que importa: a hora que o lojista escolhe é a hora da
 * LOJA. O campo `datetime-local` manda "2026-09-30T20:00" sem fuso; o servidor
 * lia isso no fuso do processo — UTC na Vercel — e toda campanha agendada saía
 * três horas antes. Os testes de unidade não viam porque passavam a hora já
 * com `Z`. Este aqui passa pelo mesmo caminho que o lojista.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  MOTIVO_PULO,
  SUPABASE_DISPONIVEL,
  bancoDeTeste,
  criarLojaPelaTela,
  criarUsuarioConfirmado,
  emailDeTeste,
  entrar,
  limparUsuariosDeTeste,
} from './apoio';
import { pngDeCorLisa } from './imagens';

test.skip(!SUPABASE_DISPONIVEL, MOTIVO_PULO);
test.afterAll(limparUsuariosDeTeste);

/** A data de amanhã, no fuso dado ("2026-09-30"). */
function amanhaNoFuso(fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(Date.now() + 86_400_000);
}

/**
 * O instante UTC de uma hora de relógio no fuso — calculado aqui pelo `Intl`,
 * e não pela função do produto: um teste que usa o código que testa não prova
 * nada.
 */
function utcDe(data: string, hora: string, fuso: string): string {
  const meioDia = new Date(`${data}T12:00:00Z`);
  const nome =
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' })
      .formatToParts(meioDia)
      .find((parte) => parte.type === 'timeZoneName')?.value ?? 'GMT';
  const achado = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  const minutos =
    achado === null
      ? 0
      : (achado[1] === '-' ? -1 : 1) * (Number(achado[2]) * 60 + Number(achado[3]));
  const [h, m] = hora.split(':').map(Number) as [number, number];
  const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia, h, m) - minutos * 60_000).toISOString();
}

async function campanhaNoBanco(titulo: string) {
  const { data, error } = await bancoDeTeste()
    .from('push_campaigns')
    .select('id, status, scheduled_at, title, body, deep_link')
    .eq('title', titulo)
    .maybeSingle();
  if (error != null) throw new Error(error.message);
  return data;
}

/**
 * Abre a página e espera o React assumir os campos.
 *
 * O `goto` volta no `load`, e o formulário ainda pode estar sem o React: o
 * que o teste digitar ali o React apaga ao hidratar — o campo é controlado, e
 * o estado dele ainda é o vazio. Foi o que derrubou a primeira versão deste
 * teste, que preenchia a data logo depois de abrir a edição.
 */
async function abrir(page: Page, caminho: string) {
  await page.goto(caminho);
  await page.waitForLoadState('networkidle');
}

async function preencher(page: Page, titulo: string, mensagem: string) {
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel('Mensagem', { exact: true }).fill(mensagem);
}

async function prepararLoja(page: Page, rotulo: string) {
  const email = emailDeTeste(rotulo);
  await criarUsuarioConfirmado(email, `Empresa ${rotulo}`);
  await entrar(page, email);
  return criarLojaPelaTela(page, `Loja ${rotulo}`, `loja-${rotulo}.com.br`);
}

test('agendar às 20:00 é 20:00 no fuso da loja — e continua quando o fuso muda', async ({
  page,
}) => {
  const lojaId = await prepararLoja(page, 'agenda');
  const titulo = `Agendada ${Math.random().toString(36).slice(2, 8)}`;
  const dia = amanhaNoFuso('America/Sao_Paulo');

  await abrir(page, '/push/nova');
  await preencher(page, titulo, 'Chega às oito da noite.');
  await expect(page.locator('#fuso-do-envio')).toHaveText('horário de Brasília');
  await page.getByLabel('Data e hora do envio').fill(`${dia}T20:00`);
  await page.getByRole('button', { name: 'Agendar campanha' }).click();

  await page.waitForURL('/push');
  await expect(page.getByText('Campanha agendada.')).toBeVisible();

  const gravada = await campanhaNoBanco(titulo);
  expect(gravada?.status).toBe('scheduled');
  expect(new Date(gravada?.scheduled_at ?? '').toISOString()).toBe(
    utcDe(dia, '20:00', 'America/Sao_Paulo'),
  );

  // A lista e a edição mostram a MESMA hora que o lojista escolheu.
  const linha = page.getByRole('listitem').filter({ hasText: titulo });
  await expect(linha.getByText('Agendada', { exact: true })).toBeVisible();
  await expect(linha.locator('time')).toContainText('20:00');

  await linha.getByRole('button', { name: `Ações de ${titulo}` }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await expect(page.getByLabel('Data e hora do envio')).toHaveValue(`${dia}T20:00`);

  /*
   * A loja muda para o fuso de Manaus. O INSTANTE do envio não muda — a
   * notificação sai no mesmo segundo —, mas na hora de Manaus ele é 19:00, e
   * é isso que a tela precisa dizer.
   */
  await abrir(page, `/lojas/${lojaId}`);
  await page.getByLabel('Fuso horário').selectOption('America/Manaus');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas')).toBeVisible();

  await abrir(page, `/push/${gravada?.id ?? ''}/editar`);
  await expect(page.locator('#fuso-do-envio')).toHaveText('horário do Amazonas');
  await expect(page.getByLabel('Data e hora do envio')).toHaveValue(`${dia}T19:00`);

  // E uma campanha nova às 20:00 agora é 20:00 de Manaus: meia-noite UTC.
  const outra = `Manaus ${Math.random().toString(36).slice(2, 8)}`;
  const diaManaus = amanhaNoFuso('America/Manaus');
  await abrir(page, '/push/nova');
  await preencher(page, outra, 'Às oito da noite no Amazonas.');
  await page.getByLabel('Data e hora do envio').fill(`${diaManaus}T20:00`);
  await page.getByRole('button', { name: 'Agendar campanha' }).click();
  await page.waitForURL('/push');

  const deManaus = await campanhaNoBanco(outra);
  expect(new Date(deManaus?.scheduled_at ?? '').toISOString()).toBe(
    utcDe(diaManaus, '20:00', 'America/Manaus'),
  );
});

test('o formulário recusa o que não pode sair, e não perde o que foi escrito', async ({ page }) => {
  await prepararLoja(page, 'validacao');
  await abrir(page, '/push/nova');

  // Vazio: título e mensagem, cada um no seu campo — e nenhum diálogo abre.
  await page.getByRole('button', { name: 'Enviar agora' }).click();
  await expect(page.getByText('Escreva um título.')).toBeVisible();
  await expect(page.getByText('Escreva a mensagem.')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await preencher(page, 'Promoção relâmpago', 'Só hoje.');

  // Link para fora da loja: recusado, porque abriria outro site dentro do app.
  await page.getByLabel('Abrir em (opcional)').fill('https://outro-site.com/golpe');
  await page.getByRole('button', { name: 'Enviar agora' }).click();
  await expect(page.getByText('O link precisa ser de uma página da sua loja')).toBeVisible();
  await page.getByLabel('Abrir em (opcional)').fill('/colecoes/inverno');

  /*
   * "Agendar para" sem data. Antes, horário vazio queria dizer "agora", e a
   * campanha que o lojista ia marcar para depois saía na mesma hora, para
   * todos os clientes.
   */
  await page.getByLabel('Agendar para').check();
  await page.getByRole('button', { name: 'Agendar campanha' }).click();
  await expect(page.getByText('Escolha a data e o horário do envio.')).toBeVisible();

  // No passado também não.
  await page.getByLabel('Data e hora do envio').fill('2020-01-01T10:00');
  await page.getByRole('button', { name: 'Agendar campanha' }).click();
  await expect(page.getByText('Escolha um horário pelo menos 5 minutos à frente')).toBeVisible();

  // Nada foi gravado, e nada do que foi escrito se perdeu.
  expect(await campanhaNoBanco('Promoção relâmpago')).toBeNull();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Promoção relâmpago');
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('Só hoje.');
  await expect(page.getByLabel('Abrir em (opcional)')).toHaveValue('/colecoes/inverno');
});

test('enviar agora pede confirmação, e "Voltar" não envia nada', async ({ page }) => {
  await prepararLoja(page, 'confirmar');
  const titulo = `Agora ${Math.random().toString(36).slice(2, 8)}`;

  await abrir(page, '/push/nova');
  await preencher(page, titulo, 'Saindo do forno.');
  await page.getByRole('button', { name: 'Enviar agora' }).click();

  const dialogo = page.getByRole('alertdialog');
  await expect(dialogo).toContainText('Enviar agora para todos?');
  // Sem as chaves da loja, a confirmação diz a verdade: fica na fila.
  await expect(dialogo).toContainText('ainda não estão ligadas');

  await dialogo.getByRole('button', { name: 'Voltar' }).click();
  await expect(dialogo).toHaveCount(0);
  expect(await campanhaNoBanco(titulo)).toBeNull();

  await page.getByRole('button', { name: 'Enviar agora' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Enviar agora' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Campanha na fila de envio.')).toBeVisible();

  const gravada = await campanhaNoBanco(titulo);
  expect(gravada?.status).toBe('scheduled');
  expect(Date.parse(gravada?.scheduled_at ?? '')).toBeLessThanOrEqual(Date.now() + 60_000);
});

test('rascunho: salvar não envia; editar, agendar, cancelar e excluir', async ({ page }) => {
  await prepararLoja(page, 'rascunho');
  const titulo = `Rascunho ${Math.random().toString(36).slice(2, 8)}`;

  await abrir(page, '/push/nova');
  await preencher(page, titulo, 'Ainda pensando no texto.');
  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();

  const linha = page.getByRole('listitem').filter({ hasText: titulo });
  await expect(linha.getByText('Rascunho', { exact: true })).toBeVisible();

  /*
   * O defeito que motivou o "Salvar rascunho" separado: na edição de um
   * rascunho, o único botão era "Salvar alterações" com "Agora" marcado — e
   * salvar MANDAVA a campanha.
   */
  await linha.getByRole('button', { name: `Ações de ${titulo}` }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await page.getByLabel('Mensagem', { exact: true }).fill('Texto final, revisado.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.waitForURL('/push');
  // `.last()`: o aviso do primeiro "Rascunho salvo." pode ainda estar na tela.
  await expect(page.getByText('Rascunho salvo.').last()).toBeVisible();

  let gravada = await campanhaNoBanco(titulo);
  expect(gravada?.status).toBe('draft');
  expect(gravada?.body).toBe('Texto final, revisado.');
  expect(gravada?.scheduled_at).toBeNull();

  // Agendar a partir do rascunho.
  const dia = amanhaNoFuso('America/Sao_Paulo');
  await abrir(page, `/push/${gravada?.id ?? ''}/editar`);
  await page.getByLabel('Data e hora do envio').fill(`${dia}T09:30`);
  await page.getByRole('button', { name: 'Agendar campanha' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Campanha agendada.')).toBeVisible();

  gravada = await campanhaNoBanco(titulo);
  expect(gravada?.status).toBe('scheduled');

  // Cancelar pede confirmação e explica o que acontece.
  await linha.getByRole('button', { name: `Ações de ${titulo}` }).click();
  await page.getByRole('menuitem', { name: 'Cancelar envio' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Cancelar o envio?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar envio' }).click();
  await expect(page.getByText('Campanha cancelada.')).toBeVisible();
  await expect(linha.getByText('Cancelada', { exact: true })).toBeVisible();
  expect((await campanhaNoBanco(titulo))?.status).toBe('canceled');

  // Excluir também, e some da lista e do banco.
  await linha.getByRole('button', { name: `Ações de ${titulo}` }).click();
  await page.getByRole('menuitem', { name: 'Excluir' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Excluir a campanha?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText('Campanha excluída.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: titulo })).toHaveCount(0);
  expect(await campanhaNoBanco(titulo)).toBeNull();
});

test('imagem, público e emoji: a campanha leva os três até o banco, a prévia e o detalhe', async ({
  page,
}) => {
  const lojaId = await prepararLoja(page, 'publico');
  await abrir(page, '/push/nova');

  // Emoji entra onde o cursor está, e o cursor segue logo depois dele.
  const campoTitulo = page.getByLabel('Título', { exact: true });
  await campoTitulo.fill('Oferta hoje');
  await campoTitulo.press('End');
  for (let vez = 0; vez < 5; vez += 1) await campoTitulo.press('ArrowLeft');
  await page.getByRole('button', { name: 'Inserir emoji no título' }).click();
  await page.getByRole('menuitem', { name: 'fogo' }).click();
  await expect(campoTitulo).toHaveValue('Oferta🔥 hoje');
  await expect(campoTitulo).toBeFocused();
  const sufixo = Math.random().toString(36).slice(2, 8);
  await campoTitulo.press('End');
  await campoTitulo.pressSequentially(` ${sufixo}`);
  const titulo = `Oferta🔥 hoje ${sufixo}`;
  await expect(campoTitulo).toHaveValue(titulo);

  // Na mensagem que nunca recebeu o cursor, o emoji vai para o fim.
  const campoMensagem = page.getByLabel('Mensagem', { exact: true });
  await campoMensagem.fill('Só até domingo');
  await campoTitulo.focus();
  await page.getByRole('button', { name: 'Inserir emoji na mensagem' }).click();
  await page.getByRole('menuitem', { name: 'presente' }).click();
  await expect(campoMensagem).toHaveValue('Só até domingo🎁');

  // Imagem: o que não serve é recusado com o motivo, sem subir nada.
  const imagem = page.getByLabel('Imagem (opcional)');
  await imagem.setInputFiles({
    name: 'anim.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('GIF89a'),
  });
  await expect(page.getByText('Envie uma imagem JPG, PNG ou WebP.')).toBeVisible();
  await imagem.setInputFiles({
    name: 'quebrada.png',
    mimeType: 'image/png',
    buffer: Buffer.from('isto não é um png'),
  });
  await expect(page.getByText('Não conseguimos abrir esse arquivo como imagem.')).toBeVisible();
  await imagem.setInputFiles({
    name: 'pequena.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(200, 100),
  });
  await expect(page.getByText('A imagem é pequena demais e ficaria borrada.')).toBeVisible();

  // Fora de 2:1, entra — com o aviso do corte no Android. Trocada por 2:1, o aviso some.
  await imagem.setInputFiles({
    name: 'quadrada.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(800, 800),
  });
  await expect(page.getByText('A imagem não está na proporção 2:1')).toBeVisible();
  // Com a imagem a caminho, salvar gravaria a campanha sem ela: os botões esperam.
  let soltarEnvio!: () => void;
  const envioPreso = new Promise<void>((pronto) => {
    soltarEnvio = pronto;
  });
  await page.route('**/push/nova', async (rota) => {
    if (rota.request().method() === 'POST') await envioPreso;
    await rota.continue();
  });
  await imagem.setInputFiles({
    name: 'banner.png',
    mimeType: 'image/png',
    buffer: pngDeCorLisa(1600, 800),
  });
  await expect(page.getByRole('button', { name: 'Enviando a imagem...' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar como rascunho' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar agora' })).toBeDisabled();
  soltarEnvio();
  await expect(page.getByRole('img', { name: 'Imagem da campanha' })).toBeVisible();
  await page.unroute('**/push/nova');
  await expect(page.getByRole('button', { name: 'Salvar como rascunho' })).toBeEnabled();
  await expect(page.getByText('A imagem não está na proporção 2:1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Trocar imagem' })).toBeVisible();
  // A prévia mostra a imagem nos dois aparelhos.
  await expect(page.locator('aside img')).toHaveCount(2);

  // Público: o prazo já vem sugerido; fora de 1 a 365 é recusado.
  const publico = page.getByLabel('Quem recebe');
  await publico.selectOption({ label: 'Quem não abre o app há alguns dias' });
  const dias = page.getByLabel('Sem abrir o app há');
  await expect(dias).toHaveValue('14');
  await expect(page.getByText('a campanha não entra na caixa de avisos do app')).toBeVisible();
  await dias.fill('0');
  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await expect(page.getByText('Diga quantos dias, de 1 a 365.')).toBeVisible();
  await dias.fill('30');

  // "Enviar agora" diz para quem vai — e "Voltar" não manda nada.
  await page.getByRole('button', { name: 'Enviar agora' }).click();
  const confirmacao = page.getByRole('alertdialog');
  await expect(confirmacao.getByText('Enviar agora para este público?')).toBeVisible();
  await expect(confirmacao.getByText('quem não abre o app há 30 dias')).toBeVisible();
  await confirmacao.getByRole('button', { name: 'Voltar' }).click();

  await page.getByRole('button', { name: 'Salvar como rascunho' }).click();
  await page.waitForURL('/push');
  await expect(page.getByText('Rascunho salvo.')).toBeVisible();

  // No banco: a imagem da própria loja, em JPEG, e o público com o prazo.
  const { data: gravada, error } = await bancoDeTeste()
    .from('push_campaigns')
    .select('id, body, image_path, segment')
    .eq('title', titulo)
    .single();
  if (error != null) throw new Error(error.message);
  expect(gravada.body).toBe('Só até domingo🎁');
  expect(gravada.image_path).toMatch(new RegExp(`^${lojaId}/[0-9a-f-]{36}\\.jpg$`));
  expect(gravada.segment).toEqual({ publico: 'inativos', dias: 30 });
  const url = bancoDeTeste()
    .storage.from('push-imagens')
    .getPublicUrl(gravada.image_path ?? '').data.publicUrl;
  const arquivo = await fetch(url);
  expect(arquivo.status).toBe(200);
  expect(arquivo.headers.get('content-type')).toBe('image/jpeg');

  // A lista e o detalhe dizem para quem é.
  const linha = page.getByRole('listitem').filter({ hasText: titulo });
  await expect(linha.getByText('Para: Quem não abre o app há 30 dias')).toBeVisible();
  await abrir(page, `/push/${gravada.id}`);
  await expect(page.getByText('Quem não abre o app há 30 dias')).toBeVisible();
  await expect(page.getByText('Com imagem', { exact: true })).toBeVisible();

  // Na edição, tudo volta como foi salvo; tirar a imagem grava sem ela.
  await abrir(page, `/push/${gravada.id}/editar`);
  await expect(page.getByRole('img', { name: 'Imagem da campanha' })).toBeVisible();
  await expect(page.getByLabel('Quem recebe')).toHaveValue('inativos');
  await expect(page.getByLabel('Sem abrir o app há')).toHaveValue('30');
  await page.getByRole('button', { name: 'Remover imagem' }).click();
  await page.getByLabel('Quem recebe').selectOption({ label: 'Quem já comprou pelo app' });
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await page.waitForURL('/push');
  const { data: editada } = await bancoDeTeste()
    .from('push_campaigns')
    .select('image_path, segment')
    .eq('id', gravada.id)
    .single();
  expect(editada?.image_path).toBeNull();
  expect(editada?.segment).toEqual({ publico: 'compradores' });
});
