'use client';

/**
 * Links da loja abrindo no app (parte da C12, checklist 5.7).
 *
 * Quem tem o app e toca num link da loja — no e-mail, no WhatsApp, num anúncio
 * — cai direto no app, na página certa. Para isso o domínio da loja precisa
 * publicar que aceita o app; numa loja Shopify, quem publica é a Shopify, a
 * partir do cadastro que este cartão manda fazer. Fora dela, o lojista publica
 * os dois arquivos que o cartão entrega prontos.
 *
 * O que ainda falta é dito por plataforma, com o caminho para resolver: um
 * botão que não faz nada é o que a regra 3 proíbe.
 */
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ArquivosDeAssociacao, SituacaoDoLink, SituacaoDosLinks } from '@/lib/links-do-app';
import { LinhaCopiavel } from '@/components/linha-copiavel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { salvarImpressoesDoAndroid, vincularLinksDaLoja } from './acoes';

export function LinksDaLoja({
  situacao,
  plataformaDaLoja,
  dominio,
  impressoes,
  erro,
  arquivos,
  vinculadoEm,
  podeEscrever,
}: {
  situacao: SituacaoDosLinks;
  plataformaDaLoja: 'shopify' | 'other';
  /** O domínio da loja, sem `https://`. */
  dominio: string;
  impressoes: readonly string[];
  /** O que a Shopify respondeu na última tentativa que falhou. */
  erro: string | null;
  /** Os arquivos para publicar, quando a loja não é Shopify. */
  arquivos: ArquivosDeAssociacao | null;
  /** As datas de vínculo, já no fuso da loja. */
  vinculadoEm: { ios: string | null; android: string | null };
  podeEscrever: boolean;
}) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [texto, setTexto] = useState(impressoes.join('\n'));
  const shopify = plataformaDaLoja === 'shopify';
  const jaVinculou = situacao.ios.estado === 'vinculado' || situacao.android.estado === 'vinculado';

  function vincular() {
    iniciar(async () => {
      const resultado = await vincularLinksDaLoja();
      if (resultado.ok === true) toast.success(resultado.mensagem ?? 'Links vinculados.');
      else toast.error(resultado.mensagem ?? 'Não foi possível vincular os links.');
      router.refresh();
    });
  }

  function salvar() {
    iniciar(async () => {
      const resultado = await salvarImpressoesDoAndroid(texto);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Impressão digital salva.');
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível salvar.');
      }
    });
  }

  return (
    <Card role="region" aria-labelledby="links-da-loja">
      <CardHeader>
        <CardTitle id="links-da-loja" className="flex items-center gap-2 text-base">
          <Link2 className="size-4" aria-hidden />
          Links da loja abrindo no app
        </CardTitle>
        <CardDescription>
          Quem tem o app e toca num link de {dominio === '' ? 'sua loja' : dominio} — no e-mail, no
          WhatsApp, num anúncio — cai direto no app, na página certa.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {situacao.bloqueio === null ? null : (
          <div className="bg-muted/50 space-y-2 rounded-lg border p-3 text-sm">
            <p>{situacao.bloqueio.motivo}</p>
            {situacao.bloqueio.tipo === 'aguardando-shopify' ? null : (
              <Button asChild size="sm" variant="outline">
                <Link href="/integracoes">Ir para Integrações</Link>
              </Button>
            )}
          </div>
        )}

        <ul className="divide-y rounded-lg border">
          <LinhaDaPlataforma
            nome="iPhone"
            recurso="Universal Links"
            situacao={situacao.ios}
            data={vinculadoEm.ios}
            shopify={shopify}
          />
          <LinhaDaPlataforma
            nome="Android"
            recurso="App Links"
            situacao={situacao.android}
            data={vinculadoEm.android}
            shopify={shopify}
          />
        </ul>

        {erro === null ? null : (
          <p className="text-destructive text-sm" role="alert">
            Última tentativa: {erro}
          </p>
        )}

        {shopify && podeEscrever && situacao.podeVincular ? (
          <Button type="button" size="sm" onClick={vincular} disabled={enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {jaVinculou ? 'Vincular de novo' : 'Vincular agora'}
          </Button>
        ) : null}

        {podeEscrever ? (
          <div className="space-y-2">
            <Label htmlFor="impressoes-do-android">
              Impressão digital do certificado do Android (SHA-256)
            </Label>
            <Textarea
              id="impressoes-do-android"
              value={texto}
              rows={2}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="14:6D:E9:…:44:E5"
              onChange={(evento) => {
                setTexto(evento.target.value);
              }}
            />
            <p className="text-muted-foreground text-xs">
              No Play Console, abra o app e vá em{' '}
              <strong>Integridade do app › Assinatura de apps</strong>. Copie a impressão digital
              SHA-256 da chave de assinatura do app. Uma por linha.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={salvar} disabled={enviando}>
              Salvar impressão
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Apenas proprietários e administradores mudam os links do app.
          </p>
        )}

        {arquivos === null ? null : <ArquivosParaPublicar arquivos={arquivos} dominio={dominio} />}
      </CardContent>
    </Card>
  );
}

function LinhaDaPlataforma({
  nome,
  recurso,
  situacao,
  data,
  shopify,
}: {
  nome: string;
  recurso: string;
  situacao: SituacaoDoLink;
  data: string | null;
  shopify: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          {nome} <span className="text-muted-foreground font-normal">· {recurso}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          {situacao.estado === 'falta'
            ? situacao.motivo
            : situacao.estado === 'vinculado'
              ? `A Shopify publica os links desde ${data ?? '—'}.`
              : shopify
                ? 'Tudo pronto para vincular.'
                : 'Pronto: publique o arquivo abaixo no seu site.'}
        </p>
      </div>
      <Badge
        variant={situacao.estado === 'vinculado' ? 'default' : 'secondary'}
        className="shrink-0 font-normal"
      >
        {situacao.estado === 'vinculado'
          ? 'Vinculado'
          : situacao.estado === 'pronto'
            ? 'Pronto'
            : 'Falta'}
      </Badge>
    </li>
  );
}

function ArquivosParaPublicar({
  arquivos,
  dominio,
}: {
  arquivos: ArquivosDeAssociacao;
  dominio: string;
}) {
  const base = dominio === '' ? '' : `https://${dominio}`;
  return (
    <div className="space-y-3 border-t pt-4 text-sm">
      <p className="text-muted-foreground">
        A sua loja não é Shopify, então os dois arquivos abaixo precisam ser publicados no seu site,
        exatamente nestes endereços, como JSON e sem redirecionamento.
      </p>
      {arquivos.apple === null && arquivos.android === null ? (
        <p className="text-muted-foreground">
          Os arquivos aparecem aqui quando o que falta em cada plataforma for resolvido.
        </p>
      ) : null}
      {arquivos.apple === null ? null : (
        <div className="space-y-1.5">
          <p className="font-medium break-all">{base}/.well-known/apple-app-site-association</p>
          <LinhaCopiavel valor={arquivos.apple} monoespacado />
        </div>
      )}
      {arquivos.android === null ? null : (
        <div className="space-y-1.5">
          <p className="font-medium break-all">{base}/.well-known/assetlinks.json</p>
          <LinhaCopiavel valor={arquivos.android} monoespacado />
        </div>
      )}
    </div>
  );
}
