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
import { extrairErros, lojaSchema, urlLojaSchema, type ErrosDeCampo } from '@/lib/validacao';
import { criarClientServidor } from '@/lib/supabase/server';
import { COOKIE_LOJA, exigirContextoCliente } from '@/lib/contexto';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import {
  corNormalizada,
  detectarMarca,
  temaSugerido,
  type MarcaDetectada,
} from '@/lib/deteccao-da-loja';
import { ehHostPublico } from '@/lib/preview-proxy';

export interface EstadoLoja {
  erros?: ErrosDeCampo;
  mensagem?: string;
}

export type ResultadoDaDeteccao =
  { ok: true; marca: MarcaDetectada } | { ok: false; motivo: string };

/** A loja pode demorar; o cadastro não pode ficar pendurado nela. */
const TEMPO_LIMITE_DA_DETECCAO_MS = 8000;
/** Teto do documento lido. Página inicial de loja passa longe disso. */
const TAMANHO_MAXIMO = 2 * 1024 * 1024;

const AGENTE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 StorefyBot';

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
  if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') {
    return { ok: false, motivo: 'Use um endereço http ou https.' };
  }
  if (!ehHostPublico(alvo.hostname)) {
    return { ok: false, motivo: 'Este endereço não pode ser consultado.' };
  }

  const cancelador = new AbortController();
  const alarme = setTimeout(() => {
    cancelador.abort();
  }, TEMPO_LIMITE_DA_DETECCAO_MS);

  try {
    const resposta = await fetch(alvo.toString(), {
      signal: cancelador.signal,
      redirect: 'follow',
      headers: { 'User-Agent': AGENTE, Accept: 'text/html,application/xhtml+xml' },
    });

    if (!resposta.ok) {
      return {
        ok: false,
        motivo: `A loja respondeu com erro ${String(resposta.status)}. Confira o endereço.`,
      };
    }

    const bruto = await resposta.arrayBuffer();
    if (bruto.byteLength > TAMANHO_MAXIMO) {
      return { ok: false, motivo: 'A página inicial da loja é grande demais para analisarmos.' };
    }

    const html = new TextDecoder('utf-8').decode(bruto);
    const marca = detectarMarca(html, resposta.url === '' ? alvo.toString() : resposta.url);

    // A confirmação por `/products.json` só entra quando o HTML não bastou:
    // é uma requisição a mais, e na maioria das lojas o HTML já entrega.
    if (!marca.ehShopify) {
      marca.ehShopify = await confirmarShopify(alvo, cancelador.signal);
    }

    return { ok: true, marca };
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos acessar a loja agora. Confira o endereço ou preencha à mão.',
    };
  } finally {
    clearTimeout(alarme);
  }
}

/** `/products.json` é público em toda loja Shopify e devolve uma lista. */
async function confirmarShopify(base: URL, sinal: AbortSignal): Promise<boolean> {
  try {
    const resposta = await fetch(new URL('/products.json?limit=1', base).toString(), {
      signal: sinal,
      headers: { 'User-Agent': AGENTE, Accept: 'application/json' },
    });
    if (!resposta.ok) return false;
    const corpo: unknown = await resposta.json();
    return (
      typeof corpo === 'object' &&
      corpo !== null &&
      Array.isArray((corpo as { products?: unknown }).products)
    );
  } catch {
    return false;
  }
}

/** A URL é única por organização; o banco tem o índice que garante isso. */
function traduzirErroBanco(codigo: string, mensagem: string): string {
  if (codigo === '23505') {
    return 'Já existe uma loja com este endereço na sua empresa.';
  }
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para esta ação. Fale com o proprietário da empresa.';
  }
  return mensagem !== '' ? mensagem : 'Não foi possível salvar. Tente novamente.';
}

export async function criarLoja(_anterior: EstadoLoja, dados: FormData): Promise<EstadoLoja> {
  // O cadastro não pede o e-mail de atendimento: ele aparece na edição e na
  // tela de publicação, onde faz diferença. Sem o campo, o schema entende
  // "sem contato".
  const analise = lojaSchema.safeParse({ nome: dados.get('nome'), url: dados.get('url') });
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
  redirect(`/lojas/${criada.id}?criada=1`);
}

export async function editarLoja(
  lojaId: string,
  _anterior: EstadoLoja,
  dados: FormData,
): Promise<EstadoLoja> {
  const analise = lojaSchema.safeParse({
    nome: dados.get('nome'),
    url: dados.get('url'),
    emailDeAtendimento: dados.get('emailDeAtendimento') ?? '',
  });
  if (!analise.success) return { erros: extrairErros(analise.error) };

  const supabase = await criarClientServidor();
  const { data: atualizada, error } = await supabase
    .from('stores')
    .update({
      name: analise.data.nome,
      primary_url: analise.data.url,
      shop_domain: new URL(analise.data.url).hostname,
      support_email: analise.data.emailDeAtendimento,
    })
    .eq('id', lojaId)
    .select('id')
    .maybeSingle();

  if (error != null) {
    return { mensagem: traduzirErroBanco(error.code, error.message) };
  }
  // Sem erro e sem linha: a RLS filtrou o UPDATE (papel insuficiente).
  if (atualizada == null) {
    return {
      mensagem:
        'Você não tem permissão para editar esta loja. Apenas proprietários e administradores podem.',
    };
  }

  revalidatePath('/', 'layout');
  redirect(`/lojas/${lojaId}?salva=1`);
}

export async function excluirLoja(lojaId: string): Promise<void> {
  const supabase = await criarClientServidor();
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

  // O cookie apontava para a loja que acabou de sumir.
  const armazem = await cookies();
  if (armazem.get(COOKIE_LOJA)?.value === lojaId) {
    armazem.delete(COOKIE_LOJA);
  }

  revalidatePath('/', 'layout');
  redirect('/lojas?excluida=1');
}
