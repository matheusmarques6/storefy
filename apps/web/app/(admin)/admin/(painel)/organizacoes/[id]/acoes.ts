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
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { conferirNota } from '@/lib/notas-internas';

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
  const { data: nota } = await servico
    .from('org_notes')
    .select('id, org_id, body')
    .eq('id', notaId)
    .maybeSingle();

  if (nota == null) return { mensagem: 'Essa nota não existe mais.' };

  const { error } = await servico.from('org_notes').delete().eq('id', notaId);
  if (error != null) return { mensagem: 'Não conseguimos apagar a nota. Tente de novo.' };

  await servico.from('audit_logs').insert({
    actor_id: usuario.id,
    org_id: nota.org_id,
    action: 'delete',
    entity: 'org_notes',
    entity_id: nota.id,
    diff: { body: nota.body },
  });

  revalidatePath(`/admin/organizacoes/${nota.org_id}`);
  return { ok: true, mensagem: 'Nota apagada.' };
}

/** O campo como texto: `FormData.get` devolve string OU File. */
function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}
