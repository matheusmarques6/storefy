'use server';

/**
 * Ações do editor do app (C06).
 *
 * A config chega do navegador, então NADA aqui confia nela: o que vem é
 * revalidado pelo schema, passa pelas regras do painel e tem `store` e
 * `version` sobrescritos pelo que está no banco. Um payload forjado não
 * consegue apontar o app de uma loja para outro site nem pular uma versão.
 */
import { revalidatePath } from 'next/cache';
import { toString as qrParaSvg } from 'qrcode';
import {
  ESQUEMA_DA_PREVIA,
  blocoDaLoja,
  safeParseAppConfig,
  type AppConfig,
} from '@storefy/config-schema';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { exigirContextoCliente } from '@/lib/contexto';
import { guardarAsset, removerAsset } from '@/lib/assets-da-loja';
import { guardarImagemDoSlide } from '@/lib/imagem-do-slide';
import { iconeDoSite } from '@/lib/logo-do-site';
import { descobrirTema } from '@/lib/pagina-da-loja';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import { TEXTO_DO_CONFLITO } from '@/lib/rascunho';
import { impressaoDaConfig } from '@/lib/mudancas-pendentes';
import { validarConfig, type Problema } from '@/lib/editor-de-config';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';

export interface EstadoDoEditor {
  ok?: boolean;
  mensagem?: string;
  /** Problemas para mostrar junto de cada seção. */
  problemas?: Problema[];
  /** Versão publicada, devolvida depois de publicar. */
  versaoPublicada?: number;
  /**
   * O rascunho mudou em outra aba (ou por outra pessoa da equipe) depois que
   * a tela o leu, e nada foi gravado. Vem com o rascunho como está agora,
   * para a pessoa ver o que mudou lá e decidir com qual ficar.
   */
  conflito?: { noBanco: AppConfig };
}

function conflitoCom(noBanco: AppConfig): EstadoDoEditor {
  return { mensagem: TEXTO_DO_CONFLITO, conflito: { noBanco } };
}

function traduzirErro(codigo: string | undefined, mensagem: string): string {
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para isso. Apenas proprietários e administradores publicam o app.';
  }
  if (codigo === 'P0002') {
    return 'Não encontramos o rascunho deste app. Recarregue a página e tente de novo.';
  }
  return mensagemDaFalha('app', { code: codigo, message: mensagem }, FALHA_GENERICA);
}

export interface EstadoDoTema {
  ok?: boolean;
  /** O tema lido, quando deu certo. */
  tema?: string;
  mensagem?: string;
}

/**
 * Lê de novo, na página da loja, o tema da Shopify em uso (A10).
 *
 * Para a loja cadastrada antes da detecção, ou que trocou de tema depois: o
 * editor põe o preset daquele tema em primeiro. Grava pela sessão — a RLS de
 * `stores` só deixa proprietário e administrador mudar a loja.
 */
export async function descobrirTemaDaLoja(storeId: string): Promise<EstadoDoTema> {
  const { papel } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores mudam a loja.' };
  }

  const supabase = await criarClientServidor();
  // Pela sessão: uma loja de outra organização não volta, e nada é buscado.
  const { data: loja, error: erroDaLeitura } = await supabase
    .from('stores')
    .select('primary_url, platform')
    .eq('id', storeId)
    .maybeSingle();
  if (erroDaLeitura != null) {
    return { mensagem: traduzirErro(erroDaLeitura.code, erroDaLeitura.message) };
  }
  if (loja == null) return { mensagem: 'Loja não encontrada.' };
  if (loja.platform !== 'shopify') {
    return { mensagem: 'Os presets são de temas da Shopify, e esta loja é de outra plataforma.' };
  }

  let endereco: URL;
  try {
    endereco = new URL(loja.primary_url);
  } catch {
    return { mensagem: 'O endereço da loja não é válido. Confira na página da loja.' };
  }

  const descoberto = await descobrirTema(endereco);
  if (!descoberto.ok) return { mensagem: descoberto.motivo };

  const { data: gravada, error } = await supabase
    .from('stores')
    .update({ shopify_theme: descoberto.tema })
    .eq('id', storeId)
    .select('id')
    .maybeSingle();
  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (gravada == null) return { mensagem: 'Apenas proprietários e administradores mudam a loja.' };

  revalidatePath('/app');
  return { ok: true, tema: descoberto.tema };
}

/**
 * Envia o ícone ou a tela de abertura da loja (C06a).
 *
 * O `FormData` chega da tela porque é o único jeito de passar um arquivo para
 * uma ação de servidor. O arquivo é conferido com o MESMO código que o build
 * usa — é isso que transforma "seu app foi rejeitado pela Apple" numa mensagem
 * na hora do upload.
 */
export async function enviarAsset(
  storeId: string,
  tipo: 'icone' | 'splash',
  formulario: FormData,
): Promise<EstadoDoEditor> {
  const { papel, usuario } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores trocam a imagem do app.' };
  }

  const supabase = await criarClientServidor();

  /*
   * A loja é relida pelo client da SESSÃO: é a RLS que decide se este usuário
   * enxerga esta loja. Um `storeId` forjado simplesmente não volta, e sem ele
   * o caminho do arquivo nunca é montado.
   */
  const { data: app, error: erroDoApp } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();
  if (erroDoApp != null) return { mensagem: traduzirErro(erroDoApp.code, erroDoApp.message) };
  if (app == null) return { mensagem: 'Loja não encontrada.' };

  const arquivo = formulario.get('arquivo');
  if (!(arquivo instanceof File)) return { mensagem: 'Escolha uma imagem.' };

  // Em nome de quem pediu: a trilha diz quem trocou a imagem, e não "o sistema".
  const servico = criarClientServiceRole({ ator: usuario.id });
  const resultado = await guardarAsset(servico, storeId, tipo, {
    tipoMime: arquivo.type,
    bytes: new Uint8Array(await arquivo.arrayBuffer()),
  });
  if (!resultado.ok) return { mensagem: resultado.motivo };

  const { error } = await servico
    .from('apps')
    .update(
      tipo === 'icone' ? { icon_path: resultado.caminho } : { splash_path: resultado.caminho },
    )
    .eq('id', app.id);

  if (error != null)
    return { mensagem: 'A imagem subiu, mas não conseguimos salvá-la. Tente de novo.' };

  revalidatePath('/app');
  revalidatePath('/publicacao');
  return {
    ok: true,
    mensagem: tipo === 'icone' ? 'Ícone atualizado.' : 'Tela de abertura atualizada.',
  };
}

/**
 * A imagem de um slide de boas-vindas (C06d).
 *
 * Só guarda o arquivo e devolve o endereço: quem o põe no slide é o editor,
 * e o rascunho salvo leva o endereço junto. Até lá, a imagem não é usada por
 * nenhuma versão — e o job a apaga se ninguém a salvar em um dia.
 */
export async function enviarImagemDoSlide(
  storeId: string,
  formulario: FormData,
): Promise<{ ok: true; url: string } | { ok: false; mensagem: string }> {
  const { papel } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return { ok: false, mensagem: 'Apenas proprietários e administradores mudam o app.' };
  }

  // Pela sessão: uma loja de outra organização não volta, e nada é guardado.
  const supabase = await criarClientServidor();
  const { data: loja, error } = await supabase
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .maybeSingle();
  if (error != null) return { ok: false, mensagem: traduzirErro(error.code, error.message) };
  if (loja == null) return { ok: false, mensagem: 'Loja não encontrada.' };

  const arquivo = formulario.get('arquivo');
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, mensagem: 'Escolha uma imagem.' };
  }

  const guardada = await guardarImagemDoSlide(criarClientServiceRole(), loja.id, {
    tipoMime: arquivo.type,
    bytes: new Uint8Array(await arquivo.arrayBuffer()),
  });
  if (!guardada.ok) return { ok: false, mensagem: guardada.motivo };
  return guardada;
}

/**
 * O ícone do app a partir do logo do site da loja (C03: "confirma logo").
 *
 * A página é relida no servidor — o endereço vem do CADASTRO da loja, lido
 * pela sessão, e não do navegador —, o logo vira um quadrado de 1024 px com
 * fundo sólido e o desenho na área segura do Android, e o resultado passa
 * pela MESMA conferência do ícone enviado à mão antes de ser guardado.
 */
export async function usarLogoDoSite(storeId: string): Promise<EstadoDoEditor> {
  const { papel, usuario } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores trocam a imagem do app.' };
  }

  const supabase = await criarClientServidor();
  // Pela sessão: uma loja de outra organização não volta, e nada é buscado.
  const [lidaLoja, lidoApp] = await Promise.all([
    supabase.from('stores').select('primary_url').eq('id', storeId).maybeSingle(),
    supabase.from('apps').select('id').eq('store_id', storeId).maybeSingle(),
  ]);
  const falha = lidaLoja.error ?? lidoApp.error;
  if (falha != null) return { mensagem: traduzirErro(falha.code, falha.message) };
  if (lidaLoja.data == null || lidoApp.data == null) return { mensagem: 'Loja não encontrada.' };

  let endereco: URL;
  try {
    endereco = new URL(lidaLoja.data.primary_url);
  } catch {
    return { mensagem: 'O endereço da loja não é válido. Confira na página da loja.' };
  }

  // A cor da marca é o fundo de um logo branco; o rascunho é onde ela está.
  const rascunho = await garantirRascunho(supabase, storeId);
  const corDaMarca = rascunho.ok ? rascunho.rascunho.config.theme.primary : null;

  const icone = await iconeDoSite(endereco, corDaMarca);
  if (!icone.ok) return { mensagem: icone.motivo };

  const servico = criarClientServiceRole({ ator: usuario.id });
  const guardado = await guardarAsset(servico, storeId, 'icone', {
    tipoMime: 'image/png',
    bytes: new Uint8Array(icone.icone),
  });
  if (!guardado.ok) return { mensagem: guardado.motivo };

  const { error } = await servico
    .from('apps')
    .update({ icon_path: guardado.caminho })
    .eq('id', lidoApp.data.id);
  if (error != null) {
    return { mensagem: 'O ícone ficou pronto, mas não conseguimos salvá-lo. Tente de novo.' };
  }

  revalidatePath('/app');
  revalidatePath('/publicacao');
  revalidatePath(`/lojas/${storeId}/comecar`);
  return {
    ok: true,
    mensagem: 'Pronto: o ícone saiu do logo do site. Confira na prévia e troque se quiser.',
  };
}

/** Remove o ícone ou a tela de abertura. */
export async function removerAssetDaLoja(
  storeId: string,
  tipo: 'icone' | 'splash',
): Promise<EstadoDoEditor> {
  const { papel, usuario } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores trocam a imagem do app.' };
  }

  const supabase = await criarClientServidor();
  const { data: app, error } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();
  // Banco fora do ar não é "loja não encontrada": o lojista iria procurar a loja.
  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (app == null) return { mensagem: 'Loja não encontrada.' };

  const resultado = await removerAsset(
    criarClientServiceRole({ ator: usuario.id }),
    storeId,
    app.id,
    tipo,
  );
  if (!resultado.ok) return { mensagem: resultado.motivo };

  revalidatePath('/app');
  revalidatePath('/publicacao');
  return { ok: true, mensagem: 'Imagem removida.' };
}

export interface EstadoDaComparacao {
  ok?: boolean;
  mensagem?: string;
  config?: AppConfig;
}

/**
 * A config de uma versão do histórico, para comparar com o rascunho (C06f).
 *
 * Qualquer pessoa da empresa compara — é só leitura, e a RLS de `app_configs`
 * é quem decide se ela enxerga esta loja. Restaurar continua sendo de dono e
 * administrador.
 */
export async function configDaVersao(storeId: string, versao: number): Promise<EstadoDaComparacao> {
  await exigirContextoCliente();
  if (!Number.isInteger(versao) || versao < 1) return { mensagem: 'Versão inválida.' };

  const supabase = await criarClientServidor();
  const { data: app, error } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();
  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (app == null) return { mensagem: 'Loja não encontrada.' };

  const { data: linha, error: erroDaVersao } = await supabase
    .from('app_configs')
    .select('config')
    .eq('app_id', app.id)
    .eq('version', versao)
    .maybeSingle();
  if (erroDaVersao != null) {
    return { mensagem: traduzirErro(erroDaVersao.code, erroDaVersao.message) };
  }
  if (linha == null) return { mensagem: 'Não encontramos essa versão. Recarregue a página.' };

  const analise = safeParseAppConfig(linha.config);
  if (!analise.success) {
    return { mensagem: 'Essa versão foi gravada num formato antigo e não dá para comparar.' };
  }
  return { ok: true, config: analise.data };
}

/**
 * Troca o nome do app (C06a) — o que aparece embaixo do ícone e na loja de
 * aplicativos. Fora do rascunho: vale no próximo envio às lojas.
 *
 * A gravação é da função do banco, que confere o tamanho de novo e credita
 * quem pediu na trilha de auditoria; o papel é conferido aqui, antes dela.
 */
export async function renomearApp(nome: string): Promise<EstadoDoEditor> {
  const { lojaAtiva, papel, usuario } = await exigirContextoCliente();
  if (lojaAtiva == null) return { mensagem: 'Cadastre uma loja primeiro.' };
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores trocam o nome do app.' };
  }

  const supabase = await criarClientServidor();
  const { data: app, error } = await supabase
    .from('apps')
    .select('id')
    .eq('store_id', lojaAtiva.id)
    .maybeSingle();
  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (app == null) return { mensagem: 'Não encontramos o app desta loja.' };

  const { error: erroAoGravar } = await criarClientServiceRole().rpc('renomear_app', {
    p_app_id: app.id,
    p_ator: usuario.id,
    p_nome: nome,
  });
  if (erroAoGravar != null) {
    return { mensagem: traduzirErro(erroAoGravar.code, erroAoGravar.message) };
  }

  revalidatePath('/app');
  revalidatePath('/publicacao');
  return {
    ok: true,
    mensagem: 'Nome do app salvo. Ele muda no celular dos clientes no próximo envio às lojas.',
  };
}

/**
 * Grava o rascunho do editor.
 *
 * `base` é a impressão (`impressaoDaConfig`) do rascunho em cima do qual a
 * tela fez a mudança. Se o do banco não tem mais esse conteúdo — outra aba,
 * ou outra pessoa da equipe, gravou no meio —, nada é gravado, e a tela
 * recebe o rascunho de agora para a pessoa decidir: a última gravação não
 * apaga mais a outra em silêncio. Sem `base` (uma aba aberta antes desta
 * versão do painel), grava por cima, como antes.
 */
export async function salvarConfig(
  storeId: string,
  configBruta: unknown,
  base?: string,
): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  // O rascunho é a fonte da verdade para a versão e para o app_id. Mesmo que o
  // navegador mande outros, valem estes.
  let atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };
  if (base !== undefined && base !== impressaoDaConfig(atual.rascunho.config)) {
    return conflitoCom(atual.rascunho.config);
  }

  const analise = safeParseAppConfig(configBruta);
  if (!analise.success) {
    return {
      mensagem: 'A configuração enviada não é válida. Recarregue a página e tente de novo.',
    };
  }

  const { data: loja, error: erroDaLoja } = await supabase
    .from('stores')
    .select('name, primary_url, shop_domain, platform')
    .eq('id', storeId)
    .maybeSingle();

  if (erroDaLoja != null) return { mensagem: traduzirErro(erroDaLoja.code, erroDaLoja.message) };
  if (loja == null) return { mensagem: 'Loja não encontrada.' };

  /*
   * `store` e `version` vêm do banco, não do formulário. O editor não mexe no
   * endereço da loja — isso é na tela da loja — e deixar o campo passar daria a
   * quem forjasse o payload um app apontando para outro site.
   */
  const configNaVersao = (version: number): AppConfig => ({
    ...analise.data,
    version,
    // Do banco, e pela mesma função do rascunho: a plataforma decide se o app
    // marca o carrinho para a atribuição, e não um campo vindo do formulário.
    store: blocoDaLoja({
      name: loja.name,
      url: loja.primary_url,
      shopDomain: loja.shop_domain,
      platform: loja.platform,
    }),
  });

  const problemas = validarConfig(configNaVersao(atual.rascunho.version));
  if (problemas.length > 0) {
    return { problemas, mensagem: 'Corrija os pontos abaixo antes de salvar.' };
  }

  // Só por cima do rascunho como foi lido acima.
  let gravou = await salvarRascunho(
    supabase,
    atual.rascunho.appId,
    atual.rascunho.version,
    configNaVersao(atual.rascunho.version),
    atual.rascunho.revisao,
  );
  if (!gravou.ok && gravou.conflito) {
    /*
     * Outra gravação entrou entre a leitura e esta escrita — milissegundos.
     * Lê de novo: se o CONTEÚDO é o mesmo que este pedido leu (a outra aba só
     * publicou, ou a loja mudou de nome), grava no rascunho novo; se mudou, é
     * conflito de verdade, e quem decide é a pessoa.
     */
    const lido = impressaoDaConfig(atual.rascunho.config);
    atual = await garantirRascunho(supabase, storeId);
    if (!atual.ok) return { mensagem: atual.motivo };
    if (impressaoDaConfig(atual.rascunho.config) !== lido)
      return conflitoCom(atual.rascunho.config);
    gravou = await salvarRascunho(
      supabase,
      atual.rascunho.appId,
      atual.rascunho.version,
      configNaVersao(atual.rascunho.version),
      atual.rascunho.revisao,
    );
  }
  if (!gravou.ok) {
    return gravou.conflito ? conflitoCom(atual.rascunho.config) : { mensagem: gravou.motivo };
  }

  revalidatePath('/app');
  return { ok: true, mensagem: 'Rascunho salvo.' };
}

/**
 * Publica o rascunho. `base`, como ao gravar, é a impressão do rascunho que a
 * tela tem: o diálogo de publicar lista o que vai ao ar a partir DELE, e um
 * rascunho mudado em outra aba iria ao ar sem ninguém ter visto.
 */
export async function publicarConfig(storeId: string, base?: string): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };
  if (base !== undefined && base !== impressaoDaConfig(atual.rascunho.config)) {
    return conflitoCom(atual.rascunho.config);
  }

  // Publicar com config inválida colocaria no ar algo que o app descarta — e o
  // lojista veria o app "não atualizar", sem nenhum erro para investigar.
  const problemas = validarConfig(atual.rascunho.config);
  if (problemas.length > 0) {
    return { problemas, mensagem: 'Corrija os pontos abaixo antes de publicar.' };
  }

  const { data, error } = await supabase.rpc('publicar_config', {
    p_app_id: atual.rascunho.appId,
  });

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/app');
  revalidatePath('/lojas');
  return {
    ok: true,
    versaoPublicada: data,
    mensagem: `Versão ${String(data)} publicada. O app dos seus clientes atualiza em até um minuto.`,
  };
}

/**
 * Carrega uma versão antiga no rascunho. `base`, como ao gravar: a comparação
 * que a pessoa viu antes de restaurar saiu do rascunho DESTA tela, e o que
 * outra aba salvou depois seria substituído sem ninguém ter visto.
 */
export async function restaurarVersao(
  storeId: string,
  versao: number,
  base?: string,
): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };
  if (base !== undefined && base !== impressaoDaConfig(atual.rascunho.config)) {
    return conflitoCom(atual.rascunho.config);
  }

  const { error } = await supabase.rpc('restaurar_config', {
    p_app_id: atual.rascunho.appId,
    p_version: versao,
  });

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/app');
  return {
    ok: true,
    mensagem: `Versão ${String(versao)} carregada no rascunho. Revise e publique quando quiser.`,
  };
}

// ---------------------------------------------------------------- prévia

/*
 * O QR carrega um deep link e não uma URL comum: assim a câmera nativa do
 * celular oferece abrir no app, em vez de abrir o navegador numa página de
 * JSON que não diz nada ao lojista. O esquema vem do contrato, e não daqui:
 * um arquivo 'use server' só pode exportar função assíncrona.
 */

/** Quanto tempo o código vale. Curto: ele dá acesso ao rascunho sem login. */
const MINUTOS_DA_PREVIA = 30;

export interface EstadoDaPrevia {
  ok?: boolean;
  mensagem?: string;
  /** Código em claro. Existe só nesta resposta; o banco guarda o hash. */
  codigo?: string;
  /** SVG do QR, pronto para a tela. */
  qr?: string;
  expiraEm?: string;
}

/**
 * Abre uma prévia para ver o rascunho num aparelho antes de publicar.
 *
 * O código volta em claro uma única vez — é o que vai para o QR. Recarregar a
 * página não recupera o mesmo: gera outro.
 */
export async function abrirPrevia(storeId: string): Promise<EstadoDaPrevia> {
  const supabase = await criarClientServidor();

  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };

  const { data, error } = await supabase.rpc('abrir_previa', {
    p_app_id: atual.rascunho.appId,
    p_minutos: MINUTOS_DA_PREVIA,
  });

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  const sessao = Array.isArray(data) ? data[0] : null;
  // As colunas de uma função que devolve tabela chegam anuláveis no tipo;
  // sem código não há prévia, e seguir com `null` viraria um QR de "null".
  if (sessao?.token == null || sessao.token === '') {
    return { mensagem: 'Não foi possível abrir a prévia. Tente de novo.' };
  }

  const link = `${ESQUEMA_DA_PREVIA}://p/${sessao.token}`;
  let qr: string;
  try {
    qr = await qrParaSvg(link, {
      type: 'svg',
      margin: 1,
      // Nível médio de correção: o QR continua legível com o dedo cobrindo um
      // canto da tela, sem ficar denso demais para a câmera de longe.
      errorCorrectionLevel: 'M',
    });
  } catch {
    // Sem o QR, o código digitado à mão ainda resolve.
    qr = '';
  }

  return {
    ok: true,
    codigo: sessao.token,
    qr,
    expiraEm: sessao.expira_em ?? undefined,
  };
}
