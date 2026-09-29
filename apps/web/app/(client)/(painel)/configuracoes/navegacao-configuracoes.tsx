/**
 * As três partes das configurações (C16): a empresa, a equipe e a conta de
 * quem está usando. Antes eram só um link solto no texto da primeira tela, e
 * a equipe nem existia.
 */
import Link from 'next/link';
import { cn } from '@/lib/utils';

const PARTES = [
  { chave: 'empresa', href: '/configuracoes', rotulo: 'Empresa' },
  { chave: 'equipe', href: '/configuracoes/equipe', rotulo: 'Equipe' },
  { chave: 'conta', href: '/configuracoes/conta', rotulo: 'Minha conta' },
] as const;

export type ParteDasConfiguracoes = (typeof PARTES)[number]['chave'];

export function NavegacaoConfiguracoes({ atual }: { atual: ParteDasConfiguracoes }) {
  return (
    <nav aria-label="Partes das configurações" className="flex flex-wrap gap-1 border-b pb-3">
      {PARTES.map((parte) => (
        <Link
          key={parte.chave}
          href={parte.href}
          aria-current={parte.chave === atual ? 'page' : undefined}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            parte.chave === atual
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60',
          )}
        >
          {parte.rotulo}
        </Link>
      ))}
    </nav>
  );
}
