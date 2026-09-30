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
import { toString as qrParaSvg } from 'qrcode';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { descriptografar } from '@/lib/cripto';
import { enviarNotificacao } from '@/lib/onesignal';
import { faltaConfiguracao } from '@/lib/jobs';
import { ativarNotificacoes } from '@/lib/ativar-push';
import { exigirContextoCliente } from '@/lib/contexto';
import { appDaLoja, celularesDeTeste } from '@/lib/push-servidor';
import {
  MAXIMO_DO_NOME,
  MINUTOS_DO_CODIGO,
  linkDoApp,
  linkDoQr,
  type CelularDeTeste,
} from '@/lib/celular-de-teste';
import { urlDoSite } from '@/lib/env';
import { ehUuid } from '@/lib/app-config-publica';
import { log } from '@/lib/log';
import { podeCancelar, podeEditar, podeExcluir, validarCampanha } from '@/lib/campanha';
import { DESCRICAO_DO_TIPO, ehTipoDeAutomacao, validarAutomacao } from '@/lib/automacao';
import { normalizarDeepLink } from '@/lib/campanha';
import type { ProblemaNoFormulario } from '@/lib/campanha';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import { dicaDaChave, gerarChave, hashDaChave } from '@/lib/webhook-de-automacao';
import {
  caminhoDaImagemDaLoja,
  guardarImagemDoPush,
  imagemDoPushExiste,
  urlDaImagemDoPush,
} from '@/lib/imagem-do-push';
import { lerPublico, segmentoDoPublico } from '@/lib/publico-do-push';

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
  return mensagemDaFalha('push', { code: codigo, message: mensagem }, FALHA_GENERICA);
}

/**
 * A loja ativa e o app dela, ou o motivo de não dar.
 *
 * Toda ação daqui ESCREVE, e o papel é conferido antes: a RLS também recusa,
 * mas recusa em silêncio — o UPDATE simplesmente não acha linha —, e a tela
 * dizia "Campanha cancelada." para quem não podia cancelar nada.
 */
async function contexto() {
  const { lojaAtiva, papel, usuario } = await exigirContextoCliente();
  if (lojaAtiva == null) {
    return { ok: false as const, motivo: 'Cadastre uma loja antes de usar o push.' };
  }
  if (papel !== 'owner' && papel !== 'admin') {
    return {
      ok: false as const,
      motivo: 'Apenas proprietários e administradores mexem nas notificações.',
    };
  }

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) {
    return { ok: false as const, motivo: 'Não encontramos o app desta loja. Recarregue a página.' };
  }

  return { ok: true as const, supabase, loja: lojaAtiva, app, usuario };
}

type Base = Extract<Awaited<ReturnType<typeof contexto>>, { ok: true }>;

/** O que a campanha leva além do texto: a imagem e quem recebe (C08). */
export interface ExtrasDaCampanha {
  /** Caminho da imagem no bucket, como `enviarImagemDoPush` devolveu, ou `null`. */
  imagem: string | null;
  /** O público, como o formulário manda: o tipo e o prazo em dias (texto do campo). */
  publico: { tipo: string; dias: string };
}

/**
 * A imagem que chegou do navegador, conferida: tem de ser um arquivo desta
 * loja, no formato que o servidor grava, e que ainda exista — o job apaga as
 * que ficam um dia sem campanha, e um formulário esquecido aberto pode chegar
 * com uma que já não está lá.
 */
async function conferirImagem(
  base: Base,
  imagem: string | null,
): Promise<{ ok: true; caminho: string | null } | { ok: false; problema: ProblemaNoFormulario }> {
  if (imagem === null) return { ok: true, caminho: null };
  if (!caminhoDaImagemDaLoja(base.loja.id, imagem)) {
    return {
      ok: false,
      problema: {
        campo: 'imagem',
        mensagem: 'Essa imagem não é desta loja. Envie a imagem de novo.',
      },
    };
  }
  const existe = await imagemDoPushExiste(criarClientServiceRole(), imagem);
  if (existe === null) {
    return {
      ok: false,
      problema: {
        campo: 'imagem',
        mensagem: 'Não conseguimos conferir a imagem agora. Tente de novo em instantes.',
      },
    };
  }
  if (!existe) {
    return {
      ok: false,
      problema: {
        campo: 'imagem',
        mensagem: 'A imagem não está mais disponível. Envie a imagem de novo.',
      },
    };
  }
  return { ok: true, caminho: imagem };
}

/** Imagem e público juntos: o que vai para `image_path` e `segment`, ou os problemas. */
async function conferirExtras(
  base: Base,
  extras: ExtrasDaCampanha,
): Promise<
  | { ok: true; imagePath: string | null; segment: Record<string, string | number> }
  | { ok: false; problemas: ProblemaNoFormulario[] }
> {
  const imagem = await conferirImagem(base, extras.imagem);
  const publico = lerPublico(extras.publico.tipo, extras.publico.dias);
  if (!imagem.ok || !publico.ok) {
    return {
      ok: false,
      problemas: [
        ...(imagem.ok ? [] : [imagem.problema]),
        ...(publico.ok ? [] : [{ campo: 'publico' as const, mensagem: publico.mensagem }]),
      ],
    };
  }
  return { ok: true, imagePath: imagem.caminho, segment: segmentoDoPublico(publico.publico) };
}

/** Os problemas do texto e os dos extras, numa lista só: o formulário mostra todos de uma vez. */
function juntarProblemas(
  texto: ReturnType<typeof validarCampanha>,
  extras: Awaited<ReturnType<typeof conferirExtras>>,
): ProblemaNoFormulario[] {
  return [...(texto.ok ? [] : texto.problemas), ...(extras.ok ? [] : extras.problemas)];
}

/**
 * Guarda a imagem escolhida no formulário e devolve o caminho (que a campanha
 * leva) e o endereço (que a prévia mostra). Sobe na hora da escolha, e não
 * ao salvar, porque o envio de teste e a prévia precisam dela antes.
 */
export async function enviarImagemDoPush(
  formulario: FormData,
): Promise<
  { ok: true; caminho: string; url: string; aviso: string | null } | { ok: false; mensagem: string }
> {
  const base = await contexto();
  if (!base.ok) return { ok: false, mensagem: base.motivo };

  const arquivo = formulario.get('imagem');
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, mensagem: 'Escolha uma imagem.' };
  }

  const guardada = await guardarImagemDoPush(criarClientServiceRole(), base.loja.id, {
    tipoMime: arquivo.type,
    bytes: new Uint8Array(await arquivo.arrayBuffer()),
  });
  if (!guardada.ok) return { ok: false, mensagem: guardada.motivo };
  return guardada;
}

export async function criarCampanha(
  entrada: {
    title: string;
    body: string;
    deepLink: string;
    agendarPara: string;
    enviarAgora: boolean;
  } & ExtrasDaCampanha,
): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  // O "agora" contra o "agendar" é decidido em `validarCampanha`: agendar sem
  // data é erro, e agora ignora a data que tenha sobrado no campo.
  const validacao = validarCampanha(
    {
      title: entrada.title,
      body: entrada.body,
      deepLink: entrada.deepLink,
      agendarPara: entrada.agendarPara,
      enviarAgora: entrada.enviarAgora,
    },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now(), fuso: base.loja.timezone },
  );
  const extras = await conferirExtras(base, entrada);
  if (!validacao.ok || !extras.ok) return { problemas: juntarProblemas(validacao, extras) };

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
      image_path: extras.imagePath,
      segment: extras.segment,
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

export async function salvarRascunhoDeCampanha(
  entrada: {
    title: string;
    body: string;
    deepLink: string;
  } & ExtrasDaCampanha,
): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    { title: entrada.title, body: entrada.body, deepLink: entrada.deepLink },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now(), fuso: base.loja.timezone },
  );
  const extras = await conferirExtras(base, entrada);
  if (!validacao.ok || !extras.ok) return { problemas: juntarProblemas(validacao, extras) };

  const { error, data } = await base.supabase
    .from('push_campaigns')
    .insert({
      app_id: base.app.id,
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: validacao.valores.deepLink,
      image_path: extras.imagePath,
      segment: extras.segment,
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
  const { data: atual, error: erroDaLeitura } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (erroDaLeitura != null) {
    return { mensagem: traduzirErro(erroDaLeitura.code, erroDaLeitura.message) };
  }
  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeCancelar(atual.status)) {
    return { mensagem: 'Esta campanha já saiu ou já está saindo. Não dá mais para cancelar.' };
  }

  const { data: cancelada, error } = await base.supabase
    .from('push_campaigns')
    .update({ status: 'canceled' })
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  // O job pegou a campanha entre a leitura e o clique: dizer "cancelada" aqui
  // seria mentir com a notificação já a caminho dos celulares.
  if (cancelada == null) {
    return { mensagem: 'Esta campanha já saiu ou já está saindo. Não dá mais para cancelar.' };
  }

  revalidatePath('/push');
  return { ok: true, mensagem: 'Campanha cancelada.' };
}

export async function excluirCampanha(campanhaId: string): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const { data: atual, error: erroDaLeitura } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (erroDaLeitura != null) {
    return { mensagem: traduzirErro(erroDaLeitura.code, erroDaLeitura.message) };
  }
  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeExcluir(atual.status)) {
    return { mensagem: 'Campanha enviada fica no histórico. Ela não pode ser excluída.' };
  }

  const { data: excluida, error } = await base.supabase
    .from('push_campaigns')
    .delete()
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .in('status', ['draft', 'canceled', 'failed'])
    .select('id')
    .maybeSingle();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (excluida == null) {
    return { mensagem: 'Não foi possível excluir: a campanha mudou. Recarregue a página.' };
  }

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
  } & ExtrasDaCampanha,
): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const { data: atual, error: erroDaLeitura } = await base.supabase
    .from('push_campaigns')
    .select('status')
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  if (erroDaLeitura != null) {
    return { mensagem: traduzirErro(erroDaLeitura.code, erroDaLeitura.message) };
  }
  if (atual == null) return { mensagem: 'Campanha não encontrada.' };
  if (!podeEditar(atual.status)) {
    return { mensagem: 'Esta campanha já saiu. O texto enviado não muda mais.' };
  }

  const validacao = validarCampanha(
    {
      title: entrada.title,
      body: entrada.body,
      deepLink: entrada.deepLink,
      agendarPara: entrada.agendarPara,
      enviarAgora: entrada.enviarAgora,
    },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now(), fuso: base.loja.timezone },
  );
  const extras = await conferirExtras(base, entrada);
  if (!validacao.ok || !extras.ok) return { problemas: juntarProblemas(validacao, extras) };

  const { data: gravada, error } = await base.supabase
    .from('push_campaigns')
    .update({
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: validacao.valores.deepLink,
      image_path: extras.imagePath,
      segment: extras.segment,
      status: 'scheduled',
      scheduled_at: (validacao.valores.agendarPara ?? new Date()).toISOString(),
    })
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .in('status', ['draft', 'scheduled'])
    .select('id')
    .maybeSingle();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  // Entre a leitura acima e esta escrita o job pode ter começado a mandar:
  // sem linha gravada, a campanha já não está mais aqui para ser editada.
  if (gravada == null) {
    return { mensagem: 'Esta campanha já saiu ou já está saindo. Não dá mais para editar.' };
  }

  revalidatePath('/push');
  return {
    ok: true,
    mensagem:
      validacao.valores.agendarPara === null ? 'Campanha na fila de envio.' : 'Campanha agendada.',
  };
}

/**
 * Guarda o texto de um rascunho SEM mandá-lo.
 *
 * Existe porque a edição de um rascunho só sabia agendar: "Salvar alterações"
 * gravava `scheduled` com a hora de agora — o lojista abria o rascunho para
 * corrigir uma vírgula e a campanha saía para todos os clientes.
 */
export async function atualizarRascunho(
  campanhaId: string,
  entrada: { title: string; body: string; deepLink: string } & ExtrasDaCampanha,
): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    { title: entrada.title, body: entrada.body, deepLink: entrada.deepLink },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now(), fuso: base.loja.timezone },
  );
  const extras = await conferirExtras(base, entrada);
  if (!validacao.ok || !extras.ok) return { problemas: juntarProblemas(validacao, extras) };

  // `status = draft` no filtro: se outra aba já agendou, o rascunho não existe
  // mais, e isto não pode devolvê-lo a rascunho por baixo dos panos.
  const { data, error } = await base.supabase
    .from('push_campaigns')
    .update({
      title: validacao.valores.title,
      body: validacao.valores.body,
      deep_link: validacao.valores.deepLink,
      image_path: extras.imagePath,
      segment: extras.segment,
    })
    .eq('id', campanhaId)
    .eq('app_id', base.app.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  if (data == null) {
    return { mensagem: 'Esta campanha não é mais um rascunho. Recarregue a página.' };
  }

  revalidatePath('/push');
  return { ok: true, mensagem: 'Rascunho salvo.' };
}

/**
 * Manda a notificação para UM celular de teste, sem criar campanha.
 *
 * É a última conferência antes de um envio que não tem volta: o lojista vê no
 * próprio celular o texto cortado, o link que abre no lugar errado e o emoji
 * que não renderiza. Nada disso aparece num campo de formulário.
 *
 * Só para um celular PAREADO pelo lojista (`test_devices`): o teste leva um
 * texto que ninguém revisou, e não pode chegar ao celular de um cliente.
 *
 * Não grava `push_campaigns`: um teste no histórico de campanhas confundiria a
 * contagem de envios e o resumo do topo da tela.
 */
export async function enviarTeste(entrada: {
  title: string;
  body: string;
  deepLink: string;
  /** O id do pareamento (`test_devices.id`), e não o do aparelho. */
  celularId: string;
  /** A imagem da campanha, para o teste chegar como a campanha vai chegar. */
  imagem: string | null;
}): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const validacao = validarCampanha(
    { title: entrada.title, body: entrada.body, deepLink: entrada.deepLink },
    { urlDaLoja: base.loja.primary_url, agoraMs: Date.now(), fuso: base.loja.timezone },
  );
  // O público não conta aqui: o teste vai para o aparelho escolhido, e só.
  const imagem = await conferirImagem(base, entrada.imagem);
  if (!validacao.ok || !imagem.ok) {
    return {
      problemas: [
        ...(validacao.ok ? [] : validacao.problemas),
        ...(imagem.ok ? [] : [imagem.problema]),
      ],
    };
  }

  const naoEDeTeste = {
    mensagem:
      'Esse celular não é mais um celular de teste desta loja. Recarregue a página e escolha outro.',
  };
  if (!ehUuid(entrada.celularId)) return naoEDeTeste;

  /*
   * O celular é lido pelo client da SESSÃO, entre os celulares de teste deste
   * app. É a RLS que decide se aquele usuário enxerga aquele pareamento — um
   * id forjado de outra loja, ou o id de um aparelho de cliente, não volta.
   */
  const { data: celular, error: erroDoCelular } = await base.supabase
    .from('test_devices')
    .select('nome, devices!inner(onesignal_subscription_id)')
    .eq('id', entrada.celularId)
    .eq('app_id', base.app.id)
    .maybeSingle();

  // Falha ao ler não é "celular não encontrado": a tela mandaria recarregar sem razão.
  if (erroDoCelular != null) {
    return { mensagem: mensagemDaFalha('push.teste', erroDoCelular, FALHA_GENERICA) };
  }
  if (celular == null) return naoEDeTeste;
  const inscricao = celular.devices.onesignal_subscription_id;
  if (inscricao === null) {
    return {
      mensagem: `${celular.nome} ainda não recebe notificações. Abra o app nele, permita as notificações e tente de novo.`,
    };
  }

  const { data: credenciais, error: erroDasCredenciais } = await criarClientServiceRole()
    .from('apps')
    .select('onesignal_app_id, onesignal_api_key_enc')
    .eq('id', base.app.id)
    .maybeSingle();
  if (erroDasCredenciais != null) {
    return { mensagem: mensagemDaFalha('push.teste', erroDasCredenciais, FALHA_GENERICA) };
  }

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
  const { data: cabe, error: erroDoLimite } = await criarClientServiceRole().rpc(
    'consumir_limite',
    {
      p_chave: `teste:${base.app.id}`,
      p_maximo: 10,
      p_janela_segundos: 60,
    },
  );
  // Sem saber se cabe, não manda: o limite é o que segura o clique repetido.
  if (erroDoLimite != null) {
    return { mensagem: mensagemDaFalha('push.teste', erroDoLimite, FALHA_GENERICA) };
  }
  if (!cabe) {
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
      inscricoes: [inscricao],
      imagem:
        imagem.caminho === null
          ? null
          : urlDaImagemDoPush(criarClientServiceRole(), imagem.caminho),
    },
  );

  if (!resultado.ok) {
    return {
      mensagem: resultado.permanente
        ? `Não deu para enviar o teste: ${resultado.motivo}`
        : 'Não conseguimos falar com o servidor de push agora. Tente de novo em instantes.',
    };
  }

  return { ok: true, mensagem: `Teste enviado para ${celular.nome}. Confira o celular.` };
}

// ------------------------------------------------------ celular de teste

export interface EstadoDoCodigoDeTeste {
  ok?: boolean;
  mensagem?: string;
  /** O que está errado no nome do celular, para aparecer embaixo do campo. */
  erroNoNome?: string;
  /** O código em claro. Existe só nesta resposta; o banco guarda o hash. */
  codigo?: string;
  /** O QR, em SVG, com o link da página que abre o app. */
  qr?: string;
  /** O link do próprio app, para quem está com o painel aberto no celular. */
  abrirNoApp?: string;
  /** Quando o código nasceu e quando vence, pelo relógio do banco. */
  geradoEm?: string;
  expiraEm?: string;
}

/**
 * Gera o código e o QR para parear um celular de teste (C08).
 *
 * O código volta em claro uma única vez — é o que vai para o QR. O celular é
 * pareado quando o app, aberto pelo QR, se apresenta com ele
 * (`/api/public/test-device`); a tela acompanha por `lerCelularesDeTeste`.
 */
export async function gerarCodigoDeTeste(nome: string): Promise<EstadoDoCodigoDeTeste> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const limpo = nome.trim();
  if (limpo === '' || limpo.length > MAXIMO_DO_NOME) {
    return {
      erroNoNome:
        limpo === ''
          ? 'Dê um nome ao celular, como "Celular da Ana".'
          : `Use até ${String(MAXIMO_DO_NOME)} letras no nome.`,
    };
  }

  const { data, error } = await base.supabase.rpc('criar_codigo_de_teste', {
    p_app_id: base.app.id,
    p_nome: limpo,
  });
  if (error != null) {
    if (error.code === '42501') {
      return {
        mensagem: 'Apenas proprietários e administradores adicionam celulares de teste.',
      };
    }
    if (error.code === '22023') return { erroNoNome: error.message };
    return { mensagem: mensagemDaFalha('push.celular-de-teste', error, FALHA_GENERICA) };
  }

  // As colunas de uma função que devolve tabela chegam anuláveis no tipo.
  const linha = Array.isArray(data) ? data[0] : null;
  const expira = linha?.expira_em == null ? Number.NaN : Date.parse(linha.expira_em);
  if (linha?.codigo == null || Number.isNaN(expira)) {
    log.erro('push.celular-de-teste.sem-codigo', { app: base.app.id });
    return { mensagem: 'Não foi possível gerar o código. Tente de novo.' };
  }

  let qr: string;
  try {
    qr = await qrParaSvg(linkDoQr(urlDoSite(), base.loja.id, linha.codigo), {
      type: 'svg',
      margin: 1,
      // Nível médio: continua legível com o dedo cobrindo um canto da tela.
      errorCorrectionLevel: 'M',
    });
  } catch (erro) {
    log.erro('push.celular-de-teste.qr', {
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    });
    return { mensagem: 'Não conseguimos desenhar o QR code. Tente de novo.' };
  }

  return {
    ok: true,
    codigo: linha.codigo,
    qr,
    abrirNoApp: linkDoApp(base.loja.id, linha.codigo),
    geradoEm: new Date(expira - MINUTOS_DO_CODIGO * 60_000).toISOString(),
    expiraEm: new Date(expira).toISOString(),
  };
}

/** Os celulares de teste agora — a tela do QR pergunta até o celular aparecer. */
export async function lerCelularesDeTeste(): Promise<
  { ok: true; celulares: CelularDeTeste[] } | { ok: false; mensagem: string }
> {
  const base = await contexto();
  if (!base.ok) return { ok: false, mensagem: base.motivo };

  try {
    return { ok: true, celulares: await celularesDeTeste(base.supabase, base.app.id) };
  } catch (erro) {
    log.erro('push.celular-de-teste.ler', {
      motivo: erro instanceof Error ? erro.message : 'falha desconhecida',
    });
    return {
      ok: false,
      mensagem: 'Não conseguimos ver os celulares de teste agora. Tente de novo em instantes.',
    };
  }
}

/**
 * Remove um celular de teste: ele para de receber os testes.
 *
 * Pela sessão, e a RLS só deixa o dono e o administrador; o gatilho grava na
 * trilha quem removeu. O aparelho continua sendo um aparelho do app — só
 * deixa de ser "de teste".
 */
export async function removerCelularDeTeste(celularId: string): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const jaNaoEra = {
    mensagem: 'Esse celular já não era um celular de teste. Recarregue a página.',
  };
  if (!ehUuid(celularId)) return jaNaoEra;

  const { data, error } = await base.supabase
    .from('test_devices')
    .delete()
    .eq('id', celularId)
    .eq('app_id', base.app.id)
    .select('nome')
    .maybeSingle();

  if (error != null) return { mensagem: traduzirErro(error.code, error.message) };
  // Nenhuma linha: já tinha sido removido (outra aba, outra pessoa) ou não é desta loja.
  if (data == null) return jaNaoEra;

  // Sem revalidar a página: a lista é da própria tela, e a campanha em edição fica como está.
  return { ok: true, mensagem: `${data.nome} não recebe mais os testes.` };
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
  const { lojaAtiva, papel, usuario } = await exigirContextoCliente();
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

  const resultado = await ativarNotificacoes(
    criarClientServiceRole({ ator: usuario.id }),
    lojaAtiva.id,
  );
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

  // O tipo estreitado pela própria guarda. Um "estreitador" à parte, escrito
  // quando só existiam duas automações, gravava toda automação nova como
  // carrinho abandonado — por cima do texto e da chave do carrinho.
  const tipo = entrada.tipo;
  if (!ehTipoDeAutomacao(tipo)) {
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
      type: tipo,
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
      ? `Automação “${DESCRICAO_DO_TIPO[tipo].nome}” ligada.`
      : `Automação “${DESCRICAO_DO_TIPO[tipo].nome}” desligada.`,
  };
}

/*
 * ---------------------------------------------- a chave do webhook (C09)
 *
 * A chave é gerada AQUI, no servidor, e devolvida uma vez: o banco guarda só o
 * hash, numa tabela que o painel não lê. Quem grava é a service role, depois
 * de `contexto()` conferir que a pessoa é proprietária ou administradora — e a
 * função do banco põe o nome dela na trilha de auditoria.
 */

export async function gerarChaveDoWebhook(): Promise<
  { ok: true; chave: string } | { ok: false; mensagem: string }
> {
  const base = await contexto();
  if (!base.ok) return { ok: false, mensagem: base.motivo };

  /*
   * A automação precisa existir para ter chave. Sem linha ainda, nasce com o
   * texto sugerido e DESLIGADA: ligar é decisão do lojista, na chave do card.
   */
  const sugestao = DESCRICAO_DO_TIPO.custom_webhook.sugestao;
  const { error: erroAoCriar } = await base.supabase.from('push_automations').upsert(
    {
      app_id: base.app.id,
      type: 'custom_webhook',
      enabled: false,
      delay_minutes: sugestao.delayMinutes,
      title: sugestao.title,
      body: sugestao.body,
    },
    { onConflict: 'app_id,type', ignoreDuplicates: true },
  );
  if (erroAoCriar != null) {
    return { ok: false, mensagem: mensagemDaFalha('push.webhook', erroAoCriar, FALHA_GENERICA) };
  }

  const { data: automacao, error: erroAoLer } = await base.supabase
    .from('push_automations')
    .select('id')
    .eq('app_id', base.app.id)
    .eq('type', 'custom_webhook')
    .maybeSingle();
  if (erroAoLer != null || automacao == null) {
    return {
      ok: false,
      mensagem: mensagemDaFalha(
        'push.webhook',
        erroAoLer ?? { message: 'automação sumiu' },
        FALHA_GENERICA,
      ),
    };
  }

  const chave = gerarChave();
  const { error } = await criarClientServiceRole().rpc('definir_chave_do_webhook', {
    p_automacao: automacao.id,
    p_ator: base.usuario.id,
    p_hash: hashDaChave(chave),
    p_dica: dicaDaChave(chave),
  });
  if (error != null) {
    return { ok: false, mensagem: mensagemDaFalha('push.webhook', error, FALHA_GENERICA) };
  }

  revalidatePath('/push/automacoes');
  return { ok: true, chave };
}

export async function desativarChaveDoWebhook(): Promise<EstadoDoPush> {
  const base = await contexto();
  if (!base.ok) return { mensagem: base.motivo };

  const { data: automacao, error: erroAoLer } = await base.supabase
    .from('push_automations')
    .select('id')
    .eq('app_id', base.app.id)
    .eq('type', 'custom_webhook')
    .maybeSingle();
  if (erroAoLer != null) {
    return { mensagem: mensagemDaFalha('push.webhook', erroAoLer, FALHA_GENERICA) };
  }
  if (automacao == null) return { mensagem: 'Esta automação ainda não tem chave.' };

  const { data: removida, error } = await criarClientServiceRole().rpc('remover_chave_do_webhook', {
    p_automacao: automacao.id,
    p_ator: base.usuario.id,
  });
  if (error != null) {
    return { mensagem: mensagemDaFalha('push.webhook', error, FALHA_GENERICA) };
  }

  revalidatePath('/push/automacoes');
  // Outra aba desativou antes: dizer "desativada" seria contar uma ação que não houve.
  if (!removida) return { ok: true, mensagem: 'A chave já estava desativada.' };
  return {
    ok: true,
    mensagem: 'Chave desativada. A ferramenta que usava esta chave para de funcionar.',
  };
}
