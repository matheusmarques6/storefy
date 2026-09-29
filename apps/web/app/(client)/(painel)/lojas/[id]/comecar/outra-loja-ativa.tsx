'use client';

/**
 * Aviso para quando o começo de uma loja é aberto com OUTRA loja ativa no
 * painel — pelo histórico do navegador, por exemplo. Os atalhos do checklist
 * (editor, integrações, publicação) valem para a loja ativa; sem este aviso,
 * "Publicar no editor" abriria o app da loja errada.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { trocarLojaAtiva } from '../../../acoes';

export function OutraLojaAtiva({ lojaId, nome }: { lojaId: string; nome: string }) {
  const router = useRouter();
  const [trocando, iniciar] = useTransition();

  function trocar() {
    iniciar(async () => {
      try {
        await trocarLojaAtiva(lojaId);
      } catch {
        toast.error('Não foi possível trocar de loja. Tente pelo seletor no topo da tela.');
        return;
      }
      toast.success(`Agora o painel mostra ${nome}.`);
      router.refresh();
    });
  }

  return (
    <Alert role="status">
      <ArrowLeftRight aria-hidden />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          O painel está mostrando outra loja. Os atalhos abaixo abrem a loja ativa, e não {nome}.
        </span>
        <Button type="button" size="sm" variant="outline" disabled={trocando} onClick={trocar}>
          {trocando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Usar {nome} no painel
        </Button>
      </AlertDescription>
    </Alert>
  );
}
