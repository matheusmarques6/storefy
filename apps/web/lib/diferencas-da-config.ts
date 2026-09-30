/**
 * O que muda de uma config para outra, em frases que o lojista entende (C06).
 *
 * Serve a duas perguntas: "o que vai ao ar se eu publicar?" (a versão no ar
 * contra o rascunho) e "o que muda se eu restaurar esta versão?" (o rascunho
 * contra a versão escolhida, C06f — "comparar e restaurar"). E é também o
 * contador do "Publicar alterações": `mudancasPendentes` é o tamanho desta
 * lista. Uma fonte só, para o número no botão nunca discordar da lista que o
 * lojista lê.
 *
 * A conta é por AJUSTE, e não por campo do JSON: cada cor é uma; cada aba
 * nova, removida ou alterada é uma, e mudar a ordem é uma a mais; cada opção
 * de uma seção é uma. `version` não entra — ela muda a cada publicação.
 *
 * As comparações ignoram a ORDEM das chaves: a versão no ar volta do banco
 * (jsonb, que não guarda a ordem), e uma aba criada no editor tem as chaves
 * na ordem em que o código as escreveu.
 */
import type { AppConfig, Tab } from '@storefy/config-schema';
import { SEM_EXIGENCIA, versaoDoNumero } from '@/lib/atualizacao-obrigatoria';

export type SecaoDaDiferenca = 'Aparência' | 'Abas' | 'Loja' | 'Recursos' | 'Dados da loja';

export interface Diferenca {
  /** A seção do editor onde a mudança mora. */
  secao: SecaoDaDiferenca;
  texto: string;
}

type Valor = unknown;

function ehObjeto(valor: Valor): valor is Record<string, Valor> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function ordenado(valor: Valor): Valor {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (!ehObjeto(valor)) return valor;
  return Object.fromEntries(
    Object.keys(valor)
      .sort()
      .map((chave) => [chave, ordenado(valor[chave])]),
  );
}

/** JSON com as chaves em ordem alfabética, em todos os níveis. */
export function jsonCanonico(valor: Valor): string {
  return JSON.stringify(ordenado(valor));
}

function iguais(a: Valor, b: Valor): boolean {
  return jsonCanonico(a) === jsonCanonico(b);
}

function ligado(valor: boolean): string {
  return valor ? 'ligado' : 'desligado';
}

function entreAspas(texto: string): string {
  return `“${texto}”`;
}

// ------------------------------------------------------------ os rótulos

const NOME_DA_COR: Record<Exclude<keyof AppConfig['theme'], 'statusBar'>, string> = {
  primary: 'Cor principal',
  background: 'Cor de fundo',
  text: 'Cor do texto',
  tabBarBg: 'Fundo da barra de abas',
  tabBarActive: 'Cor da aba selecionada',
  tabBarInactive: 'Cor das abas não selecionadas',
};

/**
 * O número sobre o ícone, dito pelo que ele conta. Antes toda mudança era
 * contada como a do carrinho — e desligar o número da caixa de avisos
 * aparecia como "sem o número do carrinho".
 */
function mudancaDoNumero(aba: Tab): string {
  if (aba.badge === 'cart_count') return 'mostra o número do carrinho';
  if (aba.badge === 'unread') return 'mostra quantos avisos não foram lidos';
  return aba.type === 'notifications' ? 'sem o número de avisos' : 'sem o número do carrinho';
}

const O_QUE_A_ABA_ABRE: Record<Tab['type'], string> = {
  webview: 'uma página da loja',
  search: 'a busca',
  cart: 'o carrinho',
  account: 'a conta do cliente',
  notifications: 'a caixa de avisos',
};

const MOMENTO_DO_PEDIDO: Record<AppConfig['features']['pushPromptTiming'], string> = {
  onboarding: 'nas primeiras aberturas do app',
  after_first_add_to_cart: 'depois do primeiro item no carrinho',
  manual: 'só quando a loja pedir',
};

// ------------------------------------------------------------- as seções

function diferencasDoTema(de: AppConfig['theme'], para: AppConfig['theme']): Diferenca[] {
  const lista: Diferenca[] = [];
  for (const campo of Object.keys(NOME_DA_COR) as (keyof typeof NOME_DA_COR)[]) {
    if (de[campo].toLowerCase() !== para[campo].toLowerCase()) {
      lista.push({
        secao: 'Aparência',
        texto: `${NOME_DA_COR[campo]}: ${de[campo]} → ${para[campo]}`,
      });
    }
  }
  if (de.statusBar !== para.statusBar) {
    lista.push({
      secao: 'Aparência',
      texto: `Barra de status: ícones ${para.statusBar === 'light' ? 'claros' : 'escuros'}`,
    });
  }
  return lista;
}

function diferencasDasAbas(de: AppConfig['tabs'], para: AppConfig['tabs']): Diferenca[] {
  const lista: Diferenca[] = [];
  const antes = new Map(de.map((aba) => [aba.id, aba]));
  const depois = new Map(para.map((aba) => [aba.id, aba]));

  for (const aba of para) {
    const anterior = antes.get(aba.id);
    if (anterior === undefined) {
      lista.push({ secao: 'Abas', texto: `Aba nova: ${entreAspas(aba.label)}` });
      continue;
    }
    if (iguais(anterior, aba)) continue;

    const partes: string[] = [];
    if (anterior.icon !== aba.icon) partes.push('ícone novo');
    if (anterior.type !== aba.type) partes.push(`agora abre ${O_QUE_A_ABA_ABRE[aba.type]}`);
    if ((anterior.url ?? '') !== (aba.url ?? '')) partes.push(`endereço ${aba.url ?? '—'}`);
    if (anterior.badge !== aba.badge) partes.push(mudancaDoNumero(aba));
    const nome =
      anterior.label === aba.label
        ? `Aba ${entreAspas(aba.label)}`
        : `Aba ${entreAspas(anterior.label)} agora se chama ${entreAspas(aba.label)}`;
    lista.push({
      secao: 'Abas',
      texto:
        partes.length === 0
          ? nome
          : `${nome}${anterior.label === aba.label ? ':' : ','} ${partes.join(', ')}`,
    });
  }

  for (const aba of de) {
    if (!depois.has(aba.id)) {
      lista.push({ secao: 'Abas', texto: `Aba removida: ${entreAspas(aba.label)}` });
    }
  }

  const ordemAntes = de.map((aba) => aba.id).filter((id) => depois.has(id));
  const ordemDepois = para.map((aba) => aba.id).filter((id) => antes.has(id));
  if (!iguais(ordemAntes, ordemDepois)) {
    lista.push({
      secao: 'Abas',
      texto: `Nova ordem das abas: ${para.map((aba) => aba.label).join(', ')}`,
    });
  }
  return lista;
}

function diferencasDaLoja(de: AppConfig['webview'], para: AppConfig['webview']): Diferenca[] {
  const lista: Diferenca[] = [];
  if (!iguais(de.hideSelectors, para.hideSelectors)) {
    const escondidos = para.hideSelectors.filter((item) => !de.hideSelectors.includes(item));
    const mostrados = de.hideSelectors.filter((item) => !para.hideSelectors.includes(item));
    const partes: string[] = [];
    if (escondidos.length > 0) {
      partes.push(`passa a esconder ${escondidos.map(entreAspas).join(', ')}`);
    }
    if (mostrados.length > 0) {
      partes.push(`volta a mostrar ${mostrados.map(entreAspas).join(', ')}`);
    }
    lista.push({
      secao: 'Loja',
      texto:
        partes.length === 0
          ? 'Itens escondidos da loja em outra ordem'
          : `Itens escondidos da loja: ${partes.join('; ')}`,
    });
  }
  if (de.customCss !== para.customCss) {
    lista.push({ secao: 'Loja', texto: 'CSS aplicado na loja mudou' });
  }
  if (de.customJs !== para.customJs) {
    lista.push({ secao: 'Loja', texto: 'JavaScript aplicado na loja mudou' });
  }
  if (de.pullToRefresh !== para.pullToRefresh) {
    lista.push({ secao: 'Loja', texto: `Puxar para atualizar: ${ligado(para.pullToRefresh)}` });
  }
  if (de.userAgentSuffix !== para.userAgentSuffix) {
    lista.push({ secao: 'Loja', texto: 'Identificação do app nos acessos à loja mudou' });
  }
  return lista;
}

function diferencasDosRecursos(
  de: AppConfig['features'],
  para: AppConfig['features'],
): Diferenca[] {
  const lista: Diferenca[] = [];
  if (de.pushPromptTiming !== para.pushPromptTiming) {
    lista.push({
      secao: 'Recursos',
      texto: `Pedido de notificações: ${MOMENTO_DO_PEDIDO[para.pushPromptTiming]}`,
    });
  }
  if (!iguais(de.onboardingSlides, para.onboardingSlides)) {
    const antes = de.onboardingSlides.length;
    const depois = para.onboardingSlides.length;
    lista.push({
      secao: 'Recursos',
      texto:
        depois === 0
          ? 'Sem telas de boas-vindas'
          : antes === depois
            ? 'Telas de boas-vindas mudaram'
            : `Telas de boas-vindas: ${String(antes)} → ${String(depois)}`,
    });
  }
  if (!iguais(de.appBanner, para.appBanner)) {
    lista.push({
      secao: 'Recursos',
      texto:
        de.appBanner.enabled !== para.appBanner.enabled
          ? `Banner “baixe o app”: ${ligado(para.appBanner.enabled)}`
          : `Texto do banner “baixe o app”: ${entreAspas(para.appBanner.text)}`,
    });
  }
  if (de.biometricLogin !== para.biometricLogin) {
    lista.push({
      secao: 'Recursos',
      texto: `Proteger a conta com Face ID ou digital: ${ligado(para.biometricLogin)}`,
    });
  }
  if (de.rateAppPrompt !== para.rateAppPrompt) {
    lista.push({
      secao: 'Recursos',
      texto: `Pedir avaliação na loja de aplicativos: ${ligado(para.rateAppPrompt)}`,
    });
  }
  return lista;
}

type Aviso = NonNullable<AppConfig['announcement']>;

function diferencasDoAviso(de: Aviso | undefined, para: Aviso | undefined): Diferenca[] {
  // Config antiga, sem o campo, é aviso desligado — o mesmo que o editor mostra.
  const antes: Aviso = de ?? { enabled: false, text: '' };
  const depois: Aviso = para ?? { enabled: false, text: '' };
  const lista: Diferenca[] = [];
  if (antes.enabled !== depois.enabled) {
    lista.push({ secao: 'Recursos', texto: `Aviso no topo: ${ligado(depois.enabled)}` });
  }
  if (antes.text !== depois.text) {
    lista.push({
      secao: 'Recursos',
      texto:
        depois.text.trim() === ''
          ? 'Texto do aviso no topo apagado'
          : `Texto do aviso no topo: ${entreAspas(depois.text.trim())}`,
    });
  }
  if ((antes.url ?? '') !== (depois.url ?? '')) {
    lista.push({
      secao: 'Recursos',
      texto:
        (depois.url ?? '') === ''
          ? 'Aviso no topo sem link'
          : `Link do aviso no topo: ${depois.url ?? ''}`,
    });
  }
  return lista;
}

function diferencasDosDadosDaLoja(de: AppConfig['store'], para: AppConfig['store']): Diferenca[] {
  const lista: Diferenca[] = [];
  if (de.name !== para.name) {
    lista.push({ secao: 'Dados da loja', texto: `Nome da loja: ${entreAspas(para.name)}` });
  }
  if (de.url !== para.url) {
    lista.push({ secao: 'Dados da loja', texto: `Endereço da loja: ${para.url}` });
  }
  if (!iguais(de.domains, para.domains)) {
    lista.push({ secao: 'Dados da loja', texto: 'Domínios da loja atualizados' });
  }
  if (de.platform !== para.platform) {
    lista.push({ secao: 'Dados da loja', texto: 'Plataforma da loja atualizada' });
  }
  return lista;
}

/** Tudo que muda indo de `de` para `para`, na ordem das seções do editor. */
export function diferencasDaConfig(de: AppConfig, para: AppConfig): Diferenca[] {
  const lista = [
    ...diferencasDoTema(de.theme, para.theme),
    ...diferencasDasAbas(de.tabs, para.tabs),
    ...diferencasDaLoja(de.webview, para.webview),
    ...diferencasDosRecursos(de.features, para.features),
    ...diferencasDoAviso(de.announcement, para.announcement),
  ];

  if (de.minSupportedBuild !== para.minSupportedBuild) {
    lista.push({
      secao: 'Recursos',
      texto:
        para.minSupportedBuild <= SEM_EXIGENCIA
          ? 'Atualização obrigatória desligada'
          : `Atualização obrigatória: exige a versão ${versaoDoNumero(para.minSupportedBuild)}`,
    });
  }

  lista.push(...diferencasDosDadosDaLoja(de.store, para.store));

  /*
   * Um campo que o contrato ganhe depois desta lista não pode sumir da conta:
   * fica como ajuste genérico até ganhar a frase dele.
   */
  const conhecidas = new Set([
    'version',
    'store',
    'theme',
    'tabs',
    'webview',
    'features',
    'announcement',
    'minSupportedBuild',
  ]);
  const chaves = new Set([...Object.keys(de), ...Object.keys(para)]);
  for (const chave of chaves) {
    if (conhecidas.has(chave)) continue;
    const antes = (de as unknown as Record<string, Valor>)[chave];
    const depois = (para as unknown as Record<string, Valor>)[chave];
    if (!iguais(antes, depois)) lista.push({ secao: 'Recursos', texto: 'Outro ajuste do app' });
  }

  return lista;
}
