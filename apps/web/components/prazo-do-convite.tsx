'use client';

/**
 * O prazo de um convite em palavras ("Vence em 3 dias", "Venceu").
 *
 * Cliente de propósito: a hora de agora é lida uma vez, no navegador, e não
 * no meio do render do servidor.
 */
import { useState } from 'react';
import { prazoDoConvite } from '@/lib/convites';
import { Badge } from '@/components/ui/badge';

export function PrazoDoConvite({ expiraEm }: { expiraEm: string }) {
  const [agora] = useState(() => Date.now());
  const prazo = prazoDoConvite(expiraEm, agora);
  return prazo.vencido ? (
    <Badge variant="outline">{prazo.texto}</Badge>
  ) : (
    <span>{prazo.texto}</span>
  );
}
