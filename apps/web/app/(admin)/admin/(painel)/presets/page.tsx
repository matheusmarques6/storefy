/**
 * A10 — Presets de configuração por tema da Shopify.
 *
 * O PASSO MAIS LENTO DO ONBOARDING é descobrir quais seletores escondem o
 * cabeçalho e o rodapé daquele tema. É um trabalho que já foi feito na
 * primeira loja daquele tema, e que hoje é refeito em cada uma.
 *
 * Um preset guarda esse trabalho e o entrega pronto para a próxima loja. Quem
 * o cria é a equipe, copiando de uma loja que já está no ar — nunca escrevendo
 * abas à mão, que seria um palpite em vez de algo conferido.
 */
import type { Metadata } from 'next';
import { Layers } from 'lucide-react';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { AcoesDoPreset, CriarPreset, type LojaPublicada } from './gerenciar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Presets · Admin' };

export default async function PaginaPresets() {
  await exigirPlatformAdmin();
  const supabase = await criarClientServidor();

  const [{ data: presets, error: erroPresets }, { data: configs, error: erroConfigs }] =
    await Promise.all([
      supabase
        .from('config_presets')
        .select('id, nome, tema, descricao, tabs, hide_selectors, custom_css, ativo, created_at')
        // Ativos primeiro, e depois por tema: quem abre esta tela quer ver o
        // que os lojistas estão vendo, não o que está guardado.
        .order('ativo', { ascending: false })
        .order('tema', { ascending: true })
        .order('nome', { ascending: true }),
      /*
       * As lojas que TÊM config publicada — as únicas de onde dá para copiar.
       * Oferecer uma loja em rascunho daria um erro depois de escolher, o que
       * parece erro de quem escolheu.
       */
      supabase
        .from('app_configs')
        .select('app_id, apps!inner(stores!inner(name, shopify_theme, organizations!inner(name)))')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(100),
    ]);

  if (erroPresets != null) {
    throw new Error(`Não foi possível carregar os presets: ${erroPresets.message}`);
  }
  if (erroConfigs != null) {
    throw new Error(`Não foi possível carregar as lojas: ${erroConfigs.message}`);
  }

  const lojas: LojaPublicada[] = configs.map((linha) => ({
    appId: linha.app_id,
    rotulo: `${linha.apps.stores.name} · ${linha.apps.stores.organizations.name}${
      linha.apps.stores.shopify_theme === null ? '' : ` · tema ${linha.apps.stores.shopify_theme}`
    }`,
    tema: linha.apps.stores.shopify_theme,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Presets</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Abas, elementos escondidos e CSS prontos por tema da Shopify. O lojista aplica em um
          clique, em vez de descobrir os seletores sozinho.
        </p>
      </div>

      {presets.length === 0 ? (
        <EstadoVazio
          icone={Layers}
          titulo="Nenhum preset ainda"
          descricao="Quando uma loja estiver bem configurada, salve a configuração dela como preset — a próxima loja do mesmo tema começa pronta."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Preset</TableHead>
                <TableHead>Tema</TableHead>
                <TableHead>Conteúdo</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presets.map((preset) => {
                const abas = Array.isArray(preset.tabs) ? preset.tabs.length : 0;
                const seletores = Array.isArray(preset.hide_selectors)
                  ? preset.hide_selectors.length
                  : 0;

                return (
                  <TableRow key={preset.id}>
                    <TableCell>
                      <span className="font-medium">{preset.nome}</span>
                      {preset.descricao == null || preset.descricao === '' ? null : (
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {preset.descricao}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{preset.tema}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {abas} {abas === 1 ? 'aba' : 'abas'} · {seletores}{' '}
                      {seletores === 1 ? 'elemento escondido' : 'elementos escondidos'}
                      {preset.custom_css === '' ? '' : ' · com CSS'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={preset.ativo ? 'secondary' : 'outline'}>
                        {preset.ativo ? 'Visível' : 'Desligado'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <AcoesDoPreset id={preset.id} nome={preset.nome} ativo={preset.ativo} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <CriarPreset lojas={lojas} />

      <Card>
        <CardContent className="text-muted-foreground py-4 text-sm">
          Um preset troca as abas, os elementos escondidos e o CSS. Nome da loja, cores, ícone e
          recursos ficam como estão — é a identidade daquele cliente, e um preset que a
          sobrescrevesse faria o lojista perder o que ajustou para ganhar três seletores.
        </CardContent>
      </Card>
    </div>
  );
}
