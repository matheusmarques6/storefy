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
import { safeParseAppConfig, type AppConfig } from '@storefy/config-schema';
import { criarClientServidor } from '@/lib/supabase/server';
import { garantirRascunho, salvarRascunho } from '@/lib/configs-servidor';
import { validarConfig, type Problema } from '@/lib/editor-de-config';
import { dominiosDaLoja } from '@storefy/config-schema';

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
