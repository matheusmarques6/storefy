'use client';

/**
 * O cartão da Shopify na tela de Integrações (C14).
 *
 * DOIS CAMINHOS PARA A MESMA COISA, e a ordem em que aparecem não é estética.
 * Ela já esteve invertida, com uma premissa errada escrita aqui para
 * justificá-la — a de que o app da própria loja "funciona em qualquer loja":
 *
 *   o app público da Storefy (OAuth) é o único que conecta a loja REAL de um
 *   lojista. Vem primeiro sempre que existe;
 *
 *   o app da própria loja alcança só a loja que está na MESMA organização da
 *   Shopify que ele, ou um app antigo do admin da loja, que já vem com token
 *   pronto. Na loja real do lojista a Shopify responde `shop_not_permitted`,
 *   e foi assim que isto apareceu: a tela oferecia primeiro o único caminho
 *   que não tinha como funcionar ali.
 *
 * Enquanto o app público não está aprovado, o botão não aparece e o caminho
 * manual fica sendo o único — oferecer um caminho que não funciona é pior do
 * que não oferecer, porque manda a pessoa tentar e falhar.
 *
 * O formulário do OAuth é um POST de verdade para `/api/shopify/install`: sem
 * JavaScript ele continua funcionando, e o servidor confere o domínio de novo.
 * A conferência daqui existe só para o lojista corrigir na hora, em vez de
 * descobrir o erro depois de uma ida e volta à Shopify.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Link2Off, Loader2, Store, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { conferirDominioDigitado, rotuloDoEscopo, type SituacaoDaShopify } from '@/lib/integracoes';
import { desconectarShopify } from './acoes';
import { ConectarManual } from './conectar-manual';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function CartaoShopify({
  situacao,
  podeEscrever,
}: {
  situacao: SituacaoDaShopify;
  podeEscrever: boolean;
}) {
  const conectada = situacao.estado === 'conectada' || situacao.estado === 'escopos_faltando';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Store className="size-4" aria-hidden />
            Shopify
          </CardTitle>
          <Selo situacao={situacao} />
        </div>
        <CardDescription>
          É a conexão que diz quanto o app vendeu. Sem ela, o painel mostra instalações e aberturas,
          mas não consegue separar o pedido que veio do app do que veio do site.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {situacao.estado === 'sem_loja' ? (
          <p className="text-muted-foreground text-sm">
            A conexão é por loja. Cadastre uma loja para conectá-la à Shopify.
          </p>
        ) : (
          <>
            {conectada ? <Conectada situacao={situacao} /> : null}
            {situacao.estado === 'escopos_faltando' ? (
              <Faltando escopos={situacao.faltando} />
            ) : null}

            {podeEscrever ? (
              <>
                {situacao.oauthDisponivel ? (
                  <>
                    <Formulario situacao={situacao} conectada={conectada} />
                    <ConectarManual situacao={situacao} conectada={conectada} alternativo />
                  </>
                ) : (
                  <ConectarManual situacao={situacao} conectada={conectada} alternativo={false} />
                )}

                {conectada ? <Desconectar /> : null}
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                Só o proprietário e os administradores mexem nesta conexão.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Selo({ situacao }: { situacao: SituacaoDaShopify }) {
  /*
   * Sem loja não há selo: "não conectada" diria que falta um passo que não
   * existe.
   */
  if (situacao.estado === 'sem_loja') return null;

  if (situacao.estado === 'conectada') {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="size-3" aria-hidden />
        Conectada
      </Badge>
    );
  }
  if (situacao.estado === 'escopos_faltando') {
    return (
      <Badge variant="outline" className="gap-1">
        <TriangleAlert className="size-3" aria-hidden />
        Permissões a menos
      </Badge>
    );
  }
  return <Badge variant="outline">Não conectada</Badge>;
}

function Conectada({ situacao }: { situacao: SituacaoDaShopify }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">Loja</dt>
        <dd className="mt-1 font-mono text-xs break-words">{situacao.dominio}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Conectada por</dt>
        <dd className="mt-1">
          {situacao.caminho === 'manual' ? (
            <>
              App da sua loja
              {situacao.clientId == null ? null : (
                <span className="text-muted-foreground mt-0.5 block font-mono text-xs break-all">
                  {situacao.clientId}
                </span>
              )}
            </>
          ) : (
            'App da Storefy'
          )}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Permissões concedidas</dt>
        <dd className="mt-1 flex flex-wrap gap-1">
          {situacao.concedidos.length === 0 ? (
            <span className="text-muted-foreground">A Shopify não informou.</span>
          ) : (
            situacao.concedidos.map((escopo) => (
              <Badge key={escopo} variant="secondary" className="font-normal">
                {rotuloDoEscopo(escopo)}
              </Badge>
            ))
          )}
        </dd>
      </div>
    </dl>
  );
}

function Faltando({ escopos }: { escopos: string[] }) {
  return (
    <div className="border-input rounded-lg border p-3 text-sm">
      <p className="font-medium">Faltou liberar: {escopos.map(rotuloDoEscopo).join(', ')}.</p>
      <p className="text-muted-foreground mt-1">
        Clique em reconectar e aceite todas as permissões na tela da Shopify.
      </p>
    </div>
  );
}

/**
 * O caminho do app público da Storefy (OAuth), e o principal.
 *
 * Só aparece quando o app está aprovado: sem isso, o botão mandaria o lojista
 * a uma tela da Shopify que responde com erro, e ele leria isso como "a
 * Storefy está quebrada" em vez de "este caminho ainda não existe". Quando
 * aparece, vem antes de tudo — é o único que conecta a loja real dele.
 */
function Formulario({ situacao, conectada }: { situacao: SituacaoDaShopify; conectada: boolean }) {
  const [dominio, setDominio] = useState(situacao.dominio);
  const [erro, setErro] = useState<string | undefined>(undefined);

  return (
    <form
      method="post"
      action="/api/shopify/install"
      className="space-y-4"
      noValidate
      onSubmit={(evento) => {
        const conferido = conferirDominioDigitado(dominio);
        if (!conferido.ok) {
          evento.preventDefault();
          setErro(conferido.erro);
          return;
        }
        setErro(undefined);
      }}
    >
      <p className="text-muted-foreground text-sm">
        Você autoriza na própria Shopify e pronto — não precisa criar nada lá. É o caminho que
        funciona em qualquer loja.
      </p>

      <Campo
        id="shop"
        rotulo="Endereço da sua loja na Shopify"
        erro={erro}
        dica="É o endereço que termina em .myshopify.com, o mesmo que aparece quando você entra no admin da Shopify."
      >
        <Input
          {...propsDoCampo('shop', erro, true)}
          value={dominio}
          onChange={(evento) => {
            setDominio(evento.target.value);
            setErro(undefined);
          }}
          placeholder="minha-loja.myshopify.com"
          autoComplete="off"
          spellCheck={false}
        />
      </Campo>

      <Button type="submit" variant="outline">
        {conectada ? 'Reconectar pelo app da Storefy' : 'Conectar com a Shopify'}
      </Button>
    </form>
  );
}

/**
 * Desconectar, fora dos dois formulários.
 *
 * Ficava dentro do formulário do OAuth, e ali ele sumiria junto com ele
 * enquanto o app público não existe — deixando quem conectou pelo app próprio
 * sem como desconectar.
 */
function Desconectar() {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [desconectando, iniciar] = useTransition();

  function desconectar() {
    iniciar(async () => {
      const resultado = await desconectarShopify();
      setConfirmando(false);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Loja desconectada.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível desconectar.');
      }
    });
  }

  return (
    <div className="border-t pt-4">
      <Button
        type="button"
        variant="outline"
        disabled={desconectando}
        onClick={() => {
          setConfirmando(true);
        }}
      >
        {desconectando ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Link2Off className="size-4" aria-hidden />
        )}
        Desconectar
      </Button>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar a Shopify?</AlertDialogTitle>
            <AlertDialogDescription>
              O painel para de receber os pedidos desta loja, e a receita do app deixa de ser
              contada a partir de agora. Os números que já estão aqui continuam. Dá para reconectar
              quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={desconectando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(evento) => {
                evento.preventDefault();
                desconectar();
              }}
              disabled={desconectando}
            >
              {desconectando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
