/**
 * A04 — o app de cada loja do cliente: configuração no ar, versões nas lojas
 * de aplicativos e push dos últimos 30 dias.
 *
 * É o que o suporte precisa para responder "meu app não atualizou" ou "o push
 * não chega" sem abrir o painel do cliente: a config que está no ar e desde
 * quando, se há rascunho parado, que versão cada loja de aplicativos aprovou,
 * se a atualização obrigatória está ligada e se as notificações estão
 * configuradas. Tudo lido do banco; o que não existe aparece como "ainda não".
 */
import type { Json } from '@storefy/db';
import { criarClientServidor } from '@/lib/supabase/server';
import { DESCRICAO_DO_TIPO, ehTipoDeAutomacao } from '@/lib/automacao';
import { numeroOuTraco } from '@/lib/campanha';
import { versaoDoNumero } from '@/lib/atualizacao-obrigatoria';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Janela do resumo de push, a mesma da A08. */
const DIAS = 30;

interface Loja {
  id: string;
  name: string;
}

function numeroDoJson(valor: Json | undefined): number | null {
  const numero = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export async function AppsDaOrganizacao({ lojas }: { lojas: Loja[] }) {
  if (lojas.length === 0) return null;

  const supabase = await criarClientServidor();
  const { data: apps, error } = await supabase
    .from('apps')
    .select(
      'id, store_id, display_name, bundle_id_ios, package_android, onesignal_app_id, expo_project_id',
    )
    .in(
      'store_id',
      lojas.map((loja) => loja.id),
    );
  if (error != null) throw new Error(`Não foi possível carregar os apps: ${error.message}`);

  const ids = apps.map((app) => app.id);
  const [publicadas, rascunhos, aprovados, push, automacoes] = await Promise.all([
    supabase
      .from('app_configs')
      .select('app_id, version, published_at, minimo:config->minSupportedBuild')
      .in('app_id', ids)
      .eq('status', 'published'),
    supabase
      .from('app_configs')
      .select('app_id, version, updated_at')
      .in('app_id', ids)
      .eq('status', 'draft'),
    supabase
      .from('builds')
      .select('app_id, platform, version, build_number, updated_at')
      .in('app_id', ids)
      .eq('status', 'approved')
      .order('build_number', { ascending: false }),
    supabase.rpc('push_do_admin', { p_dias: DIAS }),
    supabase.from('push_automations').select('app_id, type, enabled').in('app_id', ids),
  ]);

  for (const consulta of [publicadas, rascunhos, aprovados, push, automacoes]) {
    if (consulta.error != null) {
      throw new Error(`Não foi possível carregar os apps: ${consulta.error.message}`);
    }
  }

  const nomeDaLoja = new Map(lojas.map((loja) => [loja.id, loja.name]));

  return (
    <Card role="region" aria-labelledby="app-e-push">
      <CardHeader>
        <CardTitle id="app-e-push" className="text-base">
          App e push
        </CardTitle>
        <CardDescription>
          A configuração no ar, o que as lojas de aplicativos aprovaram e o push dos últimos {DIAS}{' '}
          dias, loja por loja.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {apps.map((app) => {
          const publicada = publicadas.data?.find((linha) => linha.app_id === app.id) ?? null;
          const rascunho = rascunhos.data?.find((linha) => linha.app_id === app.id) ?? null;
          const minimo = numeroDoJson(publicada?.minimo);
          const ultimo = (plataforma: 'ios' | 'android') =>
            aprovados.data?.find(
              (build) => build.app_id === app.id && build.platform === plataforma,
            ) ?? null;
          const estatisticas = push.data?.find((linha) => linha.app_id === app.id) ?? null;
          const ligadas = (automacoes.data ?? []).filter(
            (automacao) => automacao.app_id === app.id && automacao.enabled,
          );
          const nome = nomeDaLoja.get(app.store_id) ?? 'Loja';

          return (
            <section key={app.id} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
              <h3 className="font-medium">
                {nome}
                {/* O nome embaixo do ícone, quando não é o da loja. */}
                {app.display_name === nome ? null : (
                  <span className="text-muted-foreground ml-2 text-sm font-normal">
                    no celular: {app.display_name}
                  </span>
                )}
              </h3>

              <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-3">
                <Item rotulo="Configuração no ar">
                  {publicada == null
                    ? 'Nunca publicada'
                    : `Versão ${String(publicada.version)}, ${formatarDataHora(publicada.published_at, FUSO_PADRAO)}`}
                </Item>
                <Item rotulo="Rascunho">
                  {rascunho == null
                    ? '—'
                    : `Versão ${String(rascunho.version)}, editado ${formatarDataHora(rascunho.updated_at, FUSO_PADRAO)}`}
                </Item>
                <Item rotulo="Atualização obrigatória">
                  {minimo == null || minimo <= 1 ? 'Não exige' : `Exige ${versaoDoNumero(minimo)}`}
                </Item>
                <Item rotulo="App Store">{ultimo('ios')?.version ?? 'Nada aprovado ainda'}</Item>
                <Item rotulo="Google Play">
                  {ultimo('android')?.version ?? 'Nada aprovado ainda'}
                </Item>
                <Item rotulo="Projeto no Expo">
                  {app.expo_project_id == null ? 'Ainda não criado' : 'Criado'}
                </Item>
                <Item rotulo="Identificador iOS">
                  <span className="font-mono text-xs break-all">{app.bundle_id_ios ?? '—'}</span>
                </Item>
                <Item rotulo="Identificador Android">
                  <span className="font-mono text-xs break-all">{app.package_android ?? '—'}</span>
                </Item>
                <Item rotulo="Notificações">
                  {app.onesignal_app_id == null ? (
                    <Badge variant="outline">Não configuradas</Badge>
                  ) : (
                    <Badge variant="secondary">Configuradas</Badge>
                  )}
                </Item>
              </dl>

              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Item rotulo="Campanhas enviadas">
                  {numeroOuTraco(estatisticas?.campanhas_enviadas ?? null)}
                </Item>
                <Item rotulo="Campanhas com falha">
                  {numeroOuTraco(estatisticas?.campanhas_falhas ?? null)}
                </Item>
                <Item rotulo="Entregues">
                  {numeroOuTraco(numeroOuNulo(estatisticas?.entregues))}
                </Item>
                <Item rotulo="Aberturas">{numeroOuTraco(numeroOuNulo(estatisticas?.abertos))}</Item>
                <Item rotulo="Aparelhos">{numeroOuTraco(estatisticas?.aparelhos ?? null)}</Item>
                <Item rotulo={`Ativos em ${String(DIAS)} dias`}>
                  {numeroOuTraco(estatisticas?.ativos ?? null)}
                </Item>
              </dl>

              <p className="text-muted-foreground text-sm">
                {ligadas.length === 0
                  ? 'Nenhuma automação ligada.'
                  : `Automações ligadas: ${ligadas
                      .map((automacao) =>
                        ehTipoDeAutomacao(automacao.type)
                          ? DESCRICAO_DO_TIPO[automacao.type].nome
                          : automacao.type,
                      )
                      .join(', ')}.`}
              </p>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** `bigint` chega como número ou texto, conforme o tamanho. */
function numeroOuNulo(valor: number | string | null | undefined): number | null {
  if (valor == null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}
