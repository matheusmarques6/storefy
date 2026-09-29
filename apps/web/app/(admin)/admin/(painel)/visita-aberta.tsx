/**
 * Aviso no admin de que há uma visita ao painel de cliente aberta NESTE
 * navegador.
 *
 * Quem abre a visita e volta para o admin por outro caminho esquece que ela
 * continua aberta — e o próprio painel da pessoa passa a mostrar o do cliente.
 * O aviso lembra, leva de volta, e fecha.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Eye } from 'lucide-react';
import { criarClientServidor } from '@/lib/supabase/server';
import { conferirToken } from '@/lib/visita';
import { COOKIE_VISITA } from '@/lib/visita-nomes';
import { FUSO_PADRAO, formatarHora } from '@/lib/fuso';
import { Button } from '@/components/ui/button';

export async function VisitaAberta({ adminId }: { adminId: string }) {
  const armazem = await cookies();
  const visita = conferirToken(armazem.get(COOKIE_VISITA)?.value, 'visita');
  if (visita?.adminId !== adminId) return null;

  const supabase = await criarClientServidor();
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', visita.orgId)
    .maybeSingle();
  if (org == null) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <p className="flex min-w-0 items-center gap-2">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span>
            A visita ao painel de <strong>{org.name}</strong> continua aberta até{' '}
            {formatarHora(visita.expiraEm, FUSO_PADRAO)}.
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link href="/">Voltar ao painel do cliente</Link>
          </Button>
          <form method="post" action="/visita/encerrar">
            <Button type="submit" size="sm" variant="outline" className="bg-background h-8">
              Encerrar visita
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
