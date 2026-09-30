'use client';

/**
 * Adicionar um celular de teste (parte da C08).
 *
 * Duas etapas no mesmo diálogo: o nome do celular ("Celular da Ana", para se
 * achar na lista) e o QR. O lojista lê o QR com a câmera do celular onde o app
 * da loja está instalado; a página que abre leva ao app, e o app se apresenta
 * à Storefy. Enquanto isso, o diálogo pergunta a cada poucos segundos se o
 * celular apareceu — e fecha sozinho quando aparece.
 *
 * Sem `<form>` aqui dentro, de propósito: o diálogo nasce dentro do formulário
 * da campanha, e um Enter no nome não pode enviar a campanha.
 */
import { useEffect, useEffectEvent, useState, useTransition } from 'react';
import { Loader2, Plus, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import {
  MAXIMO_DO_NOME,
  MINUTOS_DO_CODIGO,
  pareadoDepoisDe,
  type CelularDeTeste,
} from '@/lib/celular-de-teste';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { gerarCodigoDeTeste, lerCelularesDeTeste, type EstadoDoCodigoDeTeste } from './acoes';

/** De quanto em quanto tempo o diálogo pergunta se o celular apareceu. */
const INTERVALO_DA_ESPERA_MS = 3000;

const SEM_CONEXAO = 'Não conseguimos falar com a Storefy. Confira a internet — seguimos tentando.';

type CodigoGerado = Required<
  Pick<EstadoDoCodigoDeTeste, 'codigo' | 'qr' | 'abrirNoApp' | 'geradoEm'>
> & {
  /**
   * Quando o código vence, no relógio DESTE navegador: a validade contada a
   * partir de quando ele chegou. Comparar o relógio do computador com o do
   * banco daria "venceu" na hora a quem está com o relógio adiantado.
   */
  venceEm: number;
};

/** Quanto o código vale, pelos dois instantes do banco (o mesmo relógio). */
function validade(geradoEm: string, expiraEm: string): number {
  const ms = Date.parse(expiraEm) - Date.parse(geradoEm);
  return Number.isNaN(ms) ? MINUTOS_DO_CODIGO * 60_000 : ms;
}

export function AdicionarCelular({
  primeiro,
  aoParear,
}: {
  /** Sem celular nenhum ainda, o botão é o convite principal da caixa. */
  primeiro: boolean;
  /** A lista nova, e o celular que acabou de ser pareado. */
  aoParear: (celulares: CelularDeTeste[], pareado: CelularDeTeste) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<CodigoGerado | null>(null);
  const [vencido, setVencido] = useState(false);
  const [falhaDaEspera, setFalhaDaEspera] = useState<string | null>(null);
  const [gerando, iniciar] = useTransition();

  function abrirOuFechar(abrir: boolean) {
    setAberto(abrir);
    if (!abrir) {
      // O código não volta: fechar e abrir de novo pede outro.
      setCodigo(null);
      setVencido(false);
      setFalhaDaEspera(null);
      setErroDoNome(null);
    }
  }

  function gerar() {
    iniciar(async () => {
      let resultado: EstadoDoCodigoDeTeste;
      try {
        resultado = await gerarCodigoDeTeste(nome);
      } catch {
        toast.error(SEM_CONEXAO);
        return;
      }
      if (resultado.erroNoNome !== undefined) {
        setErroDoNome(resultado.erroNoNome);
        return;
      }
      if (
        resultado.ok !== true ||
        resultado.codigo === undefined ||
        resultado.qr === undefined ||
        resultado.abrirNoApp === undefined ||
        resultado.geradoEm === undefined ||
        resultado.expiraEm === undefined
      ) {
        toast.error(resultado.mensagem ?? 'Não foi possível gerar o código. Tente de novo.');
        return;
      }
      setErroDoNome(null);
      setVencido(false);
      setFalhaDaEspera(null);
      setCodigo({
        codigo: resultado.codigo,
        qr: resultado.qr,
        abrirNoApp: resultado.abrirNoApp,
        geradoEm: resultado.geradoEm,
        venceEm: Date.now() + validade(resultado.geradoEm, resultado.expiraEm),
      });
    });
  }

  /** O celular apareceu: a caixa ganha a lista nova, e o diálogo fecha. */
  const pareou = useEffectEvent((celulares: CelularDeTeste[], pareado: CelularDeTeste) => {
    aoParear(celulares, pareado);
    toast.success(`${pareado.nome} foi adicionado. Ele já pode receber os testes.`);
    setNome('');
    abrirOuFechar(false);
  });

  /*
   * A espera: pergunta até o celular aparecer ou o código vencer. Uma
   * pergunta de cada vez — a próxima só sai depois da resposta da anterior.
   */
  useEffect(() => {
    if (!aberto || codigo === null || vencido) return;
    const { geradoEm, venceEm } = codigo;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;

    function perguntar() {
      relogio = setTimeout(() => {
        if (Date.now() >= venceEm) {
          setVencido(true);
          return;
        }
        void lerCelularesDeTeste()
          .catch(() => ({ ok: false as const, mensagem: SEM_CONEXAO }))
          .then((resposta) => {
            if (!vivo) return;
            if (!resposta.ok) {
              // Segue perguntando: uma falha de rede não desfaz o QR na tela.
              setFalhaDaEspera(resposta.mensagem);
              perguntar();
              return;
            }
            setFalhaDaEspera(null);
            const pareado = pareadoDepoisDe(resposta.celulares, geradoEm);
            if (pareado === null) perguntar();
            else pareou(resposta.celulares, pareado);
          });
      }, INTERVALO_DA_ESPERA_MS);
    }

    perguntar();
    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [aberto, codigo, vencido]);

  return (
    <Dialog open={aberto} onOpenChange={abrirOuFechar}>
      {/* O gatilho de verdade: ao fechar, o foco volta para este botão. */}
      <DialogTrigger asChild>
        <Button type="button" variant={primeiro ? 'default' : 'outline'}>
          <Plus className="size-4" aria-hidden />
          {primeiro ? 'Adicionar meu celular' : 'Adicionar celular'}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-dvh overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar celular de teste</DialogTitle>
          <DialogDescription>
            Só os celulares que você adicionar aqui recebem os testes — nunca o de um cliente.
          </DialogDescription>
        </DialogHeader>

        {codigo === null ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nome-do-celular">Como chamar este celular?</Label>
              <Input
                id="nome-do-celular"
                value={nome}
                maxLength={MAXIMO_DO_NOME}
                placeholder="Celular da Ana"
                autoComplete="off"
                aria-invalid={erroDoNome !== null}
                aria-describedby={erroDoNome === null ? undefined : 'erro-nome-do-celular'}
                onChange={(evento) => {
                  setNome(evento.target.value);
                  setErroDoNome(null);
                }}
                onKeyDown={(evento) => {
                  if (evento.key !== 'Enter') return;
                  evento.preventDefault();
                  if (!gerando) gerar();
                }}
              />
              {erroDoNome === null ? null : (
                <p id="erro-nome-do-celular" className="text-destructive text-sm">
                  {erroDoNome}
                </p>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Tenha em mãos o celular com o app da sua loja instalado e aberto pelo menos uma vez.
            </p>
            <DialogFooter>
              <Button type="button" disabled={gerando} onClick={gerar}>
                {gerando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <QrCode className="size-4" aria-hidden />
                )}
                {gerando ? 'Gerando…' : 'Mostrar o QR code'}
              </Button>
            </DialogFooter>
          </div>
        ) : vencido ? (
          <div className="space-y-4" role="status">
            <p className="text-sm">
              Este código venceu. Ele vale 10 minutos, para ninguém usá-lo depois.
            </p>
            <DialogFooter>
              <Button type="button" disabled={gerando} onClick={gerar}>
                <RefreshCw className="size-4" aria-hidden />
                {gerando ? 'Gerando…' : 'Gerar outro código'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div
                // O SVG é gerado no nosso servidor a partir de um link nosso;
                // não há conteúdo de terceiro aqui.
                dangerouslySetInnerHTML={{ __html: codigo.qr }}
                aria-label="QR code para adicionar o celular de teste"
                role="img"
                data-testid="qr-do-celular-de-teste"
                data-codigo={codigo.codigo}
                className="size-44 shrink-0 rounded-lg border bg-white p-1 [&>svg]:size-full"
              />
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>Abra a câmera do celular e aponte para o QR code.</li>
                <li>Toque no link que aparecer.</li>
                <li>
                  Na página que abrir, toque em <strong>Abrir o app da loja</strong>.
                </li>
              </ol>
            </div>

            <p className="text-muted-foreground text-sm">
              Está com esta tela aberta no próprio celular?{' '}
              <a href={codigo.abrirNoApp} className="text-foreground font-medium underline">
                Toque aqui para abrir o app
              </a>
              .
            </p>

            <div
              role="status"
              className="bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            >
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              <span>
                Esperando o celular… O código vale até{' '}
                {
                  // No relógio do NAVEGADOR, de propósito: este texto só nasce
                  // depois do clique, e "vale até" é sobre o relógio de quem lê.
                  new Date(codigo.venceEm).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }
                .
              </span>
            </div>
            {falhaDaEspera === null ? null : (
              <p className="text-destructive text-sm">{falhaDaEspera}</p>
            )}

            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <Smartphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />O app não abriu?
              Confira se o app da loja está instalado nesse celular e se ele já foi aberto uma vez.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
