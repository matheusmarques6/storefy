'use client';

/** O que esconder da loja e o que injetar nela (C06c). */
import { Trash2 } from 'lucide-react';
import type { AppConfig } from '@storefy/config-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { editarWebview } from '@/lib/editor-de-config';

export function SecaoLoja({
  config,
  aoMudar,
  somenteLeitura,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
}) {
  const { webview } = config;

  function trocarSeletor(indice: number, valor: string) {
    const lista = [...webview.hideSelectors];
    lista[indice] = valor;
    aoMudar(editarWebview(config, { hideSelectors: lista }));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Esconder da loja</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            O cabeçalho e o rodapé do site repetem o que a barra de abas já faz. Escondê-los é o que
            faz a loja parecer um app de verdade.
          </p>
        </div>

        {webview.hideSelectors.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            Nada escondido ainda. Use a prévia ao lado para clicar no que quer sumir, ou adicione um
            item abaixo.
          </p>
        ) : (
          <ul className="space-y-2">
            {webview.hideSelectors.map((seletor, indice) => (
              <li key={`${seletor}:${String(indice)}`} className="flex items-center gap-2">
                <Input
                  aria-label={`Item escondido ${String(indice + 1)}`}
                  value={seletor}
                  spellCheck={false}
                  className="font-mono text-xs"
                  disabled={somenteLeitura}
                  onChange={(evento) => {
                    trocarSeletor(indice, evento.target.value);
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Parar de esconder ${seletor}`}
                  disabled={somenteLeitura}
                  onClick={() => {
                    aoMudar(
                      editarWebview(config, {
                        hideSelectors: webview.hideSelectors.filter((_, i) => i !== indice),
                      }),
                    );
                  }}
                >
                  <Trash2 className="text-destructive size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {somenteLeitura ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              aoMudar(editarWebview(config, { hideSelectors: [...webview.hideSelectors, ''] }));
            }}
          >
            Adicionar item
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Puxar para atualizar</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Deixa o cliente arrastar a página para baixo para recarregar.
            </p>
          </div>
          <Switch
            aria-label="Puxar para atualizar"
            checked={webview.pullToRefresh}
            disabled={somenteLeitura}
            onCheckedChange={(proximo) => {
              aoMudar(editarWebview(config, { pullToRefresh: proximo }));
            }}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Ajustes avançados</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Só mexa aqui se souber o que está fazendo. Um erro de digitação no CSS ou no JavaScript
            afeta a loja dentro do app.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="css-personalizado">CSS aplicado na loja</Label>
          <Textarea
            id="css-personalizado"
            value={webview.customCss}
            spellCheck={false}
            placeholder=".anuncio { display: none; }"
            className="font-mono text-xs"
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar(editarWebview(config, { customCss: evento.target.value }));
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="js-personalizado">JavaScript aplicado na loja</Label>
          <Textarea
            id="js-personalizado"
            value={webview.customJs}
            spellCheck={false}
            className="font-mono text-xs"
            disabled={somenteLeitura}
            onChange={(evento) => {
              aoMudar(editarWebview(config, { customJs: evento.target.value }));
            }}
          />
          <p className="text-muted-foreground text-xs">
            Roda depois que a página carrega, isolado do resto do app: um erro aqui não apaga o
            carrinho nem a barra de abas.
          </p>
        </div>
      </section>
    </div>
  );
}
