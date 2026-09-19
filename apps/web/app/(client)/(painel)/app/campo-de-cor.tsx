'use client';

/**
 * Campo de cor: a amostra nativa e o hexadecimal lado a lado.
 *
 * Os dois juntos porque servem a momentos diferentes — o seletor do sistema
 * para quem está escolhendo no olho, o campo de texto para quem já tem o código
 * da marca anotado e só quer colar.
 */
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** O `<input type="color">` só aceita `#rrggbb`. */
function paraSeletor(valor: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(valor)) return valor;
  if (/^#[0-9a-fA-F]{8}$/.test(valor)) return valor.slice(0, 7);
  if (/^#[0-9a-fA-F]{3}$/.test(valor)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(valor) ?? [];
    return `#${String(r)}${String(r)}${String(g)}${String(g)}${String(b)}${String(b)}`;
  }
  return '#000000';
}

interface Props {
  id: string;
  rotulo: string;
  ajuda?: string;
  valor: string;
  aoMudar: (valor: string) => void;
  desabilitado?: boolean;
}

export function CampoDeCor({ id, rotulo, ajuda, valor, aoMudar, desabilitado }: Props) {
  const invalido = !HEX.test(valor);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Escolher ${rotulo.toLowerCase()}`}
          value={paraSeletor(valor)}
          disabled={desabilitado}
          onChange={(evento) => {
            aoMudar(evento.target.value);
          }}
          className="border-input size-10 shrink-0 cursor-pointer rounded-xl border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={valor}
          disabled={desabilitado}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalido}
          aria-describedby={
            invalido ? `${id}-erro` : ajuda === undefined ? undefined : `${id}-ajuda`
          }
          onChange={(evento) => {
            aoMudar(evento.target.value);
          }}
          className="font-mono"
        />
      </div>
      {invalido ? (
        <p id={`${id}-erro`} className="text-destructive text-xs">
          Use uma cor hexadecimal, como #1a1a1a.
        </p>
      ) : ajuda === undefined ? null : (
        <p id={`${id}-ajuda`} className="text-muted-foreground text-xs">
          {ajuda}
        </p>
      )}
    </div>
  );
}
