'use client';

/**
 * C15 — os planos, e o que dá para fazer com cada um: assinar (com os dados de
 * quem paga), ou mudar para ele quando já existe assinatura.
 *
 * Assinar abre um diálogo, e não uma página: o plano escolhido fica à vista,
 * com o preço, enquanto a pessoa preenche. O documento não volta preenchido —
 * ele não fica guardado aqui, só na Asaas.
 */
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { descreverLimite, formatarPreco } from '@/lib/cobranca';
import { assinarPlano, trocarDePlano, type EstadoDaCobranca } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface PlanoNaVitrine {
  id: string;
  nome: string;
  descricao: string;
  precoCentavos: number;
  limiteLojas: number | null;
  limiteAparelhos: number | null;
  limiteCampanhasMes: number | null;
  disponivel: boolean;
}

export function EscolherPlano({
  planos,
  planoAtual,
  assinaturaViva,
  podeMexer,
  cobrancaLigada,
  quemPaga,
}: {
  planos: PlanoNaVitrine[];
  /** O plano da assinatura viva, se houver. */
  planoAtual: string | null;
  assinaturaViva: boolean;
  /** Proprietário, fora de visita. */
  podeMexer: boolean;
  cobrancaLigada: boolean;
  /** Para preencher o nome e o e-mail de quem já pagou antes. */
  quemPaga: { nome: string; email: string } | null;
}) {
  const [assinando, setAssinando] = useState<PlanoNaVitrine | null>(null);
  const [trocando, setTrocando] = useState<PlanoNaVitrine | null>(null);

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {planos.map((plano) => {
          const atual = assinaturaViva && plano.id === planoAtual;
          return (
            <li
              key={plano.id}
              className={
                atual
                  ? 'border-primary flex flex-col rounded-2xl border-2 p-4'
                  : 'flex flex-col rounded-2xl border p-4'
              }
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{plano.nome}</h3>
                {atual ? <Badge>Seu plano</Badge> : null}
              </div>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatarPreco(plano.precoCentavos)}
                <span className="text-muted-foreground text-sm font-normal">/mês</span>
              </p>
              {plano.descricao === '' ? null : (
                <p className="text-muted-foreground mt-2 text-sm">{plano.descricao}</p>
              )}
              <ul className="mt-3 space-y-1 text-sm">
                <li>{descreverLimite(plano.limiteLojas, 'loja', 'lojas', 'Lojas sem limite')}</li>
                <li>
                  {descreverLimite(
                    plano.limiteAparelhos,
                    'aparelho ativo',
                    'aparelhos ativos',
                    'Aparelhos ativos sem limite',
                  )}
                </li>
                <li>
                  {descreverLimite(
                    plano.limiteCampanhasMes,
                    'campanha por mês',
                    'campanhas por mês',
                    'Campanhas sem limite',
                  )}
                </li>
              </ul>
              {!plano.disponivel ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  Este plano não é mais oferecido; quem já assina continua nele.
                </p>
              ) : null}
              <div className="mt-auto pt-4">
                {!podeMexer || atual || !plano.disponivel ? null : assinaturaViva ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!cobrancaLigada}
                    onClick={() => {
                      setTrocando(plano);
                    }}
                  >
                    Mudar para este plano
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={!cobrancaLigada}
                    onClick={() => {
                      setAssinando(plano);
                    }}
                  >
                    Assinar {plano.nome}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={assinando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAssinando(null);
        }}
      >
        <DialogContent>
          {assinando === null ? null : (
            <FormularioDeAssinatura
              key={assinando.id}
              plano={assinando}
              quemPaga={quemPaga}
              aoTerminar={() => {
                setAssinando(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <TrocarDePlano
        plano={trocando}
        aoFechar={() => {
          setTrocando(null);
        }}
      />
    </>
  );
}

function FormularioDeAssinatura({
  plano,
  quemPaga,
  aoTerminar,
}: {
  plano: PlanoNaVitrine;
  quemPaga: { nome: string; email: string } | null;
  aoTerminar: () => void;
}) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDaCobranca, FormData>(async (anterior, dados) => {
    const resultado = await assinarPlano(anterior, dados);
    if (resultado.ok === true) router.refresh();
    return resultado;
  }, {});

  if (estado.ok === true) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Assinatura criada</DialogTitle>
          <DialogDescription>{estado.mensagem}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          A fatura tem Pix, boleto e cartão; você escolhe na hora de pagar. A Asaas, que cuida da
          cobrança, também manda a fatura para o e-mail informado.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {estado.linkDaFatura === undefined ? null : (
            <Button asChild>
              <a href={estado.linkDaFatura} target="_blank" rel="noopener noreferrer">
                Abrir a fatura
                <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
          {/* "Pronto", e não "Fechar": o X do diálogo já se chama assim. */}
          <Button variant="outline" onClick={aoTerminar}>
            Pronto
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assinar o plano {plano.nome}</DialogTitle>
        <DialogDescription>
          {formatarPreco(plano.precoCentavos)} por mês. Quem paga recebe a fatura por e-mail, com
          Pix, boleto e cartão.
        </DialogDescription>
      </DialogHeader>

      <form action={acao} className="space-y-4" noValidate>
        {estado.mensagem == null ? null : (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{estado.mensagem}</AlertDescription>
          </Alert>
        )}
        {estado.erros?.plano == null ? null : (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{estado.erros.plano}</AlertDescription>
          </Alert>
        )}
        <input type="hidden" name="plano" value={plano.id} />

        <Campo id="nome" rotulo="Nome ou razão social" erro={estado.erros?.nome}>
          <Input
            {...propsDoCampo('nome', estado.erros?.nome)}
            defaultValue={estado.valores?.nome ?? quemPaga?.nome ?? ''}
            autoComplete="organization"
            maxLength={120}
          />
        </Campo>

        <Campo
          id="documento"
          rotulo="CPF ou CNPJ"
          erro={estado.erros?.documento}
          dica="Vai para a Asaas, que emite a cobrança. Aqui guardamos só os quatro últimos."
        >
          <Input
            {...propsDoCampo('documento', estado.erros?.documento, true)}
            defaultValue={estado.valores?.documento ?? ''}
            inputMode="text"
            autoComplete="off"
            maxLength={20}
          />
        </Campo>

        <Campo id="email" rotulo="E-mail que recebe as faturas" erro={estado.erros?.email}>
          <Input
            {...propsDoCampo('email', estado.erros?.email)}
            type="email"
            defaultValue={estado.valores?.email ?? quemPaga?.email ?? ''}
            autoComplete="email"
            maxLength={200}
          />
        </Campo>

        <div className="flex justify-end">
          <BotaoEnviar carregando="Assinando...">Assinar</BotaoEnviar>
        </div>
      </form>
    </>
  );
}

function TrocarDePlano({
  plano,
  aoFechar,
}: {
  plano: PlanoNaVitrine | null;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [rodando, iniciar] = useTransition();

  function trocar() {
    if (plano === null) return;
    iniciar(async () => {
      const resultado = await trocarDePlano(plano.id);
      aoFechar();
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Plano trocado.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível trocar o plano.');
      }
    });
  }

  return (
    <AlertDialog
      open={plano !== null}
      onOpenChange={(aberto) => {
        if (!aberto && !rodando) aoFechar();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mudar para o plano {plano?.nome}?</AlertDialogTitle>
          <AlertDialogDescription>
            O plano passa a custar {plano === null ? '' : formatarPreco(plano.precoCentavos)} por
            mês. O novo valor vale a partir da fatura em aberto, e os limites mudam na hora.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
          <AlertDialogAction
            disabled={rodando}
            onClick={(evento) => {
              evento.preventDefault();
              trocar();
            }}
          >
            {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Mudar de plano
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** O aviso de sucesso de uma ação, com o ícone certo. */
export function AvisoDaAcao({ estado }: { estado: EstadoDaCobranca }) {
  if (estado.mensagem == null) return null;
  return (
    <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
      {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertDescription>{estado.mensagem}</AlertDescription>
    </Alert>
  );
}
