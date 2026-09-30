'use client';

/**
 * "Já paguei, conferir" (C15): as faturas conferidas direto na Asaas, para
 * quem pagou e não quer esperar o aviso dela — ou cujo aviso não chegou.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { conferirPagamento } from './acoes';
import { Button } from '@/components/ui/button';

export function ConferirPagamento() {
  const router = useRouter();
  const [conferindo, iniciar] = useTransition();

  function conferir() {
    iniciar(async () => {
      let resultado: Awaited<ReturnType<typeof conferirPagamento>>;
      try {
        resultado = await conferirPagamento();
      } catch {
        toast.error('Não conseguimos falar com o servidor. Tente de novo.');
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem);
        return;
      }
      // Pago: sucesso. Ainda em aberto: é informação, e não erro de ninguém.
      if (resultado.pago === true) toast.success(resultado.mensagem);
      else toast(resultado.mensagem);
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" disabled={conferindo} onClick={conferir}>
      {conferindo ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {conferindo ? 'Conferindo…' : 'Já paguei, conferir'}
    </Button>
  );
}
