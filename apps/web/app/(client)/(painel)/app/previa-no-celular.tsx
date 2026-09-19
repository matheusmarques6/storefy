'use client';

/**
 * Ver o rascunho num aparelho antes de publicar (app Storefy Preview).
 *
 * O QR carrega um deep link do app de prévia, e o código também aparece em
 * texto: câmera de celular antigo às vezes não lê QR, e digitar 32 caracteres é
 * chato mas funciona sempre.
 *
 * O código vale meia hora e aparece uma vez só. Recarregar não traz o mesmo
 * de volta: ele dá acesso ao rascunho sem login, e guardá-lo na tela para
 * sempre seria deixar a porta encostada.
 */
import { useState, useTransition } from 'react';
import { QrCode, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { abrirPrevia, type EstadoDaPrevia } from './acoes';
import { Button } from '@/components/ui/button';

export function PreviaNoCelular({
  storeId,
  somenteLeitura,
}: {
  storeId: string;
  somenteLeitura: boolean;
}) {
  const [previa, setPrevia] = useState<EstadoDaPrevia | null>(null);
  const [abrindo, iniciar] = useTransition();

  function abrir() {
    iniciar(() => {
      void abrirPrevia(storeId).then((estado) => {
        if (estado.ok === true) setPrevia(estado);
        else {
          setPrevia(null);
          toast.error(estado.mensagem ?? 'Não foi possível abrir a prévia.');
        }
      });
    });
  }

  if (somenteLeitura) return null;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-medium">Ver no seu celular</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Abra o app Storefy Preview e aponte a câmera para o código. Você vê o rascunho como ele
          vai ficar, sem publicar nada.
        </p>
      </div>

      {previa?.codigo == null ? (
        <Button type="button" variant="outline" disabled={abrindo} onClick={abrir}>
          <QrCode className="size-4" aria-hidden />
          {abrindo ? 'Gerando…' : 'Gerar código'}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {previa.qr == null || previa.qr === '' ? null : (
            <div
              // O SVG é gerado no nosso servidor a partir de um código
              // hexadecimal; não há conteúdo de terceiro aqui.
              dangerouslySetInnerHTML={{ __html: previa.qr }}
              aria-label="Código QR da prévia"
              role="img"
              className="size-40 shrink-0 [&>svg]:size-full"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-muted-foreground text-xs">Ou digite este código no app:</p>
            <p className="bg-muted rounded-lg px-3 py-2 font-mono text-xs break-all">
              {previa.codigo}
            </p>
            <p className="text-muted-foreground text-xs">
              {previa.expiraEm == null
                ? 'Vale por 30 minutos.'
                : `Vale até ${new Date(previa.expiraEm).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}.`}
            </p>
            <Button type="button" variant="ghost" size="sm" disabled={abrindo} onClick={abrir}>
              <RefreshCw className="size-4" aria-hidden />
              Gerar outro
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
