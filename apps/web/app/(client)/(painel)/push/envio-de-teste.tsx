'use client';

/**
 * O envio de teste (parte da C08).
 *
 * Uma campanha de push não tem desfazer. Esta é a última conferência possível:
 * o lojista manda a notificação para o PRÓPRIO celular e vê o texto cortado, o
 * link que abre no lugar errado e o emoji que não renderiza — nada disso
 * aparece num campo de formulário.
 *
 * Sem aparelho na lista, a caixa explica o que fazer em vez de mostrar um
 * seletor vazio: o lojista precisa instalar o próprio app e abri-lo uma vez.
 */
import { useState, useTransition } from 'react';
import { Loader2, Send, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { enviarTeste } from './acoes';

interface Props {
  aparelhos: readonly AparelhoParaTeste[];
  valores: { title: string; body: string; deepLink: string };
}

export function EnvioDeTeste({ aparelhos, valores }: Props) {
  const primeiro = aparelhos[0];
  const [escolhido, setEscolhido] = useState(primeiro?.id ?? '');
  const [enviando, iniciar] = useTransition();

  if (primeiro === undefined) {
    return (
      <div className="text-muted-foreground space-y-2 rounded-xl border border-dashed p-4 text-sm">
        <div className="text-foreground flex items-center gap-2 font-medium">
          <Smartphone className="size-4" aria-hidden />
          Envio de teste
        </div>
        <p>
          Nenhum aparelho com o app ainda. Instale o app da sua loja no seu celular e abra uma vez —
          ele aparece aqui e você poderá mandar a notificação só para você, antes de enviar para
          todo mundo.
        </p>
      </div>
    );
  }

  function enviar() {
    iniciar(async () => {
      const resultado = await enviarTeste({ ...valores, deviceId: escolhido });

      if (resultado.problemas !== undefined && resultado.problemas.length > 0) {
        toast.error('Escreva o título e a mensagem antes de testar.');
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível enviar o teste.');
        return;
      }
      toast.success(resultado.mensagem ?? 'Teste enviado.');
    });
  }

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Smartphone className="size-4" aria-hidden />
        Envio de teste
      </div>
      <p className="text-muted-foreground text-sm">
        Mande só para um aparelho antes de enviar para todo mundo. Não conta como campanha.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="aparelho-de-teste">Aparelho</Label>
          <select
            id="aparelho-de-teste"
            value={escolhido}
            onChange={(evento) => {
              setEscolhido(evento.target.value);
            }}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {aparelhos.map((aparelho) => (
              <option key={aparelho.id} value={aparelho.id}>
                {descrever(aparelho)}
              </option>
            ))}
          </select>
        </div>

        <Button type="button" variant="outline" disabled={enviando} onClick={enviar}>
          {enviando ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          Enviar teste
        </Button>
      </div>
    </div>
  );
}

/** "iPhone · versão 1.2.0 · visto há 2 min" — o suficiente para se reconhecer. */
function descrever(aparelho: AparelhoParaTeste): string {
  const sistema = aparelho.platform === 'ios' ? 'iPhone' : 'Android';
  const versao = aparelho.appVersion === null ? null : `versão ${aparelho.appVersion}`;
  return [sistema, versao, `visto ${quando(aparelho.lastSeenAt)}`]
    .filter((parte) => parte !== null)
    .join(' · ');
}

function quando(iso: string): string {
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return 'em algum momento';

  const minutos = Math.floor((Date.now() - instante) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${String(minutos)} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${String(horas)} h`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `há ${String(dias)} dias`;
}
