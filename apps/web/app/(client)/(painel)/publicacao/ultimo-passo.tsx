/**
 * C12 — o último passo para o app ir ao ar.
 *
 * Aparece no alto da Publicação quando a vez é do lojista: a Apple esperando o
 * envio para a revisão (ou o clique em "Liberar"), o Google esperando a
 * publicação em produção. Sem este cartão, o binário ficava parado na App
 * Store Connect ou no teste interno enquanto a tela dizia "aguardar a
 * revisão" — e o lojista esperava por algo que nunca ia acontecer.
 *
 * O que dizer vem de `lib/ultimo-passo.ts`, pelo estado que a loja informa ao
 * job da revisão de hora em hora.
 */
import { ExternalLink, Hand } from 'lucide-react';
import type { PassoDoLojista } from '@/lib/ultimo-passo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const LOJA = { ios: 'App Store', android: 'Play Store' } as const;

export function UltimoPasso({
  pendentes,
}: {
  pendentes: readonly { plataforma: 'ios' | 'android'; passo: PassoDoLojista }[];
}) {
  if (pendentes.length === 0) return null;

  return (
    <section aria-labelledby="ultimo-passo" className="space-y-3">
      <div className="space-y-1">
        <h2 id="ultimo-passo" className="flex items-center gap-2 text-lg font-semibold">
          <Hand className="size-5" aria-hidden />
          Falta um passo seu
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          A Storefy gerou e enviou o app. Mandar para a revisão e publicar é feito na sua conta de
          desenvolvedor — a loja de aplicativos exige que seja você.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {pendentes.map(({ plataforma, passo }) => (
          <Card
            key={plataforma}
            data-testid={`ultimo-passo-${plataforma}`}
            className="border-primary/40"
          >
            <CardHeader>
              <CardDescription>{LOJA[plataforma]}</CardDescription>
              <CardTitle className="text-base">{passo.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="ml-5 list-decimal space-y-1.5 text-sm">
                {passo.passos.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ol>
              <Button asChild size="sm">
                <a href={passo.link.url} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-4" aria-hidden />
                  {passo.link.rotulo}
                </a>
              </Button>
              <p className="text-muted-foreground text-xs">
                Depois que você fizer isso, esta tela se atualiza sozinha em até uma hora.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
