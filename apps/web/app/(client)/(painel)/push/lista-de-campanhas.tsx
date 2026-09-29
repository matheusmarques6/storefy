'use client';

/** A lista de campanhas (C07), com as ações que cada status permite. */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPLICACAO_DO_STATUS,
  ROTULO_DO_STATUS,
  lerMetricas,
  numeroOuTraco,
  podeCancelar,
  podeEditar,
  podeExcluir,
  porcentagemOuTraco,
  type StatusDaCampanha,
} from '@/lib/campanha';
import type { CampanhaNaLista } from '@/lib/push-servidor';
import { formatarDataHora } from '@/lib/fuso';
import { descricaoDoPublico } from '@/lib/publico-do-push';
import { receitaDaCampanha, textoDosPedidos, type Vendas } from '@/lib/vendas-do-push';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EstadoVazio } from '@/components/estado-vazio';
import { cancelarCampanha, excluirCampanha } from './acoes';

const COR_DO_STATUS: Record<StatusDaCampanha, 'default' | 'secondary' | 'destructive' | 'outline'> =
  {
    draft: 'outline',
    scheduled: 'secondary',
    sending: 'secondary',
    sent: 'default',
    failed: 'destructive',
    canceled: 'outline',
  };

type Confirmacao = { tipo: 'cancelar' | 'excluir'; campanha: CampanhaNaLista } | null;

export function ListaDeCampanhas({
  campanhas,
  vendas,
  vendasVisiveis,
  podeEscrever,
  fuso,
}: {
  campanhas: readonly CampanhaNaLista[];
  /** Pedidos e receita de cada campanha enviada, pelo id. */
  vendas: Readonly<Record<string, Vendas>>;
  /** A loja manda os pedidos (Shopify conectada)? Sem isso, receita é traço. */
  vendasVisiveis: boolean;
  podeEscrever: boolean;
  /**
   * O fuso da loja. Este componente é renderizado no servidor e hidratado no
   * navegador: sem um fuso explícito, o servidor escrevia a hora em UTC, o
   * navegador reescrevia no fuso local, e o texto mudava na frente do lojista.
   */
  fuso: string;
}) {
  const router = useRouter();
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);
  const [enviando, iniciar] = useTransition();

  if (campanhas.length === 0) {
    return (
      <EstadoVazio
        icone={BellRing}
        titulo="Nenhuma campanha ainda"
        descricao="Crie a primeira e avise seus clientes sobre uma promoção, um lançamento ou uma novidade."
        acao={
          podeEscrever ? (
            <Button asChild>
              <Link href="/push/nova">Criar campanha</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  function confirmar() {
    const atual = confirmacao;
    if (atual === null) return;

    iniciar(async () => {
      const resultado =
        atual.tipo === 'cancelar'
          ? await cancelarCampanha(atual.campanha.id)
          : await excluirCampanha(atual.campanha.id);

      setConfirmacao(null);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Pronto.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível concluir.');
      }
    });
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {campanhas.map((campanha) => {
          const metricas = lerMetricas(campanha.stats);
          const quando = campanha.sentAt ?? campanha.scheduledAt ?? campanha.createdAt;
          const vendasDaCampanha = vendas[campanha.id];
          const receita = receitaDaCampanha(campanha.status, vendasDaCampanha, vendasVisiveis);
          const pedidos =
            receita === '—' || vendasDaCampanha === undefined
              ? undefined
              : textoDosPedidos(vendasDaCampanha.pedidos);

          return (
            <li key={campanha.id} className="flex items-start gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/push/${campanha.id}`}
                    className="truncate font-medium hover:underline"
                  >
                    {campanha.title}
                  </Link>
                  <Badge variant={COR_DO_STATUS[campanha.status]}>
                    {ROTULO_DO_STATUS[campanha.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-sm">{campanha.body}</p>
                {campanha.publico.tipo === 'todos' ? null : (
                  <p className="text-muted-foreground text-xs">
                    Para: {descricaoDoPublico(campanha.publico)}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {EXPLICACAO_DO_STATUS[campanha.status]}{' '}
                  <time dateTime={quando}>{formatar(quando, fuso)}</time>
                </p>
                {/* No celular, os números cabem numa linha só, embaixo do texto. */}
                {campanha.status === 'sent' ? (
                  <p className="text-xs sm:hidden" data-testid="numeros-no-celular">
                    {numeroOuTraco(metricas.enviados)} enviados · {numeroOuTraco(metricas.abertos)}{' '}
                    aberturas
                    {metricas.taxaDeAbertura === null
                      ? ''
                      : ` (${porcentagemOuTraco(metricas.taxaDeAbertura)})`}
                    {' · '}
                    {pedidos === undefined ? `receita ${receita}` : `${receita} em ${pedidos}`}
                  </p>
                ) : null}
              </div>

              <div className="hidden shrink-0 gap-6 text-right sm:flex">
                <Metrica
                  rotulo="Enviados"
                  valor={numeroOuTraco(metricas.enviados)}
                  detalhe={
                    metricas.entregues === null
                      ? undefined
                      : `${numeroOuTraco(metricas.entregues)} entregues`
                  }
                />
                <Metrica
                  rotulo="Aberturas"
                  valor={numeroOuTraco(metricas.abertos)}
                  detalhe={
                    metricas.taxaDeAbertura === null
                      ? undefined
                      : `${porcentagemOuTraco(metricas.taxaDeAbertura)} abriram`
                  }
                />
                <Metrica rotulo="Receita" valor={receita} detalhe={pedidos} />
              </div>

              {podeEscrever &&
              (podeEditar(campanha.status) ||
                podeCancelar(campanha.status) ||
                podeExcluir(campanha.status)) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Ações de ${campanha.title}`}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {podeEditar(campanha.status) ? (
                      <DropdownMenuItem asChild>
                        <Link href={`/push/${campanha.id}/editar`}>Editar</Link>
                      </DropdownMenuItem>
                    ) : null}
                    {podeCancelar(campanha.status) ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setConfirmacao({ tipo: 'cancelar', campanha });
                        }}
                      >
                        Cancelar envio
                      </DropdownMenuItem>
                    ) : null}
                    {podeExcluir(campanha.status) ? (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => {
                          setConfirmacao({ tipo: 'excluir', campanha });
                        }}
                      >
                        Excluir
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={confirmacao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmacao(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmacao?.tipo === 'cancelar' ? 'Cancelar o envio?' : 'Excluir a campanha?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmacao?.tipo === 'cancelar'
                ? `"${confirmacao.campanha.title}" não vai sair no horário marcado. Você pode reagendá-la depois.`
                : `"${confirmacao?.campanha.title ?? ''}" será apagada. Isso não pode ser desfeito.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                confirmar();
              }}
              disabled={enviando}
            >
              {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {confirmacao?.tipo === 'cancelar' ? 'Cancelar envio' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Metrica({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{rotulo}</p>
      <p className="text-sm font-medium tabular-nums">{valor}</p>
      {detalhe === undefined ? null : (
        <p className="text-muted-foreground text-xs tabular-nums">{detalhe}</p>
      )}
    </div>
  );
}

function formatar(iso: string, fuso: string): string {
  return formatarDataHora(iso, fuso);
}
