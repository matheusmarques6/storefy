'use client';

/**
 * O envio de teste (parte da C08).
 *
 * Uma campanha de push não tem desfazer. Esta é a última conferência possível:
 * o lojista manda a notificação para o PRÓPRIO celular e vê o texto cortado, o
 * link que abre no lugar errado e o emoji que não renderiza — nada disso
 * aparece num campo de formulário.
 *
 * Só para os celulares de teste que o lojista pareou (`AdicionarCelular`). A
 * lista antiga eram os aparelhos vistos por último, clientes inclusive: depois
 * do lançamento, "testar" mandava um texto sem revisão para um cliente.
 */
import { useState, useTransition } from 'react';
import { BellOff, Loader2, Send, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { descreverCelular, type CelularDeTeste } from '@/lib/celular-de-teste';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { enviarTeste, removerCelularDeTeste } from './acoes';
import { AdicionarCelular } from './adicionar-celular';

const SEM_CONEXAO = 'Não conseguimos falar com a Storefy. Confira a internet e tente de novo.';

interface Props {
  celulares: readonly CelularDeTeste[];
  /** O que a campanha tem agora — a imagem vai junto, pelo caminho no bucket. */
  valores: { title: string; body: string; deepLink: string; imagem: string | null };
}

export function EnvioDeTeste({ celulares, valores }: Props) {
  /*
   * A lista é da caixa: parear e remover mudam aqui mesmo, sem recarregar a
   * página — e sem mexer na campanha que está sendo escrita. Quando a página
   * traz uma lista nova do servidor, ela vale.
   */
  const [doServidor, setDoServidor] = useState(celulares);
  const [lista, setLista] = useState<readonly CelularDeTeste[]>(celulares);
  const [escolhido, setEscolhido] = useState(celulares[0]?.id ?? '');
  if (celulares !== doServidor) {
    setDoServidor(celulares);
    setLista(celulares);
    if (!celulares.some((celular) => celular.id === escolhido)) {
      setEscolhido(celulares[0]?.id ?? '');
    }
  }

  const [enviando, iniciarEnvio] = useTransition();
  // O instante da tela, para "visto há 2 min". Nasce no navegador e anda a cada ação.
  const [agora, setAgora] = useState(() => Date.now());

  const atual = lista.find((celular) => celular.id === escolhido) ?? lista[0];

  function enviar() {
    if (atual === undefined) return;
    iniciarEnvio(async () => {
      let resultado: Awaited<ReturnType<typeof enviarTeste>>;
      try {
        resultado = await enviarTeste({ ...valores, celularId: atual.id });
      } catch {
        toast.error(SEM_CONEXAO);
        return;
      }
      setAgora(Date.now());

      // O problema de verdade, e não um genérico: a imagem que sumiu não se
      // conserta escrevendo o título.
      const problema = resultado.problemas?.[0];
      if (problema !== undefined) {
        toast.error(
          problema.campo === 'title' || problema.campo === 'body'
            ? 'Escreva o título e a mensagem antes de testar.'
            : problema.mensagem,
        );
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível enviar o teste.');
        return;
      }
      toast.success(resultado.mensagem ?? 'Teste enviado.');
    });
  }

  function pareou(novaLista: CelularDeTeste[], pareado: CelularDeTeste) {
    setLista(novaLista);
    setEscolhido(pareado.id);
    setAgora(Date.now());
  }

  function removido(id: string) {
    const restantes = lista.filter((celular) => celular.id !== id);
    setLista(restantes);
    if (escolhido === id) setEscolhido(restantes[0]?.id ?? '');
  }

  return (
    <section
      aria-labelledby="titulo-envio-de-teste"
      className="space-y-3 rounded-xl border p-4"
      data-testid="envio-de-teste"
    >
      <div className="flex items-center gap-2 text-sm font-medium" id="titulo-envio-de-teste">
        <Smartphone className="size-4" aria-hidden />
        Envio de teste
      </div>

      {atual === undefined ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Veja a notificação no seu celular antes de mandar para todo mundo. O teste vai só para
            os celulares que você adicionar — nunca para um cliente. Você precisa do app da loja
            instalado no celular.
          </p>
          <AdicionarCelular primeiro aoParear={pareou} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Mande só para um dos seus celulares de teste. Não conta como campanha.
          </p>

          <fieldset className="space-y-2">
            <legend className="sr-only">Celular que recebe o teste</legend>
            {lista.map((celular) => (
              <div
                key={celular.id}
                className="has-[:checked]:border-primary flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="celular-de-teste"
                    value={celular.id}
                    checked={celular.id === atual.id}
                    onChange={() => {
                      setEscolhido(celular.id);
                    }}
                    className="accent-primary size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{celular.nome}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {descreverCelular(celular, agora)}
                    </span>
                    {celular.recebePush ? null : (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <BellOff className="size-3 shrink-0" aria-hidden />
                        Ainda não recebe notificações: abra o app nele e permita as notificações.
                      </span>
                    )}
                  </span>
                </label>
                <RemoverCelular celular={celular} aoRemover={removido} />
              </div>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={enviando} onClick={enviar}>
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Enviar teste
            </Button>
            <AdicionarCelular primeiro={false} aoParear={pareou} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Tirar um celular dos testes, sempre com confirmação (regra 3). */
function RemoverCelular({
  celular,
  aoRemover,
}: {
  celular: CelularDeTeste;
  aoRemover: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [removendo, iniciar] = useTransition();

  function confirmar() {
    iniciar(async () => {
      let resultado: Awaited<ReturnType<typeof removerCelularDeTeste>>;
      try {
        resultado = await removerCelularDeTeste(celular.id);
      } catch {
        toast.error(SEM_CONEXAO);
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível remover o celular.');
        return;
      }
      setAberto(false);
      aoRemover(celular.id);
      toast.success(resultado.mensagem ?? 'Celular removido.');
    });
  }

  return (
    <AlertDialog open={aberto} onOpenChange={setAberto}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive shrink-0"
          aria-label={`Remover ${celular.nome}`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover “{celular.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Ele para de receber os testes desta loja. O app continua instalado nele, e você pode
            adicioná-lo de novo quando quiser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={removendo}
            onClick={(evento) => {
              // Fica aberto até a resposta, para o erro aparecer com o diálogo na frente.
              evento.preventDefault();
              confirmar();
            }}
          >
            {removendo ? 'Removendo…' : 'Remover'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
