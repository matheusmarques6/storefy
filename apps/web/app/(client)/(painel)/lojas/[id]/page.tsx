/** Detalhe e edição de uma loja. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { ROTULO_STATUS_LOJA, podeEscrever, podeExcluir } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { editarLoja } from '../acoes';
import { FormularioLoja } from '../formulario-loja';
import { ExcluirLoja } from './excluir-loja';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Loja' };

export default async function PaginaLoja({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string; salva?: string }>;
}) {
  const { id } = await params;
  const avisos = await searchParams;
  const { papel } = await exigirContextoCliente();

  const supabase = await criarClientServidor();
  // A RLS já limita ao que a organização do usuário pode ver: uma loja de outra
  // empresa simplesmente não é encontrada, e vira 404.
  const { data: loja } = await supabase.from('stores').select('*').eq('id', id).maybeSingle();

  if (loja == null) notFound();

  const podeEditar = podeEscrever(papel);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/lojas"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para lojas
      </Link>

      {avisos.criada === '1' ? (
        <Alert variant="info">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Loja criada. Ela já é a loja ativa do painel.</AlertDescription>
        </Alert>
      ) : null}
      {avisos.salva === '1' ? (
        <Alert variant="info">
          <CheckCircle2 aria-hidden />
          <AlertDescription>Alterações salvas.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{loja.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{loja.primary_url}</p>
        </div>
        <Badge variant="secondary">{ROTULO_STATUS_LOJA[loja.status]}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da loja</CardTitle>
          <CardDescription>
            {podeEditar
              ? 'Altere o nome ou o endereço que o app abre.'
              : 'Somente proprietários e administradores podem alterar estes dados.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {podeEditar ? (
            <FormularioLoja
              acao={editarLoja.bind(null, loja.id)}
              nomeInicial={loja.name}
              urlInicial={loja.primary_url}
              rotuloEnvio="Salvar alterações"
              carregando="Salvando..."
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
            <ExcluirLoja lojaId={loja.id} nome={loja.name} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
