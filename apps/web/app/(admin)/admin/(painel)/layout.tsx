/**
 * Moldura do painel admin.
 *
 * `exigirPlatformAdmin()` roda a cada request: sem registro em
 * `platform_admins`, o usuário vai para /admin/sem-acesso. É a guarda exigida
 * no escopo da Fase 0.
 */
import Link from 'next/link';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { NavegacaoAdmin } from './navegacao';
import { sair } from '../../../(client)/(publico)/acoes';
import { Button } from '@/components/ui/button';

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await exigirPlatformAdmin();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            Storefy <span className="text-muted-foreground">admin</span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <NavegacaoAdmin />
            <span className="text-muted-foreground hidden text-xs sm:inline">{usuario.email}</span>
            <form action={sair}>
              <Button type="submit" variant="ghost" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
