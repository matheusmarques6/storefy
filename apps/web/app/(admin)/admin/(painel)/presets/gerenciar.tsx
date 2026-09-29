'use client';

/**
 * Criar e administrar os presets (A10).
 *
 * O formulário pede UMA LOJA, e não um editor de abas: o preset é copiado de
 * uma configuração publicada que já foi conferida numa tela de celular de
 * verdade. É o que separa um preset de um palpite.
 */
import { useActionState, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { alternarPreset, apagarPreset, criarPresetDaLoja, type EstadoDoPreset } from './acoes';
import { valoresDigitados, type ValoresDigitados } from '@/lib/validacao';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface LojaPublicada {
  appId: string;
  rotulo: string;
  /** O tema da Shopify lido da página da loja (A10), quando se sabe. */
  tema: string | null;
}

export function CriarPreset({ lojas }: { lojas: LojaPublicada[] }) {
  const router = useRouter();
  const campoDoTema = useRef<HTMLInputElement>(null);
  // A loja escolhida antes da troca: o tema dela diz se o campo foi preenchido por nós.
  const anteriorRef = useRef<string | undefined>(lojas[0]?.appId);
  const temaDe = (appId: string | undefined): string | undefined =>
    lojas.find((loja) => loja.appId === appId)?.tema ?? undefined;

  const [estado, enviar, enviando] = useActionState<
    EstadoDoPreset & { valores?: ValoresDigitados },
    FormData
  >(async (anterior, dados) => {
    const resultado = await criarPresetDaLoja(anterior, dados);

    if (resultado.ok === true) {
      toast.success(resultado.mensagem ?? 'Preset criado.');
      router.refresh();
      return { ...resultado, valores: {} };
    }
    if (resultado.mensagem != null) toast.error(resultado.mensagem);
    // Recusado, o que foi escrito continua no formulário para corrigir.
    return {
      ...resultado,
      valores: valoresDigitados(dados, ['appId', 'nome', 'tema', 'descricao']),
    };
  }, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Criar preset a partir de uma loja</CardTitle>
        <CardDescription>
          Copia as abas, os elementos escondidos e o CSS da configuração publicada dessa loja. A
          identidade dela — nome, cores, ícone — não vai junto.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {lojas.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhuma loja publicou configuração ainda. O primeiro preset nasce da primeira loja no
            ar.
          </p>
        ) : (
          <form action={enviar} className="space-y-4" noValidate>
            <Campo
              id="appId"
              rotulo="Copiar de"
              dica="Só aparecem as lojas com configuração publicada."
            >
              {/* `key`: ver o seletor de papel da A11 — `<select>` só lê o
                  `defaultValue` ao montar. */}
              <select
                key={estado.valores?.appId ?? 'inicial'}
                {...propsDoCampo('appId', undefined, true)}
                defaultValue={estado.valores?.appId}
                onChange={(evento) => {
                  /*
                   * O tema da loja escolhida entra no campo — a não ser que a
                   * equipe já tenha escrito outro: aí o que ela escreveu fica.
                   */
                  const campo = campoDoTema.current;
                  if (campo === null) return;
                  const anterior = temaDe(anteriorRef.current);
                  anteriorRef.current = evento.target.value;
                  if (campo.value.trim() === '' || campo.value === anterior) {
                    campo.value = temaDe(evento.target.value) ?? '';
                  }
                }}
                className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {lojas.map((loja) => (
                  <option key={loja.appId} value={loja.appId}>
                    {loja.rotulo}
                  </option>
                ))}
              </select>
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="nome" rotulo="Nome" dica="É o que o lojista vê na lista.">
                <Input
                  {...propsDoCampo('nome', undefined, true)}
                  defaultValue={estado.valores?.nome}
                  placeholder="Dawn — padrão"
                  autoComplete="off"
                />
              </Campo>

              <Campo id="tema" rotulo="Tema da Shopify" dica="Dawn, Impulse, Prestige…">
                <Input
                  ref={campoDoTema}
                  {...propsDoCampo('tema', undefined, true)}
                  defaultValue={
                    estado.valores?.tema ?? temaDe(estado.valores?.appId ?? lojas[0]?.appId)
                  }
                  placeholder="Dawn"
                  autoComplete="off"
                />
              </Campo>
            </div>

            <Campo
              id="descricao"
              rotulo="Descrição (opcional)"
              dica="Uma linha dizendo para quem serve."
            >
              <Input
                {...propsDoCampo('descricao', undefined, true)}
                defaultValue={estado.valores?.descricao}
                placeholder="Esconde cabeçalho e rodapé do tema Dawn."
                autoComplete="off"
              />
            </Campo>

            {estado.ok !== true && estado.mensagem != null ? (
              <p className="text-destructive text-sm" role="alert">
                {estado.mensagem}
              </p>
            ) : null}

            <Button type="submit" disabled={enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Criar preset
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function AcoesDoPreset({ id, nome, ativo }: { id: string; nome: string; ativo: boolean }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, iniciar] = useTransition();

  function rodar(acao: () => Promise<EstadoDoPreset>) {
    iniciar(async () => {
      const resultado = await acao();
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Pronto.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível.');
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={ocupado}
        onClick={() => {
          rodar(async () => alternarPreset(id, !ativo));
        }}
      >
        <Power className="size-3.5" aria-hidden />
        {ativo ? 'Desligar' : 'Ligar'}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={ocupado}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        {ocupado ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-3.5" aria-hidden />
        )}
        Apagar
      </Button>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o preset “{nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem já aplicou continua como está — o preset não fica amarrado à loja depois de
              aplicado. Se a intenção é só tirar da lista, desligar basta e é reversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ocupado}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                rodar(async () => apagarPreset(id));
              }}
              disabled={ocupado}
            >
              {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
