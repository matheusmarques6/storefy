/** A01 — Login admin. */
import type { Metadata } from 'next';
import { FormularioLoginAdmin } from './formulario';

export const metadata: Metadata = { title: 'Entrar · Admin' };

export default function PaginaEntrarAdmin() {
  return (
    <div className="bg-muted/30 flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-tight">Storefy</p>
          <p className="text-muted-foreground mt-1 text-sm">Administração da plataforma</p>
        </div>
        <FormularioLoginAdmin />
      </div>
    </div>
  );
}
