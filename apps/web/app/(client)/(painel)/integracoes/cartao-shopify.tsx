'use client';

/**
 * O cartão da Shopify na tela de Integrações (C14).
 *
 * O formulário é um POST de verdade para `/api/shopify/install`: sem
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
        {situacao.estado === 'nao_configurado' ? (
          <p className="text-muted-foreground text-sm">
            A Storefy ainda está terminando de configurar o app da Shopify. Assim que ficar pronto,
            o botão de conectar aparece aqui — nada do que você já fez se perde.
          </p>
        ) : situacao.estado === 'sem_loja' ? (
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
              <Formulario situacao={situacao} conectada={conectada} />
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
   * existe. E quando quem ainda não terminou é a Storefy, o selo diz isso —
   * "não conectada" jogaria no lojista uma pendência que não é dele.
   */
  if (situacao.estado === 'sem_loja') return null;
  if (situacao.estado === 'nao_configurado') return <Badge variant="outline">Em preparação</Badge>;

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

function Formulario({ situacao, conectada }: { situacao: SituacaoDaShopify; conectada: boolean }) {
  const router = useRouter();
  const [dominio, setDominio] = useState(situacao.dominio);
  const [erro, setErro] = useState<string | undefined>(undefined);
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
    <>
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
        <Campo
          id="shop"
          rotulo="Endereço da sua loja na Shopify"
          erro={erro}
          dica="É o endereço que termina em .myshopify.com, o mesmo que aparece quando você entra no admin da Shopify."
        >
          <Input
            {...propsDoCampo('shop', erro)}
            value={dominio}
            onChange={(evento) => {
              setDominio(evento.target.value);
            }}
            placeholder="minha-loja.myshopify.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Campo>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">{conectada ? 'Reconectar' : 'Conectar com a Shopify'}</Button>
          {conectada ? (
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
          ) : null}
        </div>
      </form>

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
    </>
  );
}
