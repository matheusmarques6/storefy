'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITENS = [
  { href: '/admin', rotulo: 'Organizações' },
  { href: '/admin/lojas', rotulo: 'Lojas' },
  { href: '/admin/logs', rotulo: 'Auditoria' },
] as const;

export function NavegacaoAdmin() {
  const caminho = usePathname();

  return (
    <nav aria-label="Navegação do admin" className="flex gap-1">
      {ITENS.map(({ href, rotulo }) => {
        const ativo =
          href === '/admin'
            ? caminho === '/admin' || caminho.startsWith('/admin/organizacoes')
            : caminho.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={ativo ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              ativo
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
