'use client';

/**
 * O seletor de período da tela C11 (e do detalhe de uma automação, C10).
 *
 * São links de verdade, e não botões com estado: o período vira `?periodo=` na
 * URL, então o lojista pode voltar, recarregar e mandar o link para o sócio
 * vendo a mesma coisa. Com estado no cliente, o botão de voltar do navegador
 * sairia da tela inteira em vez de desfazer a troca de período.
 */
import Link from 'next/link';
import { PERIODOS } from '@/lib/analytics';
import { cn } from '@/lib/utils';

export function SeletorDePeriodo({
  atual,
  base = '/analytics',
}: {
  atual: number;
  /** A tela onde o seletor está: o C11, ou o detalhe de uma automação (C10). */
  base?: string;
}) {
  return (
    <nav aria-label="Período" className="border-input inline-flex gap-1 rounded-lg border p-1">
      {PERIODOS.map((periodo) => {
        const ativo = periodo.dias === atual;
        return (
          <Link
            key={periodo.dias}
            href={`${base}?periodo=${String(periodo.dias)}`}
            aria-current={ativo ? 'page' : undefined}
            // `scroll={false}`: a troca de período recarrega os dados no
            // lugar, e pular para o topo faria a tela parecer outra.
            scroll={false}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              ativo
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {periodo.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
