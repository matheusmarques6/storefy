'use client';

/**
 * Histórico de versões: comparar e restaurar (C06f).
 *
 * "Comparar" diz, em frases, o que muda no rascunho se a versão for
 * restaurada — é o que o lojista quer saber antes de restaurar, e a lista de
 * versões sozinha só dá números e datas. Qualquer pessoa da empresa compara;
 * restaurar é de dono e administrador.
 */
import { useState, useTransition } from 'react';
import { GitCompare, History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import type { VersaoDoHistorico } from '@/lib/configs-servidor';
import { diferencasDaConfig } from '@/lib/diferencas-da-config';
import { formatarDataHora } from '@/lib/fuso';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { configDaVersao, type EstadoDoEditor } from './acoes';
import { ListaDeDiferencas } from './lista-de-diferencas';

/** O que o diálogo de comparação está mostrando. */
type Comparacao =
  | { versao: number; estado: 'carregando' }
  | { versao: number; estado: 'erro'; mensagem: string }
  | { versao: number; estado: 'pronta'; config: AppConfig };

const ROTULO_DO_STATUS: Record<VersaoDoHistorico['status'], string> = {
  draft: 'Rascunho',
  published: 'No ar',
  archived: 'Histórico',
};

function quando(iso: string | null, fuso: string): string {
  return formatarDataHora(iso, fuso);
}

export function SecaoVersoes({
  storeId,
  rascunho,
  versoes,
  somenteLeitura,
  fuso,
  restaurar,
}: {
  storeId: string;
  /** O rascunho como está na tela: é contra ele que a versão é comparada. */
  rascunho: AppConfig;
  /**
   * Restaura pelo editor, que sabe em cima de qual rascunho a tela está — e
   * que mostra a escolha se ele tiver mudado em outra aba.
   */
  restaurar: (versao: number) => Promise<EstadoDoEditor>;
  versoes: VersaoDoHistorico[];
  somenteLeitura: boolean;
  /** O fuso da loja. Sem ele, servidor e navegador escreviam horas diferentes. */
  fuso: string;
}) {
  const [aRestaurar, setARestaurar] = useState<number | null>(null);
  const [processando, iniciar] = useTransition();
  const [comparacao, setComparacao] = useState<Comparacao | null>(null);

  function comparar(versao: number) {
    setComparacao({ versao, estado: 'carregando' });
    void configDaVersao(storeId, versao).then(
      (resultado) => {
        setComparacao((atual) => {
          // Fechado ou trocado por outra versão enquanto a resposta vinha.
          if (atual?.versao !== versao) return atual;
          return resultado.ok === true && resultado.config !== undefined
            ? { versao, estado: 'pronta', config: resultado.config }
            : {
                versao,
                estado: 'erro',
                mensagem: resultado.mensagem ?? 'Não foi possível abrir essa versão.',
              };
        });
      },
      () => {
        setComparacao((atual) =>
          atual?.versao === versao
            ? {
                versao,
                estado: 'erro',
                mensagem: 'Sem conexão com a Storefy. Confira a internet e tente de novo.',
              }
            : atual,
        );
      },
    );
  }

  function confirmar() {
    const versao = aRestaurar;
    if (versao === null) return;
    iniciar(() => {
      void restaurar(versao).then(
        (estado) => {
          setARestaurar(null);
          // O rascunho mudou em outra aba: o editor já abriu a escolha.
          if (estado.conflito !== undefined) return;
          if (estado.ok === true) toast.success(estado.mensagem ?? 'Versão carregada no rascunho.');
          else toast.error(estado.mensagem ?? 'Não foi possível restaurar.');
        },
        () => {
          setARestaurar(null);
          toast.error('Sem conexão com a Storefy: a versão não foi restaurada.');
        },
      );
    });
  }

  if (versoes.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
        Nenhuma versão ainda. A primeira aparece aqui assim que você publicar.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {versoes.map((versao) => (
          <li key={versao.version} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Versão {versao.version}</span>
                <Badge variant={versao.status === 'published' ? 'default' : 'secondary'}>
                  {ROTULO_DO_STATUS[versao.status]}
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {versao.status === 'published'
                  ? `No ar desde ${quando(versao.publishedAt, fuso)}`
                  : versao.status === 'archived'
                    ? `Esteve no ar em ${quando(versao.publishedAt, fuso)}`
                    : `Criado em ${quando(versao.createdAt, fuso)}`}
              </p>
            </div>

            {versao.status === 'draft' ? null : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Comparar a versão ${String(versao.version)} com o rascunho`}
                  onClick={() => {
                    comparar(versao.version);
                  }}
                >
                  <GitCompare className="size-4" aria-hidden />
                  Comparar
                </Button>
                {somenteLeitura ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={processando}
                    onClick={() => {
                      setARestaurar(versao.version);
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Restaurar
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
        <History className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Restaurar carrega a versão escolhida no rascunho. O app dos seus clientes só muda quando
        você publicar.
      </p>

      <Dialog
        open={comparacao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setComparacao(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Versão {comparacao?.versao} × seu rascunho</DialogTitle>
            <DialogDescription>
              O que muda no rascunho se você restaurar esta versão. Nada vai ao ar sem publicar.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] overflow-y-auto" aria-live="polite">
            {comparacao?.estado === 'carregando' ? (
              <div className="space-y-2" aria-label="Carregando a comparação">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : comparacao?.estado === 'erro' ? (
              <div className="space-y-2">
                <p role="alert" className="text-destructive text-sm">
                  {comparacao.mensagem}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    comparar(comparacao.versao);
                  }}
                >
                  Tentar de novo
                </Button>
              </div>
            ) : comparacao?.estado === 'pronta' ? (
              diferencasDaConfig(rascunho, comparacao.config).length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Esta versão é igual ao seu rascunho. Restaurar não mudaria nada.
                </p>
              ) : (
                <ListaDeDiferencas diferencas={diferencasDaConfig(rascunho, comparacao.config)} />
              )
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setComparacao(null);
              }}
            >
              Fechar
            </Button>
            {somenteLeitura ||
            comparacao?.estado !== 'pronta' ||
            diferencasDaConfig(rascunho, comparacao.config).length === 0 ? null : (
              <Button
                type="button"
                disabled={processando}
                onClick={() => {
                  setARestaurar(comparacao.versao);
                  setComparacao(null);
                }}
              >
                <RotateCcw className="size-4" aria-hidden />
                Restaurar esta versão
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={aRestaurar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setARestaurar(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar a versão {aRestaurar}?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho atual será substituído pelo conteúdo dessa versão. O que está no ar
              continua igual até você publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={processando}
              onClick={(evento) => {
                evento.preventDefault();
                confirmar();
              }}
            >
              {processando ? 'Restaurando…' : 'Restaurar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
