/** Editor do app da loja ativa (C06). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Smartphone } from 'lucide-react';
import { podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { garantirRascunho, historicoDeVersoes, versaoPublicada } from '@/lib/configs-servidor';
import { urlAssinada } from '@/lib/assets-da-loja';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Editor } from './editor';

export const metadata: Metadata = { title: 'Editor do app' };

export default async function PaginaDoEditor() {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Cadastre uma loja primeiro"
        descricao="O editor do app trabalha em cima de uma loja. Cadastre a sua para começar."
        acao={
          <Button asChild>
            <Link href="/lojas/nova">Cadastrar loja</Link>
          </Button>
        }
      />
    );
  }

  const supabase = await criarClientServidor();
  const rascunho = await garantirRascunho(supabase, lojaAtiva.id);

  if (!rascunho.ok) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden />
        <AlertTitle>Não conseguimos abrir o editor</AlertTitle>
        <AlertDescription>
          {rascunho.motivo} Recarregue a página; se continuar, fale com o suporte.
        </AlertDescription>
      </Alert>
    );
  }

  const [publicada, historico, { data: app }] = await Promise.all([
    versaoPublicada(supabase, rascunho.rascunho.appId),
    historicoDeVersoes(supabase, rascunho.rascunho.appId),
    supabase
      .from('apps')
      .select('onesignal_app_id, icon_path, splash_path')
      .eq('id', rascunho.rascunho.appId)
      .maybeSingle(),
  ]);

  /*
   * O bucket é privado, então a imagem só aparece na tela por link assinado.
   * Uma hora é o bastante para a pessoa olhar e trocar, e curto o suficiente
   * para o link não virar um endereço permanente se vazar do histórico.
   */
  const [urlDoIcone, urlDaSplash] = await Promise.all([
    urlAssinada(supabase, app?.icon_path ?? null),
    urlAssinada(supabase, app?.splash_path ?? null),
  ]);

  return (
    <Editor
      storeId={lojaAtiva.id}
      configInicialDoServidor={rascunho.rascunho.config}
      versao={rascunho.rascunho.version}
      publicada={publicada}
      urlDoIcone={urlDoIcone}
      urlDaSplash={urlDaSplash}
      historico={historico}
      somenteLeitura={!podeEscrever(papel)}
      pushConfigurado={(app?.onesignal_app_id ?? null) !== null}
    />
  );
}
