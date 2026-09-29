/**
 * Aplicar um preset de tema sobre a config de um app (A10).
 *
 * O QUE UM PRESET TROCA, E O QUE ELE NÃO TOCA. Ele troca as ABAS, os
 * SELETORES escondidos e o CSS — o que varia de tema para tema da Shopify. Ele
 * NÃO toca em nome, cores, ícone, splash, recursos nem aviso: isso é a
 * identidade daquela loja, e um preset que a sobrescrevesse faria o lojista
 * perder o que ele passou a tarde ajustando para ganhar três seletores.
 *
 * A VALIDAÇÃO ACONTECE AQUI, com o Zod do `config-schema`, e não no banco. O
 * banco confere a FORMA (um array de 2 a 5 abas); as regras de verdade — id
 * sem espaço, rótulo que cabe na tab bar, tipos válidos — moram no schema, e
 * duplicá-las em SQL criaria dois lugares para manter, com um deles ficando
 * para trás.
 *
 * Um preset gravado errado, ou salvo antes de o schema mudar, é RECUSADO com o
 * motivo — e não aplicado pela metade. Meia aplicação deixaria o app do
 * lojista numa forma que nenhuma tela sabe consertar.
 */
import { AppConfigSchema, TabSchema, type AppConfig } from '@storefy/config-schema';
import { z } from 'zod';

/** O conteúdo de um preset, como ele sai do banco. */
export interface PresetBruto {
  id: string;
  nome: string;
  tema: string;
  descricao: string | null;
  tabs: unknown;
  hide_selectors: unknown;
  custom_css: string | null;
}

export interface Preset {
  id: string;
  nome: string;
  tema: string;
  descricao: string | null;
  tabs: AppConfig['tabs'];
  hideSelectors: string[];
  customCss: string;
}

const ConteudoDoPreset = z.object({
  tabs: z.array(TabSchema).min(2).max(5),
  hideSelectors: z.array(z.string()),
  customCss: z.string(),
});

export type LeituraDoPreset = { ok: true; preset: Preset } | { ok: false; motivo: string };

/**
 * Lê um preset do banco, validando o conteúdo.
 *
 * Devolve o motivo em vez de estourar: a tela precisa mostrar QUAL preset está
 * quebrado sem deixar de mostrar os outros. Um erro aqui derrubaria a lista
 * inteira por causa de uma linha ruim.
 */
export function lerPreset(bruto: PresetBruto): LeituraDoPreset {
  const conteudo = ConteudoDoPreset.safeParse({
    tabs: bruto.tabs,
    hideSelectors: bruto.hide_selectors,
    customCss: bruto.custom_css ?? '',
  });

  if (!conteudo.success) {
    return {
      ok: false,
      motivo: 'O conteúdo deste preset não bate com o formato de configuração atual.',
    };
  }

  return {
    ok: true,
    preset: {
      id: bruto.id,
      nome: bruto.nome,
      tema: bruto.tema,
      descricao: bruto.descricao,
      tabs: conteudo.data.tabs,
      hideSelectors: conteudo.data.hideSelectors,
      customCss: conteudo.data.customCss,
    },
  };
}

/** Só os que dá para aplicar. Os quebrados somem da lista em vez de derrubá-la. */
export function lerPresets(brutos: PresetBruto[]): Preset[] {
  const bons: Preset[] = [];

  for (const bruto of brutos) {
    const lido = lerPreset(bruto);
    if (lido.ok) bons.push(lido.preset);
  }

  return bons;
}

export type Aplicacao = { ok: true; config: AppConfig } | { ok: false; motivo: string };

/**
 * Aplica o preset sobre a config, devolvendo uma config NOVA.
 *
 * O resultado passa pelo `AppConfigSchema` inteiro antes de sair: juntar duas
 * partes válidas pode dar algo inválido, e é melhor descobrir isso aqui do que
 * na hora de publicar, depois de o lojista achar que terminou.
 */
export function aplicarPreset(config: AppConfig, preset: Preset): Aplicacao {
  const candidata = {
    ...config,
    tabs: preset.tabs,
    webview: {
      ...config.webview,
      hideSelectors: preset.hideSelectors,
      customCss: preset.customCss,
    },
  };

  const conferida = AppConfigSchema.safeParse(candidata);
  if (!conferida.success) {
    return {
      ok: false,
      motivo: 'O preset não pôde ser aplicado nesta configuração. Nada foi alterado.',
    };
  }

  return { ok: true, config: conferida.data };
}

/**
 * O que muda se o preset for aplicado, em palavras.
 *
 * Existe para a confirmação não ser um "tem certeza?" vazio: aplicar um preset
 * SUBSTITUI as abas que o lojista montou, e ele precisa ver o tamanho do
 * estrago antes de decidir, não depois.
 */
export function resumoDaTroca(config: AppConfig, preset: Preset): string[] {
  const mudancas: string[] = [];

  const abasAtuais = config.tabs.map((aba) => aba.label).join(', ');
  const abasNovas = preset.tabs.map((aba) => aba.label).join(', ');
  if (abasAtuais !== abasNovas) {
    mudancas.push(`As abas passam de "${abasAtuais}" para "${abasNovas}".`);
  }

  if (config.webview.hideSelectors.join('|') !== preset.hideSelectors.join('|')) {
    mudancas.push(
      `Os elementos escondidos passam de ${String(config.webview.hideSelectors.length)} para ${String(preset.hideSelectors.length)}.`,
    );
  }

  if (config.webview.customCss !== preset.customCss) {
    mudancas.push(
      config.webview.customCss === ''
        ? 'Um CSS próprio passa a ser aplicado.'
        : 'O CSS próprio que existe hoje é substituído.',
    );
  }

  return mudancas;
}
