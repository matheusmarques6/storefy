'use client';

/** A07 — o botão que confere de novo a credencial de um cliente. */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { revalidarConta } from './acoes';

export function RevalidarConta({ contaId, rotulo }: { contaId: string; rotulo: string }) {
  const router = useRouter();
  const [conferindo, iniciar] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={conferindo}
      aria-label={`Revalidar a conta ${rotulo}`}
      onClick={() => {
        iniciar(async () => {
          let resultado: Awaited<ReturnType<typeof revalidarConta>>;
          try {
            resultado = await revalidarConta(contaId);
          } catch {
            toast.error('Não conseguimos revalidar agora. Confira a conexão e tente de novo.');
            return;
          }
          if (resultado.ok === true && resultado.valida === true) {
            toast.success(resultado.mensagem ?? 'A credencial continua valendo.');
          } else if (resultado.ok === true) {
            toast.warning(resultado.mensagem ?? 'A credencial não vale mais.');
          } else {
            toast.error(resultado.mensagem ?? 'Não foi possível revalidar.');
          }
          router.refresh();
        });
      }}
    >
      {conferindo ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {conferindo ? 'Conferindo…' : 'Revalidar'}
    </Button>
  );
}
