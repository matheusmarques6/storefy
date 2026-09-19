'use client';

/** Navegação entre campanhas e automações, comum às telas de push. */
import Link from 'next/link';
import { cn } from '@/lib/utils';

const ABAS = [
  { chave: 'campanhas', href: '/push', rotulo: 'Campanhas' },
  { chave: 'automacoes', href: '/push/automacoes', rotulo: 'Automações' },
] as const;

export function AbasDoPush({ atual }: { atual: 'campanhas' | 'automacoes' }) {
  return (
    <nav aria-label="Seções de notificações" className="border-b">
      <ul className="flex gap-1">
        {ABAS.map((aba) => (
          <li key={aba.chave}>
            <Link
              href={aba.href}
              aria-current={aba.chave === atual ? 'page' : undefined}
              className={cn(
                '-mb-px block border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                aba.chave === atual
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {aba.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
