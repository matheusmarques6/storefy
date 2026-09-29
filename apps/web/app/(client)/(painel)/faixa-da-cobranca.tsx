/**
 * A faixa da cobrança, no topo de todas as telas do painel.
 *
 * Aparece quando há algo a fazer ANTES de travar (teste acabando, fatura em
 * atraso dentro da tolerância) e quando já travou — dizendo o que parou e o
 * que continua: o app dos clientes da loja não sai do ar por causa disso.
 * Sem ela, o lojista só descobriria a trava ao ver uma campanha recusada.
 */
import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { criarClientServidor } from '@/lib/supabase/server';
import { avisoDaCobranca, type SituacaoDaCobranca } from '@/lib/cobranca';
import { lerSituacaoDaCobranca } from '@/lib/cobranca-servidor';
import { cn } from '@/lib/utils';

export async function FaixaDaCobranca({ orgId }: { orgId: string }) {
  const supabase = await criarClientServidor();
  let situacao: SituacaoDaCobranca;
  try {
    situacao = await lerSituacaoDaCobranca(supabase, orgId);
  } catch (erro) {
    // A faixa é um lembrete: sem ela o painel segue, e as travas do banco
    // continuam valendo. O erro vai para o log, onde alguém vê.
    console.error('[cobranca] faixa sem a situação:', erro instanceof Error ? erro.message : erro);
    return null;
  }

  const aviso = avisoDaCobranca(situacao);
  if (aviso === null) return null;

  return (
    <div
      role={aviso.grave ? 'alert' : 'status'}
      className={cn(
        'border-b',
        aviso.grave ? 'bg-destructive/10 text-destructive' : 'bg-amber-50 text-amber-900',
      )}
    >
      <p className="mx-auto flex max-w-6xl flex-wrap items-start gap-x-2 gap-y-1 px-4 py-2 text-sm">
        {aviso.grave ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">{aviso.texto}</span>
        <Link href="/configuracoes/plano" className="font-medium underline underline-offset-4">
          {aviso.acao}
        </Link>
      </p>
    </div>
  );
}
