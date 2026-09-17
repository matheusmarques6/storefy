'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus, Store as IconeLoja } from 'lucide-react';
import { toast } from 'sonner';
import type { Store } from '@storefy/db';
import { trocarLojaAtiva } from './acoes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Seletor de loja ativa. A loja escolhida define o contexto de todas as telas
 * (regra 2 das inegociáveis).
 */
export function SeletorLoja({ lojas, lojaAtiva }: { lojas: Store[]; lojaAtiva: Store | null }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function selecionar(loja: Store) {
    if (loja.id === lojaAtiva?.id) return;
    iniciar(() => {
      trocarLojaAtiva(loja.id)
        .then(() => {
          router.refresh();
        })
        .catch((erro: unknown) => {
          toast.error(erro instanceof Error ? erro.message : 'Não foi possível trocar de loja.');
        });
    });
  }

  if (lojas.length === 0) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href="/lojas/nova">
          <Plus aria-hidden />
          Criar primeira loja
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={pendente}
          className="max-w-[16rem] justify-between"
          aria-label="Trocar de loja"
        >
          <span className="flex min-w-0 items-center gap-2">
            <IconeLoja className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{lojaAtiva?.name ?? 'Selecione uma loja'}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Suas lojas</DropdownMenuLabel>
        {lojas.map((loja) => (
          <DropdownMenuItem
            key={loja.id}
            onSelect={() => {
              selecionar(loja);
            }}
            className="justify-between"
          >
            <span className="truncate">{loja.name}</span>
            {loja.id === lojaAtiva?.id ? <Check className="size-4 shrink-0" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/lojas/nova">
            <Plus className="size-4" aria-hidden />
            Criar nova loja
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
