'use client';

/**
 * "Ver como cliente" na ficha do cliente (A04).
 *
 * O diálogo existe para duas coisas que um botão direto não faria: pedir o
 * MOTIVO, que vai para a auditoria, e dizer antes o que a visita é — somente
 * leitura, por uma hora, registrada. Quem abre o painel de um cliente precisa
 * saber, no momento de abrir, que isso fica escrito.
 */
import { useActionState, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { iniciarVisita, type EstadoDaVisita } from './acoes';
import { MOTIVO_MAXIMO_DA_VISITA } from '@/lib/visita-nomes';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function VerComoCliente({ orgId, nome }: { orgId: string; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [estado, enviar, enviando] = useActionState<EstadoDaVisita, FormData>(
    async (anterior, dados) => {
      const resultado = await iniciarVisita(anterior, dados);
      // Navegação de verdade, do navegador: é ela que recebe o cookie da
      // visita (ver `iniciarVisita`). O botão segue girando até a troca.
      if (resultado.destino !== undefined) window.location.assign(resultado.destino);
      return resultado;
    },
    {},
  );

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Eye className="size-4" aria-hidden />
          Ver como cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ver o painel de {nome}</DialogTitle>
          <DialogDescription>
            Você vai ver o painel exatamente como o cliente vê, por até uma hora. É somente leitura:
            nada pode ser alterado. A visita e o motivo ficam registrados na auditoria.
          </DialogDescription>
        </DialogHeader>

        <form action={enviar} className="space-y-3" noValidate>
          <input type="hidden" name="orgId" value={orgId} />
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo</Label>
            <textarea
              id="motivo"
              name="motivo"
              rows={3}
              maxLength={MOTIVO_MAXIMO_DA_VISITA}
              defaultValue={estado.valores?.motivo}
              aria-invalid={estado.mensagem != null}
              aria-describedby={estado.mensagem == null ? 'motivo-dica' : 'motivo-erro'}
              placeholder="Ex.: cliente diz que o botão de publicar não aparece"
              className="border-input bg-background focus-visible:ring-ring aria-[invalid=true]:border-destructive w-full rounded-xl border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            />
            {estado.mensagem == null ? (
              <p id="motivo-dica" className="text-muted-foreground text-xs">
                Uma frase basta. Responde a pergunta que o cliente pode fazer depois: por que alguém
                da Storefy abriu o meu painel?
              </p>
            ) : (
              <p id="motivo-erro" role="alert" className="text-destructive text-xs font-medium">
                {estado.mensagem}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={enviando}
              onClick={() => {
                setAberto(false);
              }}
            >
              Voltar
            </Button>
            <Button type="submit" disabled={enviando || estado.destino !== undefined}>
              {enviando || estado.destino !== undefined ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              Abrir o painel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
