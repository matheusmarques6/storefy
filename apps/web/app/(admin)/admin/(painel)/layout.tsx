/**
 * Moldura do painel admin.
 *
 * `exigirPlatformAdmin()` roda a cada request: sem registro em
 * `platform_admins`, o usuário vai para /admin/sem-acesso; sem o segundo fator
 * nesta sessão, para /admin/verificar (ou /admin/ativar-2fa, quem ainda não
 * cadastrou o app). É a guarda exigida no escopo da Fase 0, com a A01.
 */
import Link from 'next/link';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { NavegacaoAdmin, NavegacaoAdminMovel } from './navegacao';
import { VisitaAberta } from './visita-aberta';
import { sairDoAdmin } from '../acoes';
import { Button } from '@/components/ui/button';

export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const usuario = await exigirPlatformAdmin();

  return (
    <div className="flex min-h-dvh flex-col">
      <VisitaAberta adminId={usuario.id} />
      <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4 sm:gap-4">
          <NavegacaoAdminMovel />
          <Link href="/admin" className="shrink-0 text-lg font-semibold tracking-tight">
            Storefy <span className="text-muted-foreground">admin</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {/* O e-mail trunca em vez de empurrar o "Sair" para fora da tela. */}
            <span className="text-muted-foreground hidden truncate text-xs sm:inline">
              {usuario.email}
            </span>
            {/* Sai para o login do admin: é por ali que a equipe volta. */}
            <form action={sairDoAdmin}>
              <Button type="submit" variant="ghost" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r px-3 py-6 lg:block">
          {/* Presa ao rolar: a lista de seções é o mapa, e o mapa não pode
              sumir quando a tabela é comprida. */}
          <div className="sticky top-20">
            <NavegacaoAdmin />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
