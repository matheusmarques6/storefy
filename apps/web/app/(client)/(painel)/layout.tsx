/** Moldura do painel do cliente: cabeçalho, seletor de loja e navegação. */
import Link from 'next/link';
import { ehPlatformAdmin, exigirContextoCliente } from '@/lib/contexto';
import { MenuUsuario } from './menu-usuario';
import { Navegacao } from './navegacao';
import { SeletorLoja } from './seletor-loja';

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const contexto = await exigirContextoCliente();
  const admin = await ehPlatformAdmin(contexto.usuario.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Storefy
          </Link>
          <div className="bg-border hidden h-6 w-px sm:block" />
          <SeletorLoja lojas={contexto.lojas} lojaAtiva={contexto.lojaAtiva} />
          <div className="ml-auto flex items-center gap-2">
            <Navegacao />
            <MenuUsuario email={contexto.usuario.email ?? ''} ehAdmin={admin} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t py-6">
        <p className="text-muted-foreground mx-auto max-w-6xl px-4 text-xs">
          Storefy by Convertfy · {contexto.organizacao.name}
        </p>
      </footer>
    </div>
  );
}
