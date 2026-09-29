/**
 * C03 — Onboarding 2: o visual rápido do app, logo depois de criar a loja.
 *
 * O cadastro (C02) cai aqui. A loja já nasce com um app que funciona e com a
 * cor detectada na página dela; esta tela é para o lojista CONFERIR — e sair
 * com a sensação de que o app é dele antes mesmo de abrir o editor.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { COLUNAS_DA_LOJA, podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { garantirRascunho } from '@/lib/configs-servidor';
import { urlAssinada } from '@/lib/assets-da-loja';
import { ehUuid } from '@/lib/app-config-publica';
import { lido } from '@/lib/leitura';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PassosDoComeco } from './passos';
import { VisualRapido } from './visual-rapido';

export const metadata: Metadata = { title: 'Visual do app' };

export default async function PaginaDoVisualRapido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!ehUuid(id)) notFound();

  const { papel } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  // A RLS decide: loja de outra empresa não é encontrada, e vira 404.
  const { data: loja } = lido(
    await supabase.from('stores').select(COLUNAS_DA_LOJA).eq('id', id).maybeSingle(),
    'a loja',
  );
  if (loja == null) notFound();

  const rascunho = await garantirRascunho(supabase, loja.id);
  if (!rascunho.ok) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle>Não conseguimos abrir o visual do app</AlertTitle>
        <AlertDescription>
          {rascunho.motivo} Recarregue a página; se continuar, fale com o suporte.
        </AlertDescription>
      </Alert>
    );
  }

  const { data: app } = lido(
    await supabase.from('apps').select('icon_path').eq('id', rascunho.rascunho.appId).maybeSingle(),
    'o app',
  );
  const urlDoIcone = await urlAssinada(supabase, app?.icon_path ?? null);

  return (
    <div className="space-y-6">
      <PassosDoComeco atual="visual" />
      <VisualRapido
        storeId={loja.id}
        nomeDaLoja={loja.name}
        urlDaLoja={loja.primary_url}
        configInicial={rascunho.rascunho.config}
        urlDoIcone={urlDoIcone}
        somenteLeitura={!podeEscrever(papel)}
      />
    </div>
  );
}
