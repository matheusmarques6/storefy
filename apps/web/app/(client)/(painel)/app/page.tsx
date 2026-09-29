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
import { lerPresets } from '@/lib/presets';
import { numeroExigivel } from '@/lib/atualizacao-obrigatoria';
import { lido } from '@/lib/leitura';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { ondeBaixarAPrevia } from '@/lib/configuracoes-da-plataforma';

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

  const [publicada, historico, lidoApp, lidosPresets, lidosAprovados] = await Promise.all([
    versaoPublicada(supabase, rascunho.rascunho.appId),
    historicoDeVersoes(supabase, rascunho.rascunho.appId),
    supabase
      .from('apps')
      .select('onesignal_app_id, icon_path, splash_path')
      .eq('id', rascunho.rascunho.appId)
      .maybeSingle(),
    /*
     * Os presets ATIVOS. A RLS já libera ao lojista só os ligados — mas a
     * equipe da plataforma lê todos, e o editor é a mesma tela para os dois.
     * Sem o filtro aqui, alguém da equipe veria no editor presets que nenhum
     * cliente vê: a tela precisa dizer o que o LOJISTA enxerga, e isso é uma
     * pergunta da consulta, não de quem está olhando.
     */
    supabase
      .from('config_presets')
      .select('id, nome, tema, descricao, tabs, hide_selectors, custom_css')
      .eq('ativo', true)
      .order('tema', { ascending: true })
      .order('nome', { ascending: true }),
    // Os builds aprovados pelas lojas: é deles que sai o número que a
    // atualização obrigatória pode exigir.
    supabase
      .from('builds')
      .select('platform, build_number')
      .eq('app_id', rascunho.rascunho.appId)
      .eq('status', 'approved')
      .not('build_number', 'is', null),
  ]);
  /*
   * Sem ler, o editor mostraria "sem ícone", "push desligado", nenhum preset e
   * "nada aprovado para exigir" — cada um levando o lojista a refazer o que
   * já está feito.
   */
  const { data: app } = lido(lidoApp, 'o app');
  const { data: presetsBrutos } = lido(lidosPresets, 'os presets');
  const { data: aprovados } = lido(lidosAprovados, 'os builds aprovados');

  /*
   * Um preset de formato antigo é DESCARTADO, e não derruba o editor: o
   * lojista veio publicar o app dele, e perder a tela por causa de uma linha
   * ruim da nossa curadoria seria o pior jeito de descobrir o problema.
   */
  const presets = lerPresets(presetsBrutos ?? []);

  /*
   * O bucket é privado, então a imagem só aparece na tela por link assinado.
   * Uma hora é o bastante para a pessoa olhar e trocar, e curto o suficiente
   * para o link não virar um endereço permanente se vazar do histórico.
   */
  const [urlDoIcone, urlDaSplash, plataforma] = await Promise.all([
    urlAssinada(supabase, app?.icon_path ?? null),
    urlAssinada(supabase, app?.splash_path ?? null),
    configuracoesDaPlataforma(),
  ]);

  return (
    <Editor
      // Trocar de loja monta outro editor: nada da loja anterior — nem a
      // gravação que esperava a pausa — passa para a nova.
      key={lojaAtiva.id}
      storeId={lojaAtiva.id}
      configInicialDoServidor={rascunho.rascunho.config}
      versao={rascunho.rascunho.version}
      publicada={publicada}
      urlDoIcone={urlDoIcone}
      urlDaSplash={urlDaSplash}
      ondeBaixarAPrevia={ondeBaixarAPrevia(plataforma)}
      historico={historico}
      presets={presets}
      fuso={lojaAtiva.timezone}
      somenteLeitura={!podeEscrever(papel)}
      pushConfigurado={(app?.onesignal_app_id ?? null) !== null}
      numeroExigivel={numeroExigivel(
        (aprovados ?? []).flatMap((build) =>
          build.build_number == null
            ? []
            : [{ plataforma: build.platform, numero: build.build_number }],
        ),
      )}
    />
  );
}
