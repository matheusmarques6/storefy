import 'server-only';

/**
 * Os autores das linhas da auditoria, pelo id (A12 e A04).
 *
 * O e-mail mora em `auth.users`, que o painel não lê; quem responde é a
 * função `admin_autores_da_auditoria`, só para a equipe da plataforma. Erro
 * de leitura vira erro visível: mostrar "o sistema" no lugar de uma pessoa
 * porque a consulta falhou faria o suporte tirar a conclusão errada.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import type { AutorDaAuditoria } from '@/lib/autor-da-auditoria';

export async function autoresDaAuditoria(
  supabase: SupabaseClient<Database>,
  ids: readonly (string | null)[],
): Promise<Map<string, AutorDaAuditoria>> {
  const unicos = [...new Set(ids.filter((id): id is string => id !== null))];
  const autores = new Map<string, AutorDaAuditoria>();
  if (unicos.length === 0) return autores;

  const { data, error } = await supabase.rpc('admin_autores_da_auditoria', { p_ids: unicos });
  if (error != null) throw new Error(`Não foi possível ler quem fez cada ação: ${error.message}`);

  // Função que devolve tabela sai com toda coluna anulável no tipo gerado; a
  // linha sem id ou sem e-mail não teria a quem se referir.
  for (const linha of data) {
    if (linha.user_id === null || linha.email === null) continue;
    autores.set(linha.user_id, {
      email: linha.email,
      nome: linha.nome,
      equipe: linha.equipe === true,
    });
  }
  return autores;
}
