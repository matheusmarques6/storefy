'use client';

/** "Conferir na Asaas" (A04): as faturas do cliente lidas direto na Asaas. */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { conferirCobrancaNaAsaas } from './acoes';
import { Button } from '@/components/ui/button';

export function ConferirNaAsaas({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [conferindo, iniciar] = useTransition();

  function conferir() {
    iniciar(async () => {
      let resultado: Awaited<ReturnType<typeof conferirCobrancaNaAsaas>>;
      try {
        resultado = await conferirCobrancaNaAsaas(orgId);
      } catch {
        toast.error('Não conseguimos falar com o servidor. Tente de novo.');
        return;
      }
      if (resultado.ok === true) {
        toast.success(resultado.mensagem);
        router.refresh();
      } else {
        toast.error(resultado.mensagem);
      }
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={conferindo} onClick={conferir}>
      {conferindo ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {conferindo ? 'Conferindo…' : 'Conferir na Asaas'}
    </Button>
  );
}
