/**
 * `POST /visita/encerrar` — fecha a visita e volta para a ficha do cliente.
 *
 * O fim também vai para a auditoria, com quanto tempo a visita durou. A
 * visita que vence sozinha não gera essa linha — mas o começo já registrou até
 * quando ela valia, e a trilha não fica com buraco.
 *
 * É uma das duas rotas que aceitam escrita durante a visita (o proxy recusa
 * as outras), e por isso não faz nada além de apagar os cookies e registrar.
 */
import { type NextResponse, type NextRequest } from 'next/server';
import { redirecionarPara } from '@/lib/redirecionar';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { DURACAO_DA_VISITA_MS, conferirToken } from '@/lib/visita';
import { COOKIE_LOJA_DA_VISITA, COOKIE_VISITA } from '@/lib/visita-nomes';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  const visita = conferirToken(requisicao.cookies.get(COOKIE_VISITA)?.value, 'visita');

  const supabase = await criarClientServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (visita != null && user?.id === visita.adminId) {
    const inicio = visita.expiraEm - DURACAO_DA_VISITA_MS;
    const { error } = await criarClientServiceRole()
      .from('audit_logs')
      .insert({
        actor_id: user.id,
        org_id: visita.orgId,
        action: 'view_as_end',
        entity: 'organizations',
        entity_id: visita.orgId,
        diff: { duracao_minutos: Math.max(1, Math.round((Date.now() - inicio) / 60_000)) },
      });
    // A visita fecha de qualquer jeito: prender o admin dentro dela por uma
    // falha de registro seria pior. O começo já está na trilha.
    if (error != null) log.erro('visita.fim-nao-registrado', { falha: error });
  }

  const destino = visita == null ? '/admin/organizacoes' : `/admin/organizacoes/${visita.orgId}`;
  const resposta = redirecionarPara(destino);
  resposta.cookies.delete(COOKIE_VISITA);
  resposta.cookies.delete(COOKIE_LOJA_DA_VISITA);
  return resposta;
}
