/**
 * As integrações da C14 além da Shopify.
 *
 * KLAVIYO E OMNISEND: a conexão mora na automação "Klaviyo, Omnisend e outras
 * ferramentas" (C09), porque é lá que ficam a chave, o texto e a chave de
 * liga e desliga. Aqui o lojista vê se está funcionando e vai para lá — duas
 * telas gerando a mesma chave seriam duas chaves, e uma desfaz a outra.
 *
 * META PIXEL: não há o que conectar. O app abre as páginas da loja — checkout
 * incluído — com os mesmos scripts do site, e o pixel que a loja já tem
 * registra o que acontece no app. O cartão responde a pergunta que todo
 * lojista que anuncia faz, e não tem botão porque não há ação.
 */
import Link from 'next/link';
import { CheckCircle2, Megaphone, TriangleAlert, Workflow } from 'lucide-react';
import { formatarDataHora } from '@/lib/fuso';
import type { ChaveDoWebhook } from '@/lib/push-servidor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function CartaoDasFerramentasDeMarketing({
  chave,
  ligada,
  fuso,
}: {
  chave: ChaveDoWebhook | null;
  ligada: boolean;
  fuso: string;
}) {
  return (
    <Card role="region" aria-labelledby="integracao-ferramentas">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id="integracao-ferramentas" className="flex items-center gap-2 text-base">
            <Workflow className="size-4" aria-hidden />
            Klaviyo, Omnisend e outras ferramentas
          </CardTitle>
          {chave === null ? (
            <Badge variant="outline">Não conectada</Badge>
          ) : ligada ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden />
              Ligada
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <TriangleAlert className="size-3" aria-hidden />
              Desligada
            </Badge>
          )}
        </div>
        <CardDescription>
          Os fluxos que você já montou para o e-mail também avisam pelo app: carrinho abandonado,
          pós-compra, reativação. A ferramenta chama a Storefy, e quem tem o app recebe o push.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm">
          {chave === null
            ? 'A conexão é feita na automação, onde você gera a chave para colar na ferramenta.'
            : !ligada
              ? 'A chave existe, mas a automação está desligada: nenhum push sai até você ligá-la.'
              : chave.ultimoAviso === null
                ? 'Nenhum aviso recebido da ferramenta ainda.'
                : `Último aviso recebido em ${formatarDataHora(chave.ultimoAviso, fuso)}.`}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/push/automacoes#automacao-custom_webhook">
            {chave === null ? 'Conectar na automação' : 'Abrir a automação'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function CartaoDoMetaPixel() {
  return (
    <Card role="region" aria-labelledby="integracao-pixel">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id="integracao-pixel" className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" aria-hidden />
            Meta Pixel (Facebook e Instagram)
          </CardTitle>
          <Badge variant="secondary">Nada a configurar</Badge>
        </div>
        <CardDescription>
          O app abre as páginas da sua loja, checkout incluído, com os mesmos recursos do site. O
          pixel que você já usa — pelo canal Facebook e Instagram da Shopify ou pelo tema — registra
          as visitas, os carrinhos e as compras feitas pelo app, como faz no site.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Se a loja ainda não tem o pixel, instale o canal Facebook e Instagram na Shopify: ele
          passa a valer no site e no app ao mesmo tempo.
        </p>
      </CardContent>
    </Card>
  );
}
