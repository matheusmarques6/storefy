'use client';

/**
 * Conectar pelo app que o lojista cria na conta Shopify dele (C14).
 *
 * Este é o caminho que funciona HOJE: o app público da Storefy depende de uma
 * revisão da Shopify que leva semanas, e sem ela nenhuma loja conectaria.
 *
 * O PASSO A PASSO É PARTE DO PRODUTO, e não enfeite. O lojista que chega aqui
 * não sabe o que é Client ID, e mandá-lo "criar um app personalizado" sem
 * dizer onde é a diferença entre conectar em cinco minutos e abrir um chamado
 * no suporte. Os passos estão abertos por padrão enquanto ele não conectou, e
 * fechados depois — quem já conectou volta aqui para reconectar, não para ler
 * de novo.
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
}: {
  situacao: SituacaoDaShopify;
  conectada: boolean;
}) {
  const router = useRouter();
  const [dominio, setDominio] = useState(situacao.dominio);
  const [erroDoDominio, setErroDoDominio] = useState<string | undefined>(undefined);
  const [passosAbertos, setPassosAbertos] = useState(!conectada);

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
    <div className="space-y-4">
      <div className="border-input rounded-lg border">
        <button
          type="button"
          onClick={() => {
            setPassosAbertos((aberto) => !aberto);
          }}
          aria-expanded={passosAbertos}
          className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
        >
          Como pegar o Client ID e o Client Secret
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
    <ol className="text-muted-foreground list-decimal space-y-3 border-t p-3 pl-7 text-sm">
      <li>
        Entre no{' '}
        <a
          href="https://dev.shopify.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="text-foreground inline-flex items-center gap-1 underline underline-offset-2"
        >
          painel de apps da Shopify
          <ExternalLink className="size-3" aria-hidden />
        </a>{' '}
        com a conta da sua loja e crie um app. O nome pode ser <strong>Storefy</strong>.
      </li>
      <li>
        Em <strong>Configuração</strong>, marque estas permissões de leitura:
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
        <span className="mt-2 block">
          Em português aparecem como: {ESCOPOS.map(rotuloDoEscopo).join(', ')}. Não precisa de
          nenhuma permissão de escrita.
        </span>
      </li>
      <li>
        Clique em <strong>Instalar app</strong> e escolha a sua loja. Sem instalar, as credenciais
        existem mas não abrem nada.
      </li>
      <li>
        Ainda em <strong>Configurações</strong>, copie o <strong>Client ID</strong> e o{' '}
        <strong>Client Secret</strong> e cole nos campos abaixo.
      </li>
    </ol>
  );
}
