'use client';

/**
 * O identificador do app e o app na Apple (parte da C12).
 *
 * O identificador é o nome técnico do app na App Store e na Play Store. A
 * seção 10 do plano manda preencher pelo lojista: a sugestão sai do endereço
 * da loja, e basta confirmar. Depois que o app chega a uma loja de
 * aplicativos, ele não muda mais — o banco trava, e a tela nem oferece.
 *
 * Na Apple falta um passo que a API dela não deixa ninguém fazer: criar o app
 * no App Store Connect. O cartão guia esse passo com os valores prontos para
 * copiar, e o "Já criei o app" confere na conta do lojista — é o que libera o
 * envio à App Store.
 */
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { problemaDoIdentificador } from '@/lib/identificador-do-app';
import { LinhaCopiavel } from '@/components/linha-copiavel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { conferirAppNaApple, definirIdentificador, registrarNaApple } from './acoes';

export function IdentificadorDoApp({
  identificador,
  sugestao,
  travado,
  appleConectada,
  iosAscAppId,
  nomeDoApp,
  podeEscrever,
}: {
  identificador: string | null;
  /** A sugestão livre, para quando ainda não há identificador. */
  sugestao: string | null;
  travado: boolean;
  appleConectada: boolean;
  /** O número do app no App Store Connect, quando já foi achado. */
  iosAscAppId: string | null;
  nomeDoApp: string;
  podeEscrever: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(identificador ?? sugestao ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();

  const mostrarCampo = podeEscrever && !travado && (identificador === null || editando);

  function salvar() {
    const problema = problemaDoIdentificador(texto);
    if (problema !== null) {
      setErro(problema);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await definirIdentificador(texto);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Identificador salvo.');
        if (resultado.aviso !== undefined) toast.warning(resultado.aviso);
        setEditando(false);
        router.refresh();
      } else {
        // O que foi digitado fica no campo, com o motivo embaixo.
        setErro(resultado.mensagem ?? 'Não foi possível salvar o identificador.');
      }
    });
  }

  function registrar() {
    iniciar(async () => {
      const resultado = await registrarNaApple();
      if (resultado.ok === true) toast.success(resultado.mensagem ?? 'Registrado na Apple.');
      else toast.error(resultado.mensagem ?? 'Não foi possível registrar na Apple.');
    });
  }

  function conferir() {
    iniciar(async () => {
      const resultado = await conferirAppNaApple();
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'App encontrado na Apple.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível conferir o app na Apple.');
      }
    });
  }

  return (
    <Card
      id="identificador"
      role="region"
      aria-labelledby="titulo-do-identificador"
      className="scroll-mt-24"
    >
      <CardHeader>
        <CardTitle id="titulo-do-identificador" className="text-base">
          Identificador do app
        </CardTitle>
        <CardDescription>
          O nome técnico do app na App Store e na Play Store. Preenchemos para você a partir do
          endereço da loja; depois que o app chega a uma loja de aplicativos, ele não muda mais.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {mostrarCampo ? (
          <form
            className="space-y-2"
            onSubmit={(evento) => {
              evento.preventDefault();
              salvar();
            }}
          >
            <Label htmlFor="campo-do-identificador">Identificador</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="campo-do-identificador"
                value={texto}
                onChange={(evento) => {
                  setTexto(evento.target.value);
                  setErro(null);
                }}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={erro !== null}
                aria-describedby="ajuda-do-identificador"
                className="font-mono"
              />
              <Button type="submit" disabled={processando}>
                {processando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {identificador === null ? 'Usar este identificador' : 'Salvar'}
              </Button>
              {identificador === null ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={processando}
                  onClick={() => {
                    setEditando(false);
                    setTexto(identificador);
                    setErro(null);
                  }}
                >
                  Cancelar
                </Button>
              )}
            </div>
            <p
              id="ajuda-do-identificador"
              role={erro === null ? undefined : 'alert'}
              className={
                erro === null ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'
              }
            >
              {erro ??
                'Só letras minúsculas e números, em partes separadas por ponto. O mesmo vale para o iPhone e o Android.'}
            </p>
          </form>
        ) : identificador === null ? (
          <p className="text-muted-foreground text-sm">
            Sugestão: <span className="text-foreground font-mono">{sugestao}</span>. Um proprietário
            ou administrador confirma o identificador.
          </p>
        ) : (
          <div className="space-y-2">
            <LinhaCopiavel valor={identificador} monoespacado />
            {travado ? (
              <p className="text-muted-foreground text-xs">
                O app já chegou a uma loja de aplicativos com este identificador: ele não muda mais.
              </p>
            ) : podeEscrever ? (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  setTexto(identificador);
                  setEditando(true);
                }}
              >
                Trocar o identificador
              </Button>
            ) : null}
          </div>
        )}

        {identificador === null ? null : (
          <section
            aria-labelledby="titulo-do-app-na-apple"
            className="space-y-3 rounded-xl border p-3 sm:p-4"
          >
            <h3 id="titulo-do-app-na-apple" className="text-sm font-medium">
              O app no App Store Connect (iPhone)
            </h3>

            {iosAscAppId !== null ? (
              <p className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                App criado na sua conta Apple (número {iosAscAppId}).
              </p>
            ) : !appleConectada ? (
              <p className="text-muted-foreground text-sm">
                Conecte a conta Apple da empresa para seguirmos com o iPhone.{' '}
                <Link href="/publicacao/contas" className="text-foreground font-medium underline">
                  Conectar a conta Apple
                </Link>
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  A Apple não deixa ninguém criar o app pela conta de outra pessoa: este passo é
                  seu, uma vez só, e leva uns três minutos.
                </p>
                <ol className="list-decimal space-y-2 pl-4 text-sm sm:pl-5">
                  <li>
                    Abra o App Store Connect, entre em <strong>Apps</strong>, clique em{' '}
                    <strong>+</strong> e depois em <strong>Novo app</strong>.{' '}
                    <a
                      href="https://appstoreconnect.apple.com/apps"
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground inline-flex items-center gap-1 font-medium underline"
                    >
                      Abrir o App Store Connect
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </li>
                  <li className="space-y-1.5">
                    <span>Preencha assim:</span>
                    {/*
                      No celular, o nome do campo vai em cima do valor: lado a
                      lado, o identificador quebrava no meio, numa coluna estreita.
                    */}
                    <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr] sm:items-center sm:gap-y-1.5">
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">Plataforma</dt>
                      <dd>iOS</dd>
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">Nome</dt>
                      <dd>
                        <LinhaCopiavel valor={nomeDoApp} />
                      </dd>
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">Idioma principal</dt>
                      <dd>Português (Brasil)</dd>
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">ID do pacote</dt>
                      <dd>
                        <LinhaCopiavel valor={identificador} monoespacado />
                      </dd>
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">SKU</dt>
                      <dd>
                        <LinhaCopiavel valor={identificador} monoespacado />
                      </dd>
                      <dt className="text-muted-foreground pt-1.5 sm:pt-0">Acesso</dt>
                      <dd>Acesso total</dd>
                    </dl>
                    <p className="text-muted-foreground text-xs">
                      Se o identificador não aparecer na lista &quot;ID do pacote&quot;,{' '}
                      {podeEscrever ? (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-xs"
                          disabled={processando}
                          onClick={registrar}
                        >
                          registre-o de novo na sua conta Apple
                        </Button>
                      ) : (
                        'peça a um proprietário ou administrador para registrá-lo de novo'
                      )}{' '}
                      e recarregue a página da Apple. Se a Apple disser que o nome já existe, use
                      uma variação: o nome embaixo do ícone continua sendo o do app.
                    </p>
                  </li>
                  <li>Clique em Criar, volte aqui e confira.</li>
                </ol>
                {podeEscrever ? (
                  <Button type="button" disabled={processando} onClick={conferir}>
                    {processando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Já criei o app
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Um proprietário ou administrador confere o app criado.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {identificador === null ? null : (
          <p className="text-muted-foreground text-sm">
            No Google Play, o identificador entra no primeiro envio, que é feito à mão uma vez — o
            passo a passo aparece aqui quando o arquivo estiver pronto.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
