'use server';

/**
 * CRUD de lojas.
 *
 * Toda ação repassa a operação ao Supabase com a sessão do usuário, então a RLS
 * decide o que pode. As checagens de papel aqui servem para dar uma mensagem
 * melhor que "permissão negada" — não são a autorização em si (regra 2).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  extrairErros,
  lojaSchema,
  urlLojaSchema,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';
import { podeExcluir } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { BUCKET as BUCKET_DOS_ASSETS, caminhoDoAsset } from '@/lib/assets-da-loja';
import { urlDoSite } from '@/lib/env';
import { ehDominioDeLoja } from '@/lib/shopify';
import { apagarWebhooks } from '@/lib/shopify-servidor';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import { log } from '@/lib/log';
import { COOKIE_LOJA, exigirContextoCliente } from '@/lib/contexto';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import {
  corNormalizada,
  detectarMarca,
  temaSugerido,
  type MarcaDetectada,
} from '@/lib/deteccao-da-loja';
import { confirmarShopify, lerPaginaDaLoja } from '@/lib/pagina-da-loja';
import { dominioAoEditar } from '@/lib/dominio-da-loja';
import { mensagemDaFalha } from '@/lib/erros';

export interface EstadoLoja {
  erros?: ErrosDeCampo;
  mensagem?: string;
  /** O que foi digitado nos campos não controlados, para não se apagarem no erro. */
  valores?: ValoresDigitados;
}

export type ResultadoDaDeteccao =
  { ok: true; marca: MarcaDetectada } | { ok: false; motivo: string };

/**
 * Lê a página inicial da loja para preencher nome, cor e logo (C02–C04).
 *
 * Exige sessão e só alcança hospedeiro público — o mesmo cuidado do proxy de
 * prévia, porque é o mesmo risco: uma requisição que sai do nosso servidor
 * para um endereço que quem pediu escolheu.
 *
 * Nada é inventado. O que a página não disser volta vazio, e a tela pede para
 * preencher à mão.
 */
export async function detectarLoja(urlBruta: string): Promise<ResultadoDaDeteccao> {
  // Sem sessão não há detecção: senão isto seria um buscador de URLs aberto.
  await exigirContextoCliente();

  // `urlLojaSchema` normaliza "minhaloja.com.br" para https e exige domínio
  // com ponto, que é o mesmo crivo do cadastro.
  const analise = urlLojaSchema.safeParse(urlBruta);
  if (!analise.success) {
    return { ok: false, motivo: 'Digite o endereço completo da loja, começando com https://' };
  }

  let alvo: URL;
  try {
    alvo = new URL(analise.data);
  } catch {
    return { ok: false, motivo: 'Endereço inválido.' };
  }

  // A leitura confere o endereço e cada redirecionamento: só host público.
  const pagina = await lerPaginaDaLoja(alvo);
  if (!pagina.ok) return { ok: false, motivo: pagina.motivo };

  const marca = detectarMarca(pagina.html, pagina.url.toString());

  // A confirmação por `/products.json` só entra quando o HTML não bastou:
  // é uma requisição a mais, e na maioria das lojas o HTML já entrega.
  if (!marca.ehShopify) marca.ehShopify = await confirmarShopify(pagina.url);

  return { ok: true, marca };
}

/** A URL é única por organização; o banco tem o índice que garante isso. */
function traduzirErroBanco(codigo: string, mensagem: string): string {
  if (codigo === '23505') {
    return 'Já existe uma loja com este endereço na sua empresa.';
  }
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para esta ação. Fale com o proprietário da empresa.';
  }
  return mensagemDaFalha(
    'lojas',
    { code: codigo, message: mensagem },
    'Não foi possível salvar agora. Tente de novo em instantes.',
  );
}

export async function criarLoja(_anterior: EstadoLoja, dados: FormData): Promise<EstadoLoja> {
  // O cadastro não pede o e-mail de atendimento: ele aparece na edição e na
  // tela de publicação, onde faz diferença. Sem o campo, o schema entende
  // "sem contato".
  const analise = lojaSchema.safeParse({
    nome: dados.get('nome'),
    url: dados.get('url'),
    plataforma: dados.get('plataforma') ?? undefined,
    tema: dados.get('tema') ?? undefined,
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const { organizacao } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const { data: criada, error } = await supabase
    .from('stores')
    .insert({
      org_id: organizacao.id,
      name: analise.data.nome,
      primary_url: analise.data.url,
      shop_domain: new URL(analise.data.url).hostname,
      // A detecção preenche, o lojista confirma na tela. Sem escolha, Shopify.
      platform: analise.data.plataforma ?? 'shopify',
      shopify_theme: analise.data.tema ?? null,
    })
    .select('id')
    .single();

  if (error != null) {
    return { mensagem: traduzirErroBanco(error.code, error.message) };
  }

  /*
   * A loja nasce com um app que já funciona: abre a loja, tem carrinho, busca e
   * conta. Sem isto, o editor abriria vazio e o app do cliente não teria o que
   * publicar.
   *
   * Uma falha aqui NÃO impede a loja de ser criada — ela já existe, e voltar
   * atrás seria pior. O editor chama `garantirRascunho` de novo ao abrir, então
   * o caso se resolve sozinho na primeira visita.
   */
  const rascunho = await garantirRascunho(supabase, criada.id);

  /*
   * A cor detectada entra no rascunho agora, para o lojista já abrir o editor
   * com a marca dele. Ela vem do formulário, então é revalidada aqui — o campo
   * é editável no editor de qualquer jeito, mas nada forjado chega ao banco
   * sem passar pelo formato que o app entende.
   */
  const bruta = dados.get('corDetectada');
  const corDetectada = corNormalizada(typeof bruta === 'string' ? bruta : null);
  if (rascunho.ok && corDetectada !== null) {
    const sugestao = temaSugerido(corDetectada);
    if (sugestao !== null) {
      await salvarRascunho(supabase, rascunho.rascunho.appId, rascunho.rascunho.version, {
        ...rascunho.rascunho.config,
        theme: { ...rascunho.rascunho.config.theme, ...sugestao },
      });
    }
  }

  // A loja recém-criada vira a ativa: é o que o usuário espera depois de criar.
  const armazem = await cookies();
  armazem.set(COOKIE_LOJA, criada.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
  // O começo guiado segue daqui: o visual (C03) e o app no celular (C04).
  redirect(`/lojas/${criada.id}/comecar`);
}

export async function editarLoja(
  lojaId: string,
  _anterior: EstadoLoja,
  dados: FormData,
): Promise<EstadoLoja> {
  const valores = valoresDigitados(dados, ['emailDeAtendimento', 'fuso']);
  const analise = lojaSchema.safeParse({
    nome: dados.get('nome'),
    url: dados.get('url'),
    emailDeAtendimento: dados.get('emailDeAtendimento') ?? '',
    // Ausente quer dizer "não mexer" — o schema só confere o que veio.
    fuso: dados.get('fuso') ?? undefined,
    plataforma: dados.get('plataforma') ?? undefined,
    tema: dados.get('tema') ?? undefined,
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();

  // O domínio da Shopify fica como está: é por ele que os webhooks acham a loja.
  const { data: atual, error: erroDaLeitura } = await supabase
    .from('stores')
    .select('shop_domain')
    .eq('id', lojaId)
    .maybeSingle();
  if (erroDaLeitura != null) {
    return { mensagem: traduzirErroBanco(erroDaLeitura.code, erroDaLeitura.message), valores };
  }
  const dominio = dominioAoEditar(atual?.shop_domain ?? null, analise.data.url);

  const { data: atualizada, error } = await supabase
    .from('stores')
    .update({
      name: analise.data.nome,
      primary_url: analise.data.url,
      ...(dominio === undefined ? {} : { shop_domain: dominio }),
      support_email: analise.data.emailDeAtendimento,
      ...(analise.data.fuso === undefined ? {} : { timezone: analise.data.fuso }),
      ...(analise.data.plataforma === undefined ? {} : { platform: analise.data.plataforma }),
      ...(analise.data.tema === undefined ? {} : { shopify_theme: analise.data.tema }),
    })
    .eq('id', lojaId)
    .select('id')
    .maybeSingle();

  if (error != null) {
    // O banco confere o fuso de novo (migration `fuso_da_loja`). Só chega aqui
    // um fuso que o `Intl` conhece e o Postgres não — versões diferentes do
    // banco de fusos —, e a resposta certa é a mesma do schema.
    if (error.message.startsWith('fuso_desconhecido')) {
      return { erros: { fuso: 'Este fuso não é aceito. Escolha outro da lista.' }, valores };
    }
    return { mensagem: traduzirErroBanco(error.code, error.message), valores };
  }
  // Sem erro e sem linha: a RLS filtrou o UPDATE (papel insuficiente).
  if (atualizada == null) {
    return {
      mensagem:
        'Você não tem permissão para editar esta loja. Apenas proprietários e administradores podem.',
      valores,
    };
  }

  revalidatePath('/', 'layout');
  redirect(`/lojas/${lojaId}?salva=1`);
}

export async function excluirLoja(lojaId: string): Promise<void> {
  const { papel, usuario } = await exigirContextoCliente();
  // Conferido ANTES de mexer na Shopify: quem não pode excluir não desliga nada.
  if (!podeExcluir(papel)) {
    throw new Error('Apenas o proprietário da empresa pode excluir uma loja.');
  }

  const supabase = await criarClientServidor();
  const { data: loja, error: erroDaLoja } = await supabase
    .from('stores')
    .select('id, shopify_scopes')
    .eq('id', lojaId)
    .maybeSingle();
  if (erroDaLoja != null) throw new Error(traduzirErroBanco(erroDaLoja.code, erroDaLoja.message));
  if (loja == null) throw new Error('Loja não encontrada. Recarregue a página.');

  const servico = criarClientServiceRole({ ator: usuario.id });

  /*
   * Os webhooks saem da Shopify ANTES de a loja sair daqui, como no
   * "Desconectar": depois, sem o token, não haveria como apagá-los — e a
   * Shopify seguiria mandando cada pedido para uma loja que não existe mais.
   * Melhor esforço: o token pode já ter sido revogado por uma desinstalação.
   */
  if (loja.shopify_scopes !== null) {
    const conexao = await tokenDaLoja(servico, lojaId);
    if (conexao.ok && ehDominioDeLoja(conexao.dominio)) {
      try {
        await apagarWebhooks(conexao.dominio, conexao.token, `${urlDoSite()}/api/webhooks/shopify`);
      } catch {
        log.aviso('loja-excluida.webhooks-nao-apagados', { loja: conexao.dominio });
      }
    }
  }

  const { data: removida, error } = await supabase
    .from('stores')
    .delete()
    .eq('id', lojaId)
    .select('id')
    .maybeSingle();

  if (error != null) {
    throw new Error(traduzirErroBanco(error.code, error.message));
  }
  if (removida == null) {
    throw new Error('Apenas o proprietário da empresa pode excluir uma loja.');
  }

  /*
   * O ícone e a tela de abertura moram no storage, fora do banco: a exclusão
   * em cascata não os alcança. Sem isto, a imagem de marca de uma loja
   * excluída ficaria guardada para sempre. As imagens das notificações o job
   * das estatísticas já apaga, quando nenhuma campanha as usa.
   */
  const { error: erroDasImagens } = await servico.storage
    .from(BUCKET_DOS_ASSETS)
    .remove([caminhoDoAsset(lojaId, 'icone'), caminhoDoAsset(lojaId, 'splash')]);
  if (erroDasImagens != null) {
    log.erro('loja-excluida.imagens-nao-apagadas', {
      loja: lojaId,
      motivo: erroDasImagens.message,
    });
  }

  // O cookie apontava para a loja que acabou de sumir.
  const armazem = await cookies();
  if (armazem.get(COOKIE_LOJA)?.value === lojaId) {
    armazem.delete(COOKIE_LOJA);
  }

  revalidatePath('/', 'layout');
  redirect('/lojas?excluida=1');
}
