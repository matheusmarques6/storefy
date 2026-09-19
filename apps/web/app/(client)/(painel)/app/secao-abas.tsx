'use client';

/** As abas da barra: ordem, nome, ícone e destino (C06b). */
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { NOMES_DE_ICONE, ROTULO_DO_ICONE, type AppConfig, type Tab } from '@storefy/config-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  MAX_ABAS,
  MIN_ABAS,
  adicionarAba,
  editarAba,
  moverAba,
  podeAdicionarAba,
  podeRemoverAba,
  removerAba,
  tiposDisponiveis,
} from '@/lib/editor-de-config';
import { IconeDaAba } from './icone-da-aba';

const ROTULO_DO_TIPO: Record<Tab['type'], string> = {
  webview: 'Página da loja',
  search: 'Busca',
  cart: 'Carrinho',
  account: 'Conta',
  notifications: 'Avisos',
};

const EXPLICACAO_DO_TIPO: Record<Tab['type'], string> = {
  webview: 'Abre um endereço da sua loja, como uma coleção.',
  search: 'Abre a busca da loja.',
  cart: 'Abre o carrinho e mostra a quantidade de itens.',
  account: 'Abre a área de conta do cliente.',
  notifications: 'Caixa de avisos nativa. Disponível quando o push estiver configurado.',
};

export function SecaoAbas({
  config,
  aoMudar,
  somenteLeitura,
  pushConfigurado,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
  /** Sem push, a aba de avisos não é oferecida: o app a esconderia. */
  pushConfigurado: boolean;
}) {
  const recursos = { push: pushConfigurado };
  const disponiveis = tiposDisponiveis(config, recursos);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        A barra cabe de {MIN_ABAS} a {MAX_ABAS} abas, na ordem em que aparecem aqui.
      </p>

      <ul className="space-y-3">
        {config.tabs.map((aba, indice) => (
          <li key={aba.id} className="rounded-xl border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
                <IconeDaAba nome={aba.icon} className="size-5" />
              </div>

              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`aba-${aba.id}-nome`}>Nome na barra</Label>
                  <Input
                    id={`aba-${aba.id}-nome`}
                    value={aba.label}
                    maxLength={12}
                    disabled={somenteLeitura}
                    onChange={(evento) => {
                      aoMudar(editarAba(config, aba.id, { label: evento.target.value }));
                    }}
                  />
                  <p className="text-muted-foreground text-xs">{aba.label.length}/12 caracteres</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`aba-${aba.id}-icone`}>Ícone</Label>
                  <Select
                    id={`aba-${aba.id}-icone`}
                    value={aba.icon}
                    disabled={somenteLeitura}
                    onChange={(evento) => {
                      aoMudar(editarAba(config, aba.id, { icon: evento.target.value }));
                    }}
                  >
                    {NOMES_DE_ICONE.map((nome) => (
                      <option key={nome} value={nome}>
                        {ROTULO_DO_ICONE[nome]}
                      </option>
                    ))}
                  </Select>
                </div>

                {aba.type === 'webview' ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`aba-${aba.id}-url`}>Endereço na loja</Label>
                    <Input
                      id={`aba-${aba.id}-url`}
                      value={aba.url ?? ''}
                      placeholder="/collections/novidades"
                      spellCheck={false}
                      disabled={somenteLeitura}
                      onChange={(evento) => {
                        aoMudar(editarAba(config, aba.id, { url: evento.target.value }));
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      Caminho dentro da sua loja, começando com “/”.
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground self-center text-xs sm:col-span-2">
                    {EXPLICACAO_DO_TIPO[aba.type]}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Mover ${aba.label} para cima`}
                  disabled={somenteLeitura || indice === 0}
                  onClick={() => {
                    aoMudar(moverAba(config, indice, indice - 1));
                  }}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Mover ${aba.label} para baixo`}
                  disabled={somenteLeitura || indice === config.tabs.length - 1}
                  onClick={() => {
                    aoMudar(moverAba(config, indice, indice + 1));
                  }}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remover ${aba.label}`}
                  disabled={somenteLeitura || !podeRemoverAba(config)}
                  onClick={() => {
                    aoMudar(removerAba(config, aba.id));
                  }}
                >
                  <Trash2 className="text-destructive size-4" aria-hidden />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {somenteLeitura ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {podeAdicionarAba(config, recursos) ? (
            disponiveis.map((tipo) => (
              <Button
                key={tipo}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  aoMudar(adicionarAba(config, tipo, recursos));
                }}
              >
                <Plus className="size-4" aria-hidden />
                {ROTULO_DO_TIPO[tipo]}
              </Button>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              {config.tabs.length >= MAX_ABAS
                ? `A barra já está com as ${String(MAX_ABAS)} abas que cabem.`
                : 'Todos os tipos de aba já estão na barra.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
