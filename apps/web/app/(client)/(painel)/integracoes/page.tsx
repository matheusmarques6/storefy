/** Integrações da loja (C14). */
import type { Metadata } from 'next';
import { AlertCircle, CheckCircle2, TriangleAlert } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { avisoDaShopify, situacaoDaShopify } from '@/lib/integracoes';
import { escoposPedidos, shopifyConfigurado } from '@/lib/shopify-servidor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CartaoShopify } from './cartao-shopify';

export const metadata: Metadata = { title: 'Integrações' };

export default async function PaginaDeIntegracoes({
  searchParams,
}: {
  searchParams: Promise<{ shopify?: string }>;
}) {
  const { lojaAtiva, papel } = await exigirContextoCliente();
  const { shopify } = await searchParams;

  const situacao = situacaoDaShopify({
    configurado: shopifyConfigurado(),
    temLoja: lojaAtiva != null,
    shopDomain: lojaAtiva?.shop_domain ?? null,
    escopos: lojaAtiva?.shopify_scopes ?? null,
    escoposPedidos: escoposPedidos(),
  });

  const aviso = avisoDaShopify(shopify);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Conexões com as ferramentas que a sua loja já usa. Cada uma vale para a loja selecionada
          agora.
        </p>
      </div>

      {aviso == null ? null : (
        <Alert
          variant={aviso.tom === 'erro' ? 'destructive' : 'info'}
          // O aviso aparece depois de uma navegação de volta da Shopify: sem
          // isto o leitor de tela não anuncia nada, e a pessoa fica sem saber
          // se a conexão deu certo.
          role="status"
          aria-live="polite"
        >
          {aviso.tom === 'sucesso' ? (
            <CheckCircle2 aria-hidden />
          ) : aviso.tom === 'atencao' ? (
            <TriangleAlert aria-hidden />
          ) : (
            <AlertCircle aria-hidden />
          )}
          <AlertTitle>{aviso.titulo}</AlertTitle>
          <AlertDescription>{aviso.texto}</AlertDescription>
        </Alert>
      )}

      <CartaoShopify situacao={situacao} podeEscrever={papel === 'owner' || papel === 'admin'} />
    </div>
  );
}
