'use client';

/**
 * A navegação do painel do cliente, em duas formas.
 *
 * ELA JÁ COUBE EM UMA LINHA SÓ, e deixou de caber sem ninguém perceber. Com
 * três seções, logo + seletor de loja + seções + conta cabiam em 1152px; as
 * fases seguintes foram somando Notificações, Analytics, Publicação e
 * Integrações, e a página passou a rolar para o lado em qualquer tela abaixo
 * de 1440px. No celular, seis das oito seções — e o menu da conta, onde fica o
 * "Sair" — ficavam fora da tela. Quem mediu foi o e2e, fotografando em cinco
 * larguras.
 *
 * AS DUAS FORMAS, E A CONTA POR TRÁS DELAS. As oito seções com rótulo somam
 * uns 895px. A partir de `lg` (1024px, com 992px de conteúdo) elas cabem numa
 * segunda linha do cabeçalho; abaixo disso, viram um menu. Nenhuma das duas
 * rola a página para o lado — e a linha das seções ainda tem `overflow-x-auto`
 * como rede: se um dia entrar uma nona seção, ela rola DENTRO de si, e não a
 * tela inteira.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  LayoutDashboard,
  Menu,
  Plug,
  Rocket,
  Settings,
  Smartphone,
  Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ITENS = [
  { href: '/', rotulo: 'Início', icone: LayoutDashboard },
  { href: '/lojas', rotulo: 'Lojas', icone: Store },
  { href: '/app', rotulo: 'App', icone: Smartphone },
  { href: '/push', rotulo: 'Notificações', icone: Bell },
  { href: '/analytics', rotulo: 'Analytics', icone: BarChart3 },
  { href: '/publicacao', rotulo: 'Publicação', icone: Rocket },
  { href: '/integracoes', rotulo: 'Integrações', icone: Plug },
  { href: '/configuracoes', rotulo: 'Configurações', icone: Settings },
] as const;

function estaAtivo(href: string, caminho: string): boolean {
  // `/` é prefixo de tudo: só acende no caminho exato.
  return href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(`${href}/`);
}

/** A linha das seções, a partir de 1024px. */
export function NavegacaoAbas() {
  const caminho = usePathname();

  return (
    <nav aria-label="Navegação principal" className="hidden overflow-x-auto lg:block">
      <ul className="mx-auto flex max-w-6xl gap-1 px-4">
        {ITENS.map(({ href, rotulo, icone: Icone }) => {
          const ativo = estaAtivo(href, caminho);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  // A borda de baixo marca a seção atual, como uma aba.
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  ativo
                    ? 'border-foreground text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                <Icone className="size-4" aria-hidden />
                {rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** O menu das seções, abaixo de 1024px. */
export function NavegacaoMovel() {
  const caminho = usePathname();
  const atual = ITENS.find(({ href }) => estaAtivo(href, caminho));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Abrir o menu de seções"
        >
          <Menu aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {ITENS.map(({ href, rotulo, icone: Icone }) => {
          const ativo = atual?.href === href;
          return (
            <DropdownMenuItem key={href} asChild>
              <Link
                href={href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(ativo && 'bg-accent font-medium')}
              >
                <Icone className="size-4" aria-hidden />
                {rotulo}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
