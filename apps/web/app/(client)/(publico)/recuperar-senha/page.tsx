/** C01 — Recuperar senha. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioRecuperar } from './formulario';

export const metadata: Metadata = { title: 'Recuperar senha' };

export default function PaginaRecuperarSenha() {
  return (
    <div className="space-y-6">
      <FormularioRecuperar />
      <p className="text-muted-foreground text-center text-sm">
        Lembrou a senha?{' '}
        <Link href="/entrar" className="text-foreground font-medium underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </div>
  );
}
