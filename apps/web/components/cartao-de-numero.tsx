/**
 * Um número grande com rótulo e uma linha de explicação.
 *
 * A dica não é enfeite: "sessões" e "ativos" são a mesma coisa para quem nunca
 * leu um painel de métricas, e um número sem legenda vira desconfiança. Ela
 * também é onde se diz que o número ainda não existe, em vez de mostrar zero.
 */
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function CartaoDeNumero({
  icone: Icone,
  rotulo,
  valor,
  dica,
}: {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  dica: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Icone className="size-4" aria-hidden />
          {rotulo}
        </div>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        <p className="text-muted-foreground text-xs">{dica}</p>
      </CardContent>
    </Card>
  );
}
