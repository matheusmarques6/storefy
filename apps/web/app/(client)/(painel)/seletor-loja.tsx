'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus, Store as IconeLoja } from 'lucide-react';
import { toast } from 'sonner';
import type { LojaVisivel } from '@storefy/db';
import { trocarLojaAtiva } from './acoes';
import { ErroParaATela, ehControleDeFluxoDoNext, mensagemDeErro } from '@/lib/erros';
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
export function SeletorLoja({
  lojas,
  lojaAtiva,
  emVisita = false,
}: {
  lojas: LojaVisivel[];
  lojaAtiva: LojaVisivel | null;
  /**
   * A equipe vendo o painel de um cliente. A troca vai pela rota da visita —
   * a ação de formulário de sempre o proxy recusa durante a visita — e criar
   * loja some, porque a visita não escreve.
   */
  emVisita?: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function selecionar(loja: LojaVisivel) {
    if (loja.id === lojaAtiva?.id) return;
    iniciar(async () => {
      try {
        if (emVisita) {
          const dados = new FormData();
          dados.set('lojaId', loja.id);
          const resposta = await fetch('/visita/loja', { method: 'POST', body: dados });
          if (!resposta.ok) throw new ErroParaATela('Não foi possível abrir esta loja.');
        } else {
          await trocarLojaAtiva(loja.id);
        }
        router.refresh();
      } catch (erro: unknown) {
        if (ehControleDeFluxoDoNext(erro)) return;
        toast.error(mensagemDeErro(erro, 'Não foi possível trocar de loja.'));
      }
    });
  }

  if (lojas.length === 0 && emVisita) {
    return <span className="text-muted-foreground text-sm">O cliente ainda não tem lojas</span>;
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
          className="max-w-full justify-between sm:max-w-[16rem]"
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
        <DropdownMenuLabel>{emVisita ? 'Lojas do cliente' : 'Suas lojas'}</DropdownMenuLabel>
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
        {emVisita ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/lojas/nova">
                <Plus className="size-4" aria-hidden />
                Criar nova loja
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
