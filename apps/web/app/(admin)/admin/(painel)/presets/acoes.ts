'use server';

/**
 * A curadoria dos presets de tema (A10).
 *
 * O PRESET NASCE DE UMA LOJA QUE JÁ FUNCIONA, e não de um editor próprio. Um
 * segundo editor de abas no admin seria uma cópia do C06 envelhecendo em
 * paralelo; e um preset escrito à mão é um palpite, enquanto um copiado de
 * loja no ar já foi conferido por alguém olhando a tela do celular.
 *
 * DESLIGAR EM VEZ DE APAGAR é o caminho normal: apagar um preset não desfaz
 * nada em quem já o aplicou, e tirar do caminho um que ficou ruim é mais
 * comum do que querer perdê-lo de vez. Apagar continua existindo, para o
 * preset criado por engano.
 */
import { revalidatePath } from 'next/cache';
import type { Json } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';
import { lerPreset } from '@/lib/presets';
import { log } from '@/lib/log';

export interface EstadoDoPreset {
  ok?: boolean;
  mensagem?: string;
}

export async function criarPresetDaLoja(
  _anterior: EstadoDoPreset,
  dados: FormData,
): Promise<EstadoDoPreset> {
  const usuario = await exigirPlatformAdmin();

  const appId = texto(dados.get('appId'));
  const nome = texto(dados.get('nome')).trim();
  const tema = texto(dados.get('tema')).trim();
  const descricao = texto(dados.get('descricao')).trim();

  if (appId === '') return { mensagem: 'Escolha a loja de onde copiar.' };
  if (nome.length < 2) return { mensagem: 'Dê um nome ao preset.' };
  if (tema.length < 2) return { mensagem: 'Diga de qual tema da Shopify ele é.' };

  /*
   * PELA SESSÃO, e não pela service role: a função confere que quem pede é da
   * equipe (`is_platform_admin`, com o segundo fator), e a service role não é
   * ninguém. Chamada pela service role, ela recusava SEMPRE — e o erro
   * ignorado virava "essa loja ainda não publicou": nenhum preset nascia.
   */
  const supabase = await criarClientServidor();
  const { data: copiado, error: erroDaCopia } = await supabase.rpc('admin_config_para_preset', {
    p_app_id: appId,
  });
  if (erroDaCopia != null) {
    log.erro('presets.copia-falhou', { falha: erroDaCopia });
    return { mensagem: 'Não conseguimos ler a configuração dessa loja. Tente de novo.' };
  }
  const fonte = copiado[0];

  if (fonte == null) {
    /*
     * Sem config publicada não há o que copiar. É o caso da loja que ainda
     * está em rascunho — e dizer isso é melhor do que criar um preset vazio
     * que só falharia ao ser aplicado, longe daqui.
     */
    return { mensagem: 'Essa loja ainda não publicou uma configuração. Não há o que copiar.' };
  }

  /*
   * O conteúdo copiado passa pelo Zod ANTES de virar preset. A config daquela
   * loja pode ser de um formato antigo, e gravar um preset que nasce inválido
   * empurraria a descoberta para o lojista que o escolhesse.
   */
  const conferido = lerPreset({
    id: 'novo',
    nome,
    tema,
    descricao: null,
    tabs: fonte.tabs,
    hide_selectors: fonte.hide_selectors,
    custom_css: fonte.custom_css,
  });

  if (!conferido.ok) {
    return { mensagem: `${conferido.motivo} Publique a configuração dessa loja de novo antes.` };
  }

  const servico = criarClientServiceRole();
  const { data: criado, error } = await servico
    .from('config_presets')
    .insert({
      nome,
      tema,
      descricao: descricao === '' ? null : descricao,
      tabs: conferido.preset.tabs,
      hide_selectors: conferido.preset.hideSelectors,
      custom_css: conferido.preset.customCss,
      created_by: usuario.id,
    })
    .select('id')
    .single();

  if (error != null) return { mensagem: 'Não conseguimos salvar o preset. Tente de novo.' };

  await auditar(usuario.id, 'create', criado.id, {
    nome: { de: null, para: nome },
    tema: { de: null, para: tema },
    copiado_do_app: { de: null, para: appId },
  });

  revalidatePath('/admin/presets');
  return { ok: true, mensagem: `Preset "${nome}" criado a partir dessa loja.` };
}

export async function alternarPreset(id: string, ativo: boolean): Promise<EstadoDoPreset> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole();

  const { data: mudado, error } = await servico
    .from('config_presets')
    .update({ ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('nome')
    .maybeSingle();

  if (error != null) return { mensagem: 'Não conseguimos mudar o preset. Tente de novo.' };
  if (mudado == null) return { mensagem: 'Esse preset não existe mais. Recarregue a página.' };

  await auditar(usuario.id, 'update', id, {
    nome: { de: mudado.nome, para: mudado.nome },
    ativo: { de: !ativo, para: ativo },
  });

  revalidatePath('/admin/presets');
  return {
    ok: true,
    mensagem: ativo ? 'Preset ligado: os lojistas já o veem.' : 'Preset desligado.',
  };
}

export async function apagarPreset(id: string): Promise<EstadoDoPreset> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole();

  const { data: apagado, error } = await servico
    .from('config_presets')
    .delete()
    .eq('id', id)
    .select('nome, tema')
    .maybeSingle();
  if (error != null) return { mensagem: 'Não conseguimos apagar o preset. Tente de novo.' };
  if (apagado == null) return { mensagem: 'Esse preset não existe mais. Recarregue a página.' };

  await auditar(usuario.id, 'delete', id, {
    nome: { de: apagado.nome, para: null },
    tema: { de: apagado.tema, para: null },
  });

  revalidatePath('/admin/presets');
  return { ok: true, mensagem: 'Preset apagado. Quem já aplicou continua como está.' };
}

/**
 * A trilha da curadoria (regra 9 do CLAUDE.md): presets são escritos pela
 * service role, que o gatilho de auditoria não sabe quem é — então quem pediu
 * vai escrito aqui. A mudança já foi feita; falhar na trilha vai para o log,
 * e não desfaz o que a equipe fez.
 */
async function auditar(
  atorId: string,
  acao: 'create' | 'update' | 'delete',
  presetId: string,
  diff: Record<string, { de: Json; para: Json }>,
): Promise<void> {
  const { error } = await criarClientServiceRole().from('audit_logs').insert({
    actor_id: atorId,
    org_id: null,
    action: acao,
    entity: 'config_presets',
    entity_id: presetId,
    diff,
  });
  if (error != null) log.erro('presets.mudanca-sem-auditoria', { falha: error });
}

/** O campo como texto: `FormData.get` devolve string OU File. */
function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}
