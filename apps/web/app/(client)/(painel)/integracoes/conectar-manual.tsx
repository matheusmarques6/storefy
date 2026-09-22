'use client';

/**
 * Conectar pelo app da própria loja (C14).
 *
 * PARA QUEM ISTO SERVE — e não é para todo mundo, o que a tela precisa dizer
 * em voz alta, porque já não dizia:
 *
 *   quem tem um app antigo criado dentro do admin da loja, com um token
 *   `shpat_` à mão. A Shopify não deixa mais criar um desses, mas os que
 *   existem continuam valendo;
 *
 *   quem conecta uma loja de teste que vive na MESMA organização da Shopify
 *   que o app.
 *
 * Para a loja real de um lojista, `client_credentials` responde
 * `shop_not_permitted` por mais certas que estejam as credenciais. Quem
 * conecta essa loja é o OAuth, e por isso ele vem antes na tela quando existe.
 *
 * O PASSO A PASSO É PARTE DO PRODUTO, e não enfeite. O lojista que chega aqui
 * não sabe o que é Client ID, e mandá-lo "criar um app personalizado" sem
 * dizer onde é a diferença entre conectar em cinco minutos e abrir um chamado
 * no suporte. Os passos abrem sozinhos só quando este é o caminho principal e
 * a loja ainda não conectou: embaixo de um botão que funciona, ou para quem já
 * conectou e só voltou para reconectar, um passo a passo aberto é ruído em
 * cima de uma decisão já tomada.
 */
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { conferirDominioDigitado, rotuloDoEscopo, type SituacaoDaShopify } from '@/lib/integracoes';
import { conectarShopifyManual, type EstadoDaIntegracao } from './acoes';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';

/** Os escopos que o app do lojista precisa ter, na ordem em que ele marca. */
const ESCOPOS = ['read_products', 'read_orders', 'read_customers', 'read_fulfillments'];

export function ConectarManual({
  situacao,
  conectada,
  alternativo,
}: {
  situacao: SituacaoDaShopify;
  conectada: boolean;
  /** O OAuth está na tela e veio antes, então este aqui é o plano B. */
  alternativo: boolean;
}) {
  const router = useRouter();
  const [dominio, setDominio] = useState(situacao.dominio);
  const [erroDoDominio, setErroDoDominio] = useState<string | undefined>(undefined);
  const [passosAbertos, setPassosAbertos] = useState(!conectada && !alternativo);

  const [estado, enviar, enviando] = useActionState<EstadoDaIntegracao, FormData>(
    async (anterior, dados) => {
      const resultado = await conectarShopifyManual(anterior, dados);

      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Loja conectada.');
        router.refresh();
      } else if (resultado.mensagem != null) {
        toast.error(resultado.mensagem);
      }
      return resultado;
    },
    {},
  );

  return (
    <div className={alternativo ? 'space-y-4 border-t pt-4' : 'space-y-4'}>
      {alternativo ? (
        <p className="text-muted-foreground text-sm">
          Ou conecte pelo app da sua própria loja. Serve em dois casos: se você já tem um app com
          token de acesso da Admin API, ou se esta é uma loja de teste da mesma organização do app.
        </p>
      ) : null}

      <div className="border-input rounded-lg border">
        <button
          type="button"
          onClick={() => {
            setPassosAbertos((aberto) => !aberto);
          }}
          aria-expanded={passosAbertos}
          className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
        >
          Quando usar este caminho, e onde achar as credenciais
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${passosAbertos ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {passosAbertos ? <Passos /> : null}
      </div>

      <form action={enviar} className="space-y-4" noValidate>
        <Campo
          id="dominio"
          rotulo="Endereço da sua loja na Shopify"
          erro={erroDoDominio}
          dica="É o endereço que termina em .myshopify.com, o mesmo que aparece quando você entra no admin da Shopify."
        >
          <Input
            {...propsDoCampo('dominio', erroDoDominio, true)}
            value={dominio}
            onChange={(evento) => {
              setDominio(evento.target.value);
              setErroDoDominio(undefined);
            }}
            onBlur={() => {
              if (dominio.trim() === '') return;
              const conferido = conferirDominioDigitado(dominio);
              setErroDoDominio(conferido.ok ? undefined : conferido.erro);
            }}
            placeholder="minha-loja.myshopify.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Campo>

        <Campo id="clientId" rotulo="Client ID" dica="No app que você criou, em Configurações.">
          <Input
            {...propsDoCampo('clientId', undefined, true)}
            defaultValue={situacao.clientId ?? ''}
            placeholder="Cole aqui"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-sm"
          />
        </Campo>

        <Campo
          id="clientSecret"
          rotulo="Client Secret"
          dica="Fica logo abaixo do Client ID. Guardamos criptografado, e ele nunca volta para esta tela."
        >
          <Input
            {...propsDoCampo('clientSecret', undefined, true)}
            type="password"
            placeholder={conectada ? 'Cole de novo para reconectar' : 'Cole aqui'}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-sm"
          />
        </Campo>

        <Campo
          id="token"
          rotulo="Token de acesso da Admin API (só se o seu app mostrar um)"
          dica="O app criado dentro do admin da loja mostra um token que começa com shpat_. O criado no painel de desenvolvedor não mostra nenhum — nesse caso, deixe em branco."
        >
          <Input
            {...propsDoCampo('token', undefined, true)}
            type="password"
            placeholder="Deixe em branco se não tiver"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-sm"
          />
        </Campo>

        {/*
         * O erro fica na tela ALÉM do toast: o toast some sozinho, e a
         * mensagem daqui costuma ser uma instrução ("faltam permissões no
         * app") que a pessoa precisa reler enquanto conserta na Shopify.
         */}
        {estado.ok !== true && estado.mensagem != null ? (
          <p className="text-destructive text-sm" role="alert">
            {estado.mensagem}
          </p>
        ) : null}

        <Button type="submit" disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {conectada ? 'Reconectar' : 'Conectar loja'}
        </Button>
      </form>
    </div>
  );
}

function Passos() {
  return (
    <div className="text-muted-foreground space-y-4 border-t p-3 text-sm">
      <p>
        Este caminho serve a <strong>dois casos</strong>. Se nenhum for o seu, use o botão{' '}
        <strong>Conectar com a Shopify</strong> — ele funciona em qualquer loja e não exige criar
        nada.
      </p>

      <div>
        <p className="text-foreground font-medium">
          1. Você já tem um app criado dentro do admin da loja
        </p>
        <p className="mt-1">
          Em <strong>Configurações › Apps e canais de venda › Desenvolver apps</strong>. Abra o app
          e, em <strong>Credenciais da API</strong>, copie as três coisas: o{' '}
          <strong>token de acesso da Admin API</strong> (começa com{' '}
          <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">shpat_</code>), o{' '}
          <strong>Client ID</strong> e o <strong>Client Secret</strong>. Neste caso os três campos
          abaixo são necessários.
        </p>
        <p className="mt-1">
          A Shopify não deixa mais criar apps assim. Os que já existem continuam valendo, mas se
          você não tem um, este caso não é o seu.
        </p>
      </div>

      <div>
        <p className="text-foreground font-medium">
          2. Esta é uma loja de teste, da mesma organização do app
        </p>
        <p className="mt-1">
          App criado no{' '}
          <a
            href="https://dev.shopify.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
          >
            painel de apps da Shopify
            <ExternalLink className="size-3" aria-hidden />
          </a>
          , com a loja aparecendo em <strong>Dev stores</strong>, na barra lateral da mesma
          organização. Aqui bastam o <strong>Client ID</strong> e o <strong>Client Secret</strong>;
          deixe o token em branco.
        </p>
        <p className="mt-1">
          Se a loja não estiver nessa lista, a Shopify recusa com{' '}
          <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
            shop_not_permitted
          </code>
          , por mais certas que as credenciais estejam — ser dono da loja não a coloca na
          organização, e instalar o app nela também não.
        </p>
      </div>

      <div>
        <p className="text-foreground font-medium">Permissões, nos dois casos</p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {ESCOPOS.map((escopo) => (
            <li
              key={escopo}
              className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs"
            >
              {escopo}
            </li>
          ))}
        </ul>
        <p className="mt-2">
          Em português aparecem como: {ESCOPOS.map(rotuloDoEscopo).join(', ')}. Não precisa de
          nenhuma permissão de escrita.
        </p>
      </div>
    </div>
  );
}
