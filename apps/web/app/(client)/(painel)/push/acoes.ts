'use server';

/**
 * Ações das telas de push (C07 a C10).
 *
 * NADA aqui confia no que chega do navegador. O `appId` nunca vem do
 * formulário: é buscado a partir da loja, pelo client da sessão, e é a RLS que
 * decide se aquele usuário enxerga aquela loja. Um payload forjado não
 * consegue criar campanha no app de outro cliente.
 *
 * O `deep_link` é revalidado aqui mesmo com o campo já validado no navegador:
 * validação de formulário é conveniência, não segurança.
 */
import { revalidatePath } from 'next/cache';
import { criarClientServidor } from '@/lib/supabase/server';
import { exigirContextoCliente } from '@/lib/contexto';
import { appDaLoja } from '@/lib/push-servidor';
import { podeCancelar, podeEditar, podeExcluir, validarCampanha } from '@/lib/campanha';
import { DESCRICAO_DO_TIPO, ehTipoDeAutomacao, validarAutomacao } from '@/lib/automacao';
import { normalizarDeepLink } from '@/lib/campanha';
import type { ProblemaNoFormulario } from '@/lib/campanha';

export interface EstadoDoPush {
  ok?: boolean;
  mensagem?: string;
  problemas?: ProblemaNoFormulario[];
  /** Id da campanha criada, para a tela navegar. */
  campanhaId?: string;
}

function traduzirErro(codigo: string | undefined, mensagem: string): string {
  if (codigo === '42501' || codigo === 'PGRST301') {
    return 'Você não tem permissão para isso. Apenas proprietários e administradores mexem no push.';
  }
  if (codigo === '23514') {
    return 'Algum campo passou do tamanho permitido. Encurte o texto e tente de novo.';
  }
  return mensagem !== '' ? mensagem : 'Não foi possível concluir. Tente novamente.';
}

/** A loja ativa e o app dela, ou o motivo de não dar. */
async function contexto() {
  const { lojaAtiva } = await exigirContextoCliente();
  if (lojaAtiva == null) {
    return { ok: false as const, motivo: 'Cadastre uma loja antes de usar o push.' };
  }

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) {
    return { ok: false as const, motivo: 'Não encontramos o app desta loja. Recarregue a página.' };
  }

  return { ok: true as const, supabase, loja: lojaAtiva, app };
}

export async function criarCampanha(entrada: {
  title: string;
  body: string;
  deepLink: string;
  agendarPara: string;
  enviarAgora: boolean;
}): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    {
      title: entrada.title,
      body: entrada.body,
      deepLink: entrada.deepLink,
      // "Enviar agora" ignora o campo de data mesmo que ele tenha sobrado
      // preenchido de uma escolha anterior na mesma tela.
      agendarPara: entrada.enviarAgora ? '' : entrada.agendarPara,
    },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now() },
  );

  if (!validacao.ok) return { problemas: validacao.problemas };

  const { title, body, deepLink, agendarPara } = validacao.valores;

  /*
   * Enviar agora grava como `scheduled` com horário no passado, e não como
   * `sending`. Quem envia é o job — deixar a tela marcar `sending` criaria uma
   * campanha "saindo" que ninguém está processando se o job falhar.
   */
  const { data, error } = await base.supabase
    .from('push_campaigns')
    .insert({
      app_id: base.app.id,
      title,
      body,
      deep_link: deepLink,
      status: 'scheduled',
      scheduled_at: (agendarPara ?? new Date()).toISOString(),
    })
    .select('id')
    .single();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push');
  return {
    ok: true,
    campanhaId: data.id,
    mensagem: agendarPara === null ? 'Campanha na fila de envio.' : 'Campanha agendada.',
  };
}

export async function salvarRascunhoDeCampanha(entrada: {
  title: string;
  body: string;
  deepLink: string;
}): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    { title: entrada.title, body: entrada.body, deepLink: entrada.deepLink },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now() },
  );
  if (!validacao.ok) return { problemas: validacao.problemas };

  const { error, data } = await base.supabase
    .from('push_campaigns')
    .insert({
      app_id: base.app.id,
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: validacao.valores.deepLink,
      status: 'draft',
    })
    .select('id')
    .single();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push');
  return { ok: true, campanhaId: data.id, mensagem: 'Rascunho salvo.' };
}

export async function cancelarCampanha(campanhaId: string): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  /*
   * O status é relido do banco em vez de aceito do navegador. Entre a tela
   * carregar e o clique, o job pode ter começado a enviar — e cancelar algo
   * que já saiu não desfaz nada, só mente no histórico.
   */
  const { data: atual } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeCancelar(atual.status)) {
    return { mensagem: 'Esta campanha já saiu ou já está saindo. Não dá mais para cancelar.' };
  }

  const { error } = await base.supabase
    .from('push_campaigns')
    .update({ status: 'canceled' })
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .eq('status', 'scheduled');

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push');
  return { ok: true, mensagem: 'Campanha cancelada.' };
}

export async function excluirCampanha(campanhaId: string): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const { data: atual } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeExcluir(atual.status)) {
    return { mensagem: 'Campanha enviada fica no histórico. Ela não pode ser excluída.' };
  }

  const { error } = await base.supabase
    .from('push_campaigns')
    .delete()
    .eq('id', campanhaId)
    .eq('app_id', base.app.id);

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push');
  return { ok: true, mensagem: 'Campanha excluída.' };
}

export async function editarCampanha(
  campanhaId: string,
  entrada: {
    title: string;
    body: string;
    deepLink: string;
    agendarPara: string;
    enviarAgora: boolean;
  },
): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const { data: atual } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeEditar(atual.status)) {
    return { mensagem: 'Esta campanha já saiu. O texto enviado não muda mais.' };
  }

  const validacao = validarCampanha(
    {
      title: entrada.title,
      body: entrada.body,
      deepLink: entrada.deepLink,
      agendarPara: entrada.enviarAgora ? '' : entrada.agendarPara,
    },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now() },
  );
  if (!validacao.ok) return { problemas: validacao.problemas };

  const { error } = await base.supabase
    .from('push_campaigns')
    .update({
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: validacao.valores.deepLink,
      status: 'scheduled',
      scheduled_at: (validacao.valores.agendarPara ?? new Date()).toISOString(),
    })
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .in('status', ['draft', 'scheduled']);

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push');
  return { ok: true, mensagem: 'Campanha atualizada.' };
}

export async function salvarAutomacao(entrada: {
  tipo: string;
  title: string;
  body: string;
  deepLink: string;
  delayMinutes: number;
  enabled: boolean;
}): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  if (!ehTipoDeAutomacao(entrada.tipo)) {
    return { mensagem: 'Esta automação ainda não existe.' };
  }

  const validacao = validarAutomacao({
    title: entrada.title,
    body: entrada.body,
    deepLink: entrada.deepLink,
    delayMinutes: entrada.delayMinutes,
    enabled: entrada.enabled,
  });
  if (!validacao.ok) {
    return {
      problemas: validacao.problemas.map((problema) => ({
        campo: problema.campo === 'delayMinutes' ? 'agendarPara' : problema.campo,
        mensagem: problema.mensagem,
      })),
    };
  }

  const link = normalizarDeepLink(entrada.deepLink, base.loja.primary_url);
  if (!link.ok) return { problemas: [{ campo: 'deepLink', mensagem: link.mensagem }] };

  /*
   * `upsert` pela chave (app_id, type), que o banco garante única. Sem ela,
   * salvar duas vezes criaria duas automações do mesmo tipo e o cliente
   * receberia dois pushes por carrinho.
   */
  const { error } = await base.supabase.from('push_automations').upsert(
    {
      app_id: base.app.id,
      type: validacaoTipo(entrada.tipo),
      enabled: validacao.valores.enabled,
      delay_minutes: validacao.valores.delayMinutes,
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: link.caminho,
    },
    { onConflict: 'app_id,type' },
  );

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };

  revalidatePath('/push/automacoes');
  return {
    ok: true,
    mensagem: validacao.valores.enabled
      ? `${DESCRICAO_DO_TIPO[validacaoTipo(entrada.tipo)].nome} ligada.`
      : `${DESCRICAO_DO_TIPO[validacaoTipo(entrada.tipo)].nome} desligada.`,
  };
}

/** Estreita o tipo depois de `ehTipoDeAutomacao`, sem asserção. */
function validacaoTipo(tipo: string): 'welcome' | 'abandoned_cart' {
  return tipo === 'welcome' ? 'welcome' : 'abandoned_cart';
}
