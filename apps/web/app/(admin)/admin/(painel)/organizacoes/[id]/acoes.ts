'use server';

/**
 * As notas internas sobre um cliente (A04).
 *
 * Escrita pela SERVICE ROLE, e não por policy: `org_notes` só tem policy de
 * leitura, e para platform_admins. Uma policy de escrita seria uma segunda
 * porta a lembrar de trancar, e o crivo de quem pode escrever já mora aqui.
 *
 * APAGAR É AUDITADO, ESCREVER NÃO, e a assimetria é intencional. A nota que
 * existe já diz quem a escreveu e quando — ela é o próprio registro. Apagar é
 * o ato que destrói informação sobre um cliente, e é o único que não deixa
 * rastro por si mesmo.
 */
import { revalidatePath } from 'next/cache';
import { exigirPlatformAdmin, exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { formatarDia } from '@/lib/cobranca';
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import { log } from '@/lib/log';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { conferirNota } from '@/lib/notas-internas';
import { DURACAO_DA_VISITA_MS, conferirMotivo, criarToken } from '@/lib/visita';
import { urlDoSite } from '@/lib/env';
import type { ValoresDigitados } from '@/lib/validacao';

export interface EstadoDaNota {
  ok?: boolean;
  mensagem?: string;
}

export async function adicionarNota(
  _anterior: EstadoDaNota,
  dados: FormData,
): Promise<EstadoDaNota> {
  const usuario = await exigirPlatformAdmin();

  const orgId = texto(dados.get('orgId'));
  if (orgId === '') return { mensagem: 'Organização não informada.' };

  const conferida = conferirNota(texto(dados.get('body')));
  if (!conferida.ok) return { mensagem: conferida.motivo };

  const servico = criarClientServiceRole();
  const { error } = await servico
    .from('org_notes')
    .insert({ org_id: orgId, author_id: usuario.id, body: conferida.texto });

  if (error != null) {
    /*
     * A constraint do banco cobre o mesmo que `conferirNota`, então chegar
     * aqui por tamanho seria os dois terem divergido. O que sobra de provável
     * é a organização não existir mais — e a mensagem diz isso, em vez de
     * repetir "tente de novo" para algo que não vai melhorar tentando.
     */
    return { mensagem: 'Não conseguimos salvar a nota. Confira se o cliente ainda existe.' };
  }

  revalidatePath(`/admin/organizacoes/${orgId}`);
  return { ok: true, mensagem: 'Nota salva.' };
}

export async function apagarNota(notaId: string): Promise<EstadoDaNota> {
  const usuario = await exigirPlatformAdmin();
  const servico = criarClientServiceRole();

  /*
   * A nota é lida ANTES de apagar, por duas razões: sem ela não há `org_id`
   * para revalidar a página certa, e o texto precisa entrar na auditoria —
   * uma linha dizendo "apagou a nota tal" sem dizer o que a nota dizia não
   * serve para nada daqui a seis meses.
   */
  const { data: nota, error: erroDaNota } = await servico
    .from('org_notes')
    .select('id, org_id, body')
    .eq('id', notaId)
    .maybeSingle();

  if (erroDaNota != null) {
    return { mensagem: mensagemDaFalha('admin-nota', erroDaNota, FALHA_GENERICA) };
  }
  if (nota == null) return { mensagem: 'Essa nota não existe mais.' };

  const { error } = await servico.from('org_notes').delete().eq('id', notaId);
  if (error != null) return { mensagem: 'Não conseguimos apagar a nota. Tente de novo.' };

  const { error: erroDaTrilha } = await servico.from('audit_logs').insert({
    actor_id: usuario.id,
    org_id: nota.org_id,
    action: 'delete',
    entity: 'org_notes',
    entity_id: nota.id,
    diff: { body: nota.body },
  });
  // A nota já saiu; a trilha que faltar precisa chegar à equipe.
  if (erroDaTrilha != null)
    log.erro('admin-nota.auditoria-nao-gravada', { nota: nota.id, falha: erroDaTrilha });

  revalidatePath(`/admin/organizacoes/${nota.org_id}`);
  return { ok: true, mensagem: 'Nota apagada.' };
}

export interface EstadoDaVisita {
  mensagem?: string;
  valores?: ValoresDigitados;
  /** O endereço do convite: a tela navega para ele (ver o fim de `iniciarVisita`). */
  destino?: string;
}

/**
 * "Ver como cliente" (A04): abre o painel deste cliente, SÓ PARA LER.
 *
 * A ordem é a garantia: a auditoria é gravada ANTES de o convite existir, e
 * se ela falhar a visita não abre. Uma visita sem registro é exatamente o que
 * esta tela não pode permitir.
 *
 * O convite vai na URL e vale 5 minutos, e só abre a visita na sessão do
 * MESMO admin (ver `app/visita/iniciar`). Vazado num log, não serve a mais
 * ninguém.
 */
export async function iniciarVisita(
  _anterior: EstadoDaVisita,
  dados: FormData,
): Promise<EstadoDaVisita> {
  const usuario = await exigirPlatformAdmin();
  const valores = { motivo: texto(dados.get('motivo')) };

  const orgId = texto(dados.get('orgId'));
  if (orgId === '') return { mensagem: 'Organização não informada.', valores };

  const motivo = conferirMotivo(valores.motivo);
  if (!motivo.ok) return { mensagem: motivo.mensagem, valores };

  const servico = criarClientServiceRole();
  const { data: org, error: erroDaOrg } = await servico
    .from('organizations')
    .select('id')
    .eq('id', orgId)
    .maybeSingle();
  if (erroDaOrg != null) {
    return { mensagem: mensagemDaFalha('admin-visita', erroDaOrg, FALHA_GENERICA), valores };
  }
  if (org == null) return { mensagem: 'Este cliente não existe mais.', valores };

  let convite: string;
  try {
    convite = criarToken('convite', orgId, usuario.id);
  } catch {
    return {
      mensagem:
        'A chave de criptografia do servidor não está configurada, e sem ela a visita não tem como ser assinada. Veja a tela Sistema.',
      valores,
    };
  }

  const { error } = await servico.from('audit_logs').insert({
    actor_id: usuario.id,
    org_id: orgId,
    action: 'view_as_start',
    entity: 'organizations',
    entity_id: orgId,
    diff: {
      motivo: motivo.motivo,
      expira_em: new Date(Date.now() + DURACAO_DA_VISITA_MS).toISOString(),
    },
  });
  if (error != null) {
    return {
      mensagem: 'Não conseguimos registrar a visita na auditoria, e sem o registro ela não abre.',
      valores,
    };
  }

  /*
   * O destino VOLTA para a tela, que navega até ele — e não um `redirect()`
   * daqui. Redirecionar de uma ação para dentro do próprio app faz o Next
   * renderizar o destino NO SERVIDOR, seguindo o 303 da rota da visita com os
   * cookies de antes: o cookie da visita nunca chegava ao navegador, e o admin
   * via o próprio painel com o endereço do convite na barra. Quem achou foi o
   * e2e.
   *
   * Endereço ABSOLUTO do painel do cliente: com domínio próprio, o admin mora
   * em outro host, e um caminho relativo cairia dentro do admin.
   */
  return { destino: `${urlDoSite()}/visita/iniciar?convite=${encodeURIComponent(convite)}` };
}

/** O campo como texto: `FormData.get` devolve string OU File. */
function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}

export interface EstadoDoTeste {
  ok?: boolean;
  mensagem?: string;
  valores?: ValoresDigitados;
}

/**
 * Estende o teste de um cliente (piloto, negociação, ajuda num build travado).
 *
 * Com a sessão de QUEM PEDE, e não com a service role: `estender_teste`
 * confere no banco que é superadmin, e o gatilho de auditoria de
 * `organizations` grava essa pessoa como autora, com o antes e o depois.
 */
export async function estenderTeste(
  _anterior: EstadoDoTeste,
  dados: FormData,
): Promise<EstadoDoTeste> {
  const { papel } = await exigirPlatformAdminComPapel();
  const valores = { ate: texto(dados.get('ate')) };
  if (papel !== 'superadmin')
    return { mensagem: 'Só superadmin estende o teste de um cliente.', valores };

  const orgId = texto(dados.get('orgId'));
  const ate = valores.ate;
  if (orgId === '') return { mensagem: 'Organização não informada.', valores };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { mensagem: 'Escolha a data.', valores };

  const supabase = await criarClientServidor();
  const { error } = await supabase.rpc('estender_teste', { p_org_id: orgId, p_ate: ate });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'estender-teste',
        error,
        'Não conseguimos estender. Tente de novo.',
      ),
      valores,
    };
  }

  revalidatePath(`/admin/organizacoes/${orgId}`);
  return { ok: true, mensagem: `Teste estendido até ${formatarDia(ate)}.`, valores: {} };
}
