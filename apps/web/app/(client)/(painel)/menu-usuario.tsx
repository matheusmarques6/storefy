'use client';

import { LogOut, Settings, ShieldCheck, User as IconeUsuario } from 'lucide-react';
import { sair } from '../(publico)/acoes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function MenuUsuario({ email, ehAdmin }: { email: string; ehAdmin: boolean }) {
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
        <DropdownMenuItem asChild>
          <a href="/configuracoes/conta">
            <IconeUsuario className="size-4" aria-hidden />
            Minha conta
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/configuracoes">
            <Settings className="size-4" aria-hidden />
            Configurações da empresa
          </a>
        </DropdownMenuItem>
        {ehAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/admin">
                <ShieldCheck className="size-4" aria-hidden />
                Painel Storefy
              </a>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={sair}>
            <button type="submit" className="flex w-full items-center gap-2 text-left">
              <LogOut className="size-4" aria-hidden />
              Sair
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
