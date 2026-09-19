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
  dominiosDaLoja,
  safeParseAppConfig,
  type AppConfig,
} from '@storefy/config-schema';
import { criarClientServidor } from '@/lib/supabase/server';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import { validarConfig, type Problema } from '@/lib/editor-de-config';

export interface EstadoDoEditor {
  ok?: boolean;
  mensagem?: string;
  /** Problemas para mostrar junto de cada seção. */
  problemas?: Problema[];
  /** Versão publicada, devolvida depois de publicar. */
  versaoPublicada?: number;
}

function traduzirErro(codigo: string | undefined, mensagem: string): string {
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para isso. Apenas proprietários e administradores publicam o app.';
  }
  if (codigo === 'P0002') {
    return 'Não encontramos o rascunho deste app. Recarregue a página e tente de novo.';
  }
  return mensagem !== '' ? mensagem : 'Não foi possível concluir. Tente novamente.';
}

export async function salvarConfig(storeId: string, configBruta: unknown): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  // O rascunho é a fonte da verdade para a versão e para o app_id. Mesmo que o
  // navegador mande outros, valem estes.
  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };

  const analise = safeParseAppConfig(configBruta);
  if (!analise.success) {
    return {
      mensagem: 'A configuração enviada não é válida. Recarregue a página e tente de novo.',
    };
  }

  const { data: loja } = await supabase
    .from('stores')
    .select('name, primary_url, shop_domain')
    .eq('id', storeId)
    .maybeSingle();

  if (loja == null) return { mensagem: 'Loja não encontrada.' };

  /*
   * `store` e `version` vêm do banco, não do formulário. O editor não mexe no
   * endereço da loja — isso é na tela da loja — e deixar o campo passar daria a
   * quem forjasse o payload um app apontando para outro site.
   */
  const config: AppConfig = {
    ...analise.data,
    version: atual.rascunho.version,
    store: {
      name: loja.name,
      url: loja.primary_url,
      domains: dominiosDaLoja(loja.primary_url, loja.shop_domain),
    },
  };

  const problemas = validarConfig(config);
  if (problemas.length > 0) {
    return { problemas, mensagem: 'Corrija os pontos abaixo antes de salvar.' };
  }

  const gravou = await salvarRascunho(
    supabase,
    atual.rascunho.appId,
    atual.rascunho.version,
    config,
  );
  if (!gravou.ok) return { mensagem: gravou.motivo };

  revalidatePath('/app');
  return { ok: true, mensagem: 'Rascunho salvo.' };
}

export async function publicarConfig(storeId: string): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };

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

export async function restaurarVersao(storeId: string, versao: number): Promise<EstadoDoEditor> {
  const supabase = await criarClientServidor();

  const atual = await garantirRascunho(supabase, storeId);
  if (!atual.ok) return { mensagem: atual.motivo };

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
