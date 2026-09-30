/** A01 — Login admin. */
import type { Metadata } from 'next';
import { LogIn } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AVISO_DA_SESSAO_ENCERRADA, TEXTO_DA_SESSAO_ENCERRADA } from '@/lib/sessao-encerrada';
import { MolduraDaEntrada } from '../moldura-da-entrada';
import { FormularioLoginAdmin } from './formulario';

export const metadata: Metadata = { title: 'Entrar · Admin' };

export default async function PaginaEntrarAdmin({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { aviso } = await searchParams;

  return (
    <MolduraDaEntrada>
      <div className="space-y-6">
        {aviso === AVISO_DA_SESSAO_ENCERRADA ? (
          <Alert variant="info">
            <LogIn aria-hidden />
            <AlertDescription>{TEXTO_DA_SESSAO_ENCERRADA}</AlertDescription>
          </Alert>
        ) : null}
        <FormularioLoginAdmin />
      </div>
    </MolduraDaEntrada>
  );
}
