'use client';

/**
 * Leva ao editor (C06) DESTA loja. O editor abre a loja ativa do painel: se
 * for outra, troca antes — sem isto, "Abrir o editor" publicaria o app da
 * loja errada.
 */
import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { trocarLojaAtiva } from '../../acoes';

export function AbrirEditorDaLoja({
  lojaId,
  ativa,
}: {
  lojaId: string;
  /** A loja já é a ativa no painel: o editor dela está a um link. */
  ativa: boolean;
}) {
  const router = useRouter();
  const [abrindo, iniciar] = useTransition();

  if (ativa) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/app">Abrir o editor</Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={abrindo}
      onClick={() => {
        iniciar(async () => {
          try {
            await trocarLojaAtiva(lojaId);
          } catch {
            toast.error(
              'Não foi possível abrir o editor desta loja. Escolha a loja no seletor do topo e abra o editor.',
            );
            return;
          }
          router.push('/app');
        });
      }}
    >
      {abrindo ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      Abrir o editor
    </Button>
  );
}
