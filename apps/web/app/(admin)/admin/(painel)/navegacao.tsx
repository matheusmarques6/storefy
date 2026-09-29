'use client';

/**
 * A navegação do admin: barra lateral agrupada a partir de 1024px, menu abaixo.
 *
 * DOZE SEÇÕES NÃO CABEM EM UMA LINHA, e por um tempo tentaram caber: a Fase 6
 * foi somando Builds, Revisões, Contas, Push, Presets, Equipe e Sistema ao
 * cabeçalho, e a página passou a rolar para o lado. Barra lateral é o padrão
 * de painel interno com muitas seções — e AGRUPAR é o que a torna legível: doze
 * itens soltos obrigam a ler os doze; quatro grupos dizem onde procurar.
 *
 * Os grupos seguem a pergunta de quem abre o admin: o que está acontecendo
 * (visão geral), com quem (clientes), com os apps deles (apps) e com a própria
 * plataforma.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const GRUPOS = [
  {
    titulo: null,
    itens: [{ href: '/admin', rotulo: 'Visão geral' }],
  },
  {
    titulo: 'Clientes',
    itens: [
      { href: '/admin/organizacoes', rotulo: 'Organizações' },
      { href: '/admin/lojas', rotulo: 'Lojas' },
      { href: '/admin/chamados', rotulo: 'Chamados' },
    ],
  },
  {
    titulo: 'Apps',
    itens: [
      { href: '/admin/builds', rotulo: 'Builds' },
      { href: '/admin/revisoes', rotulo: 'Revisões' },
      { href: '/admin/contas', rotulo: 'Contas de desenvolvedor' },
      { href: '/admin/push', rotulo: 'Push' },
      { href: '/admin/presets', rotulo: 'Presets de tema' },
    ],
  },
  {
    titulo: 'Plataforma',
    itens: [
      { href: '/admin/equipe', rotulo: 'Equipe' },
      { href: '/admin/logs', rotulo: 'Auditoria' },
      { href: '/admin/ota', rotulo: 'Correção OTA' },
      { href: '/admin/sistema', rotulo: 'Sistema' },
    ],
  },
] as const;

function estaAtivo(href: string, caminho: string): boolean {
  // `/admin` é prefixo de todas as outras rotas: só acende no caminho exato.
  return href === '/admin'
    ? caminho === '/admin'
    : caminho === href || caminho.startsWith(`${href}/`);
}

/** Barra lateral, a partir de 1024px. */
export function NavegacaoAdmin() {
  const caminho = usePathname();

  return (
    <nav aria-label="Navegação do admin" className="space-y-5">
      {GRUPOS.map((grupo) => (
        <div key={grupo.titulo ?? 'inicio'}>
          {grupo.titulo == null ? null : (
            <p className="text-muted-foreground mb-1 px-3 text-xs font-medium tracking-wide uppercase">
              {grupo.titulo}
            </p>
          )}
          <ul className="space-y-0.5">
            {grupo.itens.map(({ href, rotulo }) => {
              const ativo = estaAtivo(href, caminho);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={ativo ? 'page' : undefined}
                    className={cn(
                      'block rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      ativo
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** O mesmo, como menu, abaixo de 1024px. */
export function NavegacaoAdminMovel() {
  const caminho = usePathname();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Abrir o menu do admin"
        >
          <Menu aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {GRUPOS.map((grupo, indice) => (
          <div key={grupo.titulo ?? 'inicio'}>
            {indice > 0 ? <DropdownMenuSeparator /> : null}
            {grupo.titulo == null ? null : <DropdownMenuLabel>{grupo.titulo}</DropdownMenuLabel>}
            {grupo.itens.map(({ href, rotulo }) => {
              const ativo = estaAtivo(href, caminho);
              return (
                <DropdownMenuItem key={href} asChild>
                  <Link
                    href={href}
                    aria-current={ativo ? 'page' : undefined}
                    className={cn(ativo && 'bg-accent font-medium')}
                  >
                    {rotulo}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
