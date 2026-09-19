'use client';

/** A tarja de status de uma conta, comum aos dois cartões. */
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import type { ContaNaTela } from '@/lib/contas-de-desenvolvedor';

export function EstadoDaConta({ conta }: { conta: ContaNaTela | null }) {
  if (conta === null || conta.status === 'pending' || conta.status === 'invited') {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
        <CircleDashed className="size-4" aria-hidden />
        Não conectada
      </span>
    );
  }

  if (conta.status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4" aria-hidden />
        Conectada
        {conta.identificacao === null ? null : (
          <span className="text-muted-foreground font-mono text-xs">{conta.identificacao}</span>
        )}
      </span>
    );
  }

  /*
   * O motivo da última falha fica na tela, e não só no log. Sem ele o lojista
   * tenta o mesmo arquivo de novo — e a mensagem da Apple, quando aparece, é
   * um "401" que não diz nada.
   */
  return (
    <span className="text-destructive inline-flex items-start gap-1.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{conta.observacao ?? 'A última tentativa não deu certo.'}</span>
    </span>
  );
}
