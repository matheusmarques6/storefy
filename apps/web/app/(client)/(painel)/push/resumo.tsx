/**
 * Os três números do topo das notificações.
 *
 * Todos saem de dado real. Quando um número ainda não existe, vai traço — e
 * não zero: "0 aparelhos" é uma afirmação sobre o app do lojista, e dizê-la
 * porque a contagem falhou faria ele achar que ninguém instalou (regra 1).
 */
import { Bell, CheckCircle2, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { lerMetricas, numeroOuTraco } from '@/lib/campanha';
import type { CampanhaNaLista } from '@/lib/push-servidor';

export function ResumoDoPush({
  aparelhos,
  campanhas,
}: {
  aparelhos: number | null;
  campanhas: readonly CampanhaNaLista[];
}) {
  const enviadas = campanhas.filter((campanha) => campanha.status === 'sent').length;

  /*
   * Soma só o que o job de estatísticas já gravou. Uma campanha sem número
   * ainda não entra na conta, em vez de entrar como zero e puxar o total para
   * baixo — o que faria o lojista ler o próprio desempenho errado.
   */
  const comMetrica = campanhas
    .map((campanha) => lerMetricas(campanha.stats).entregues)
    .filter((valor): valor is number => valor !== null);

  const entregues = comMetrica.length === 0 ? null : comMetrica.reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Numero
        icone={Smartphone}
        rotulo="Aparelhos com o app"
        valor={numeroOuTraco(aparelhos)}
        dica="Quem instalou e pode receber notificações."
      />
      <Numero
        icone={CheckCircle2}
        rotulo="Campanhas enviadas"
        valor={enviadas.toLocaleString('pt-BR')}
        dica="Total já disparado por esta loja."
      />
      <Numero
        icone={Bell}
        rotulo="Notificações entregues"
        valor={numeroOuTraco(entregues)}
        dica={
          entregues === null
            ? 'Aparece algumas horas depois do primeiro envio.'
            : 'Soma das campanhas com estatística disponível.'
        }
      />
    </div>
  );
}

function Numero({
  icone: Icone,
  rotulo,
  valor,
  dica,
}: {
  icone: typeof Bell;
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
