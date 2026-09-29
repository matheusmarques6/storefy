'use client';

/**
 * Quem recebe a campanha (C08).
 *
 * Os públicos vêm das marcas que o app grava sozinho em cada aparelho — quem
 * comprou, quem tem carrinho, quando abriu o app —, ditas em palavras de
 * lojista. O prazo só aparece nos públicos que perguntam por ele.
 */
import { Info } from 'lucide-react';
import {
  DIAS_MAXIMOS,
  DIAS_MINIMOS,
  DIAS_SUGERIDOS,
  EXPLICACAO_DO_PUBLICO,
  ROTULO_DO_PUBLICO,
  TIPOS_DE_PUBLICO,
  type TipoDePublico,
} from '@/lib/publico-do-push';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export interface PublicoNoFormulario {
  tipo: TipoDePublico;
  /** O texto do campo de dias, como a pessoa digitou. */
  dias: string;
}

export function CampoDoPublico({
  valor,
  aoMudar,
  erro,
}: {
  valor: PublicoNoFormulario;
  aoMudar: (valor: PublicoNoFormulario) => void;
  erro?: string | undefined;
}) {
  const comPrazo = valor.tipo === 'inativos' || valor.tipo === 'ativos';
  const descritores = ['explicacao-publico', erro === undefined ? null : 'erro-publico']
    .filter((id) => id !== null)
    .join(' ');

  return (
    <div className="space-y-2">
      <Label htmlFor="publico">Quem recebe</Label>
      <Select
        id="publico"
        value={valor.tipo}
        aria-describedby={descritores}
        onChange={(evento) => {
          const tipo = evento.target.value as TipoDePublico;
          // O prazo sugerido já vem preenchido: um campo vazio ao lado de "há
          // quantos dias" parece uma pergunta sem resposta certa.
          const dias =
            (tipo === 'inativos' || tipo === 'ativos') && valor.dias.trim() === ''
              ? String(DIAS_SUGERIDOS[tipo])
              : valor.dias;
          aoMudar({ tipo, dias });
        }}
      >
        {TIPOS_DE_PUBLICO.map((tipo) => (
          <option key={tipo} value={tipo}>
            {ROTULO_DO_PUBLICO[tipo]}
          </option>
        ))}
      </Select>

      {comPrazo ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Label htmlFor="publico-dias" className="font-normal">
            {valor.tipo === 'inativos' ? 'Sem abrir o app há' : 'Abriram o app nos últimos'}
          </Label>
          <Input
            id="publico-dias"
            inputMode="numeric"
            value={valor.dias}
            onChange={(evento) => {
              aoMudar({ tipo: valor.tipo, dias: evento.target.value });
            }}
            aria-invalid={erro !== undefined}
            aria-describedby={erro === undefined ? undefined : 'erro-publico'}
            className="w-20"
            maxLength={3}
          />
          <span>dias</span>
          <span className="text-muted-foreground text-xs">
            (de {DIAS_MINIMOS} a {DIAS_MAXIMOS})
          </span>
        </div>
      ) : null}

      <p id="explicacao-publico" className="text-muted-foreground text-xs">
        {EXPLICACAO_DO_PUBLICO[valor.tipo]}
      </p>
      {erro === undefined ? null : (
        <p id="erro-publico" className="text-destructive text-sm">
          {erro}
        </p>
      )}

      {valor.tipo === 'todos' ? null : (
        <p className="text-muted-foreground flex items-start gap-2 rounded-lg border p-3 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Com um público escolhido, a campanha não entra na caixa de avisos do app, que é a mesma
            para todos os clientes: ela chega só como notificação, para quem se encaixa.
          </span>
        </p>
      )}
    </div>
  );
}
