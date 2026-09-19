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
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { descriptografar } from '@/lib/cripto';
import { enviarNotificacao } from '@/lib/onesignal';
import { faltaConfiguracao } from '@/lib/jobs';
import { ativarNotificacoes } from '@/lib/ativar-push';
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

/**
 * Manda a notificação para UM aparelho, sem criar campanha.
 *
 * É a última conferência antes de um envio que não tem volta: o lojista vê no
 * próprio celular o texto cortado, o link que abre no lugar errado e o emoji
 * que não renderiza. Nada disso aparece num campo de formulário.
 *
 * Não grava `push_campaigns`: um teste no histórico de campanhas confundiria a
 * contagem de envios e o resumo do topo da tela.
 */
export async function enviarTeste(entrada: {
  title: string;
  body: string;
  deepLink: string;
  deviceId: string;
}): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    { title: entrada.title, body: entrada.body, deepLink: entrada.deepLink },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now() },
  );
  if (!validacao.ok) return { problemas: validacao.problemas };

  /*
   * O aparelho é lido pelo client da SESSÃO, e filtrado por este app. É a RLS
   * que decide se aquele usuário enxerga aquele aparelho — um id forjado de
   * outra loja simplesmente não volta.
   */
  const { data: aparelho } = await base.supabase
    .from('devices')
    .select('onesignal_subscription_id')
    .eq('id', entrada.deviceId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (aparelho == null) {
    return { mensagem: 'Não encontramos esse aparelho. Recarregue a página e tente de novo.' };
  }

  const { data: credenciais } = await criarClientServiceRole()
    .from('apps')
    .select('onesignal_app_id, onesignal_api_key_enc')
    .eq('id', base.app.id)
    .maybeSingle();

  const falta = faltaConfiguracao(
    credenciais?.onesignal_app_id ?? null,
    credenciais?.onesignal_api_key_enc ?? null,
  );
  if (falta !== null) return { mensagem: falta };

  /*
   * O limite usa a service role porque o contador é tabela de sistema, sem
   * policy. A checagem de permissão já aconteceu acima, pela RLS: quem chegou
   * aqui enxerga esta loja. Sem o limite, um clique repetido viraria dezenas
   * de notificações no celular de quem está testando.
   */
  const { data: cabe } = await criarClientServiceRole().rpc('consumir_limite', {
    p_chave: `teste:${base.app.id}`,
    p_maximo: 10,
    p_janela_segundos: 60,
  });
  if (cabe === false) {
    return { mensagem: 'Muitos testes seguidos. Espere um minuto e tente de novo.' };
  }

  let chave: string;
  try {
    chave = descriptografar(credenciais?.onesignal_api_key_enc ?? '');
  } catch {
    return { mensagem: 'Não conseguimos ler a chave de envio desta loja. Fale com o suporte.' };
  }

  const resultado = await enviarNotificacao(
    { appId: credenciais?.onesignal_app_id ?? '', chave },
    {
      title: validacao.valores.title,
      body: validacao.valores.body,
      deepLink: validacao.valores.deepLink,
      inscricoes: [aparelho.onesignal_subscription_id],
    },
  );

  if (!resultado.ok) {
    return {
      mensagem: resultado.permanente
        ? `Não deu para enviar o teste: ${resultado.motivo}`
        : 'Não conseguimos falar com o servidor de push agora. Tente de novo em instantes.',
    };
  }

  return { ok: true, mensagem: 'Teste enviado. Confira o celular.' };
}

/**
 * Liga as notificações desta loja: cria o app na OneSignal e guarda as chaves.
 *
 * A criação não é idempotente do lado da OneSignal — chamar duas vezes cria
 * dois apps, e o segundo fica com os mesmos certificados e nenhum aparelho. O
 * `ativarNotificacoes` relê `onesignal_app_id` antes de criar justamente
 * porque outra pessoa da mesma organização pode ter clicado primeiro.
 */
export async function ligarNotificacoes(): Promise<EstadoDoPush> {
  const { lojaAtiva, papel } = await exigirContextoCliente();
  if (lojaAtiva == null) return { mensagem: 'Cadastre uma loja antes de usar o push.' };

  /*
   * Esta ação usa a service role para ler credenciais que o painel não
   * enxerga, então a permissão é conferida AQUI, à mão — a RLS não vai
   * conferir por ela. Só owner e admin ligam notificações da organização.
   */
  if (papel !== 'owner' && papel !== 'admin') {
    return {
      mensagem: 'Apenas proprietários e administradores ligam as notificações.',
    };
  }

  const resultado = await ativarNotificacoes(criarClientServiceRole(), lojaAtiva.id);
  if (!resultado.ok) return { mensagem: resultado.motivo };

  revalidatePath('/push');
  revalidatePath('/push/automacoes');
  return { ok: true, mensagem: 'Notificações ligadas. Já dá para enviar campanhas.' };
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
