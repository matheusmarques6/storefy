/** Integrações da loja (C14). */
import type { Metadata } from 'next';
import { AlertCircle, CheckCircle2, TriangleAlert } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { avisoDaShopify, situacaoDaShopify } from '@/lib/integracoes';
import { escoposPedidos, shopifyConfigurado } from '@/lib/shopify-servidor';
import { appDaLoja, chaveDoWebhook, listarAutomacoes } from '@/lib/push-servidor';
import { criarClientServidor } from '@/lib/supabase/server';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CartaoShopify } from './cartao-shopify';
import { CartaoDasFerramentasDeMarketing, CartaoDoMetaPixel } from './outras-integracoes';

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
    caminho: lojaAtiva?.shopify_conexao ?? null,
    clientId: lojaAtiva?.shopify_client_id ?? null,
  });

  const aviso = avisoDaShopify(shopify);
  const ferramentas = lojaAtiva == null ? null : await ferramentasDaLoja(lojaAtiva.id);

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

      {ferramentas == null || lojaAtiva == null ? null : (
        <CartaoDasFerramentasDeMarketing
          chave={ferramentas.chave}
          ligada={ferramentas.ligada}
          fuso={lojaAtiva.timezone}
        />
      )}

      <CartaoDoMetaPixel />
    </div>
  );
}

/** A chave do webhook e se a automação dele está ligada, no app da loja. */
async function ferramentasDaLoja(storeId: string) {
  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, storeId);
  if (app == null) return null;

  const [chave, automacoes] = await Promise.all([
    chaveDoWebhook(supabase, app.id),
    listarAutomacoes(supabase, app.id),
  ]);
  return {
    chave,
    ligada: automacoes.some(
      (automacao) => automacao.type === 'custom_webhook' && automacao.enabled,
    ),
  };
}
