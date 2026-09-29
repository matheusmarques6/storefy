'use client';

/**
 * O menu da conta, no canto do cabeçalho.
 *
 * O "SAIR" NÃO É UM FORMULÁRIO, e isso é a correção de um defeito que deixava
 * o lojista sem conseguir sair da conta. Ele era um `<form action={sair}>`
 * dentro do `DropdownMenuItem`: no clique, o Radix fecha o menu e DESMONTA o
 * formulário antes de o submit acontecer — a ação do servidor nunca era
 * chamada, e nada acontecia. Ninguém viu porque o e2e que cobre isso nunca
 * tinha rodado; na primeira vez que rodou, contra um Supabase de verdade,
 * parou exatamente aqui.
 *
 * Agora a ação é chamada direto no `onSelect`, e o menu fica aberto com
 * "Saindo…" até o redirect: sem esse retorno, a pessoa clicaria de novo
 * achando que o primeiro clique se perdeu.
 */
import { useTransition } from 'react';
import Link from 'next/link';
import {
  LifeBuoy,
  Loader2,
  LogOut,
  Settings,
  ShieldCheck,
  User as IconeUsuario,
} from 'lucide-react';
import { sair } from '../(publico)/acoes';
import { ID_DO_FORMULARIO_DE_ENCERRAR } from './faixa-da-visita';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function MenuUsuario({
  email,
  ehAdmin,
  emVisita = false,
}: {
  email: string;
  ehAdmin: boolean;
  /**
   * A equipe vendo o painel de um cliente. "Minha conta" some — a conta aqui
   * não é a do cliente —, e "Sair" vira "Encerrar visita": sair da sessão no
   * meio da visita deixaria o cookie dela para trás, e o proxy recusaria o
   * próprio "Sair", que é uma ação de formulário.
   */
  emVisita?: boolean;
}) {
  const [saindo, iniciar] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu da conta">
          <IconeUsuario aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate normal-case">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {emVisita ? null : (
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/conta">
              <IconeUsuario className="size-4" aria-hidden />
              Minha conta
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/configuracoes">
            <Settings className="size-4" aria-hidden />
            Configurações da empresa
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/ajuda">
            <LifeBuoy className="size-4" aria-hidden />
            Ajuda e suporte
          </Link>
        </DropdownMenuItem>
        {ehAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck className="size-4" aria-hidden />
                Painel Storefy
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {emVisita ? (
          <DropdownMenuItem
            onSelect={() => {
              // O formulário mora na faixa da visita, fora do menu — ver lá.
              const formulario = document.getElementById(ID_DO_FORMULARIO_DE_ENCERRAR);
              if (formulario instanceof HTMLFormElement) formulario.requestSubmit();
            }}
          >
            <LogOut className="size-4" aria-hidden />
            Encerrar visita
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={saindo}
            onSelect={(evento) => {
              // Mantém o menu aberto mostrando "Saindo…" até o redirect levar
              // a pessoa para o login.
              evento.preventDefault();
              iniciar(async () => {
                await sair();
              });
            }}
          >
            {saindo ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <LogOut className="size-4" aria-hidden />
            )}
            {saindo ? 'Saindo…' : 'Sair'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
