/** Detalhe e edição de uma loja. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { blocoDaLoja } from '@storefy/config-schema';
import { ROTULO_STATUS_LOJA, podeEscrever, podeExcluir } from '@storefy/db';
import { COLUNAS_DA_LOJA } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { versaoPublicada } from '@/lib/configs-servidor';
import { diferencasDosDadosDaLoja } from '@/lib/diferencas-da-config';
import { criarClientServidor } from '@/lib/supabase/server';
import { gruposDeFusos, nomeDoFuso } from '@/lib/fuso';
import { editarLoja } from '../acoes';
import { FormularioLoja } from '../formulario-loja';
import { ExcluirLoja } from './excluir-loja';
import { AbrirEditorDaLoja } from './abrir-editor-da-loja';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { lido } from '@/lib/leitura';
import { ehUuid } from '@/lib/app-config-publica';

export const metadata: Metadata = { title: 'Loja' };

export default async function PaginaLoja({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ salva?: string }>;
}) {
  const { id } = await params;
  // Endereço que não é de loja nenhuma é 404, e não erro do banco.
  if (!ehUuid(id)) notFound();
  const avisos = await searchParams;
  const { papel, lojaAtiva } = await exigirContextoCliente();

  const supabase = await criarClientServidor();
  // A RLS já limita ao que a organização do usuário pode ver: uma loja de outra
  // empresa simplesmente não é encontrada, e vira 404.
  // `COLUNAS_DA_LOJA` e não `*`: o token da Shopify não é legível pelo painel.
  const { data: loja } = lido(
    await supabase.from('stores').select(COLUNAS_DA_LOJA).eq('id', id).maybeSingle(),
    'a loja',
  );

  if (loja == null) notFound();

  const podeEditar = podeEscrever(papel);

  /*
   * O app no ar leva os dados da loja da última publicação. Mudar o nome ou o
   * endereço aqui muda o rascunho — e os clientes seguem com os antigos (o
   * endereço velho, que pode nem existir mais) até alguém publicar.
   */
  const { data: app } = lido(
    await supabase.from('apps').select('id').eq('store_id', loja.id).maybeSingle(),
    'o app da loja',
  );
  const noAr = app == null ? null : await versaoPublicada(supabase, app.id);
  const foraDoAr =
    noAr?.config == null
      ? []
      : diferencasDosDadosDaLoja(
          noAr.config.store,
          blocoDaLoja({
            name: loja.name,
            url: loja.primary_url,
            shopDomain: loja.shop_domain,
            platform: loja.platform,
          }),
        );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/lojas"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para lojas
      </Link>

      {avisos.salva === '1' ? (
        <Alert variant="info">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Alterações salvas.</AlertDescription>
        </Alert>
      ) : null}

      {noAr === null || foraDoAr.length === 0 ? null : (
        <Alert variant="warning">
          <AlertTriangle aria-hidden />
          <AlertTitle>O app no ar ainda usa os dados antigos da loja</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Os clientes seguem com o que foi publicado na versão {noAr.version}. Publique a
              próxima versão no editor para o app passar a usar:
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {foraDoAr.map((diferenca) => (
                <li key={diferenca.texto} className="wrap-anywhere">
                  {diferenca.texto}
                </li>
              ))}
            </ul>
            {podeEditar ? (
              <AbrirEditorDaLoja lojaId={loja.id} ativa={lojaAtiva?.id === loja.id} />
            ) : (
              <p>Peça a um proprietário ou administrador para publicar.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-start justify-between gap-4">
        {/* O endereço não tem onde quebrar: sem `min-w-0` e `wrap-anywhere`, um
            longo empurra a tela para o lado no celular. */}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{loja.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm wrap-anywhere">{loja.primary_url}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {ROTULO_STATUS_LOJA[loja.status]}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da loja</CardTitle>
          <CardDescription>
            {podeEditar
              ? 'O nome, o endereço que o app abre, a plataforma, o contato de atendimento e o fuso horário da loja.'
              : 'Somente proprietários e administradores podem alterar estes dados.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {podeEditar ? (
            <FormularioLoja
              acao={editarLoja.bind(null, loja.id)}
              nomeInicial={loja.name}
              urlInicial={loja.primary_url}
              emailInicial={loja.support_email ?? ''}
              fusoInicial={loja.timezone}
              plataformaInicial={loja.platform}
              plataformaTravada={loja.shopify_scopes != null}
              gruposDeFusos={gruposDeFusos(loja.timezone)}
              rotuloEnvio="Salvar alterações"
              carregando="Salvando..."
              comContato
            />
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Nome</dt>
                <dd className="font-medium">{loja.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Endereço</dt>
                <dd className="font-medium">{loja.primary_url}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">E-mail de atendimento</dt>
                <dd className="font-medium">{loja.support_email ?? 'Ainda não cadastrado'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plataforma</dt>
                <dd className="font-medium">
                  {loja.platform === 'shopify' ? 'Shopify' : 'Outra plataforma'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fuso horário</dt>
                <dd className="font-medium first-letter:uppercase">{nomeDoFuso(loja.timezone)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {podeExcluir(papel) ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">Excluir loja</CardTitle>
            <CardDescription>Remove a loja e o app dela. Não dá para desfazer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ExcluirLoja lojaId={loja.id} nome={loja.name} status={loja.status} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
