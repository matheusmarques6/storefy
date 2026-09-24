'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITENS = [
  { href: '/admin', rotulo: 'Visão geral' },
  { href: '/admin/organizacoes', rotulo: 'Organizações' },
  { href: '/admin/lojas', rotulo: 'Lojas' },
  { href: '/admin/builds', rotulo: 'Builds' },
  { href: '/admin/revisoes', rotulo: 'Revisões' },
  { href: '/admin/contas', rotulo: 'Contas' },
  { href: '/admin/push', rotulo: 'Push' },
  { href: '/admin/equipe', rotulo: 'Equipe' },
  { href: '/admin/logs', rotulo: 'Auditoria' },
  { href: '/admin/ota', rotulo: 'Correção OTA' },
] as const;

export function NavegacaoAdmin() {
  const caminho = usePathname();

  return (
    <nav aria-label="Navegação do admin" className="flex gap-1">
      {ITENS.map(({ href, rotulo }) => {
        // `/admin` é prefixo de todas as outras rotas, então só acende no
        // caminho exato; as demais acendem também nas suas subrotas.
        const ativo = href === '/admin' ? caminho === '/admin' : caminho.startsWith(href);
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
