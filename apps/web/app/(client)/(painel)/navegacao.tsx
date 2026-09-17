'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Settings, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITENS = [
  { href: '/', rotulo: 'Início', icone: LayoutDashboard },
  { href: '/lojas', rotulo: 'Lojas', icone: Store },
  { href: '/configuracoes', rotulo: 'Configurações', icone: Settings },
] as const;

export function Navegacao() {
  const caminho = usePathname();

  return (
    <nav aria-label="Navegação principal" className="flex gap-1">
      {ITENS.map(({ href, rotulo, icone: Icone }) => {
        const ativo = href === '/' ? caminho === '/' : caminho.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              ativo
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            <Icone className="size-4" aria-hidden />
            <span className="hidden sm:inline">{rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
