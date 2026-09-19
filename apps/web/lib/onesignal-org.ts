import 'server-only';

/**
 * Criação do app da loja na OneSignal (seção 6 do plano, "Onboarding de push").
 *
 * Cada loja tem o PRÓPRIO app na OneSignal, criado com a Organization API Key
 * da Storefy e com as credenciais de push da própria loja — a chave APNs da
 * conta Apple dela e a conta de serviço do Google dela. Um app compartilhado
 * entre clientes significaria que qualquer um deles poderia falar com a base
 * de todos os outros.
 *
 * O QUE ESTA INTEGRAÇÃO EXIGE DE UMA PESSOA, e por isso não dá para concluir
 * sozinha:
 *
 *   `ONESIGNAL_ORG_API_KEY` no ambiente — é a chave da organização Storefy;
 *   a chave `.p8` de APNs, emitida na conta Apple do cliente;
 *   a conta de serviço do Firebase, emitida no projeto Google do cliente.
 *
 * Enquanto faltar qualquer uma, `diagnosticar` diz exatamente o que falta e a
 * tela mostra isso ao lojista, em vez de um botão que erra sem explicar.
 */
import { BASE_DA_API } from '@/lib/onesignal';

/** As credenciais de push de uma loja, já em claro. */
export interface CredenciaisDaLoja {
  /** Nome que aparece no painel da OneSignal. */
  nome: string;
  /** Bundle id do app iOS, ex.: com.oakvintage.app. */
  bundleId: string;
  /** Conteúdo do arquivo `.p8` de APNs. */
  apnsP8: string;
  apnsKeyId: string;
  appleTeamId: string;
  /** JSON da conta de serviço do Firebase, como texto. */
  fcmServiceAccountJson: string;
  /**
   * `production` usa os servidores de push de produção da Apple.
   * Um app de loja publicado é sempre production; sandbox é só para build de
   * desenvolvimento, e errar aqui faz nenhuma notificação chegar.
   */
  ambienteApns?: 'production' | 'sandbox';
}

export interface AppCriado {
  /** `onesignal_app_id` da loja. */
  appId: string;
  /** Chave REST daquele app. Guardar criptografada, nunca em claro. */
  chaveRest: string;
}

export type ResultadoDaCriacao = { ok: true; app: AppCriado } | { ok: false; motivo: string };

export interface Pendencia {
  /** O que falta, em uma frase para o lojista. */
  texto: string;
  /** Quem resolve: nós ou ele. */
  de: 'storefy' | 'lojista';
}

/**
 * O que ainda falta para ligar o push desta loja.
 *
 * Existe separado da chamada porque é o que a tela mostra. Uma lista de
 * pendências é a diferença entre "não funcionou" e "falta a chave da Apple,
 * que só você pode gerar".
 */
export function diagnosticar(entrada: {
  orgApiKey: string | undefined;
  appleVerificada: boolean;
  googleVerificada: boolean;
  bundleId: string | null;
}): Pendencia[] {
  const pendencias: Pendencia[] = [];

  if (entrada.orgApiKey == null || entrada.orgApiKey === '') {
    pendencias.push({
      texto: 'A Storefy ainda não terminou de configurar o serviço de notificações.',
      de: 'storefy',
    });
  }
  if (!entrada.appleVerificada) {
    pendencias.push({
      texto: 'Falta conectar a conta Apple da sua empresa e enviar a chave de notificações.',
      de: 'lojista',
    });
  }
  if (!entrada.googleVerificada) {
    pendencias.push({
      texto: 'Falta conectar a conta Google da sua empresa e enviar o arquivo de serviço.',
      de: 'lojista',
    });
  }
  if (entrada.bundleId == null || entrada.bundleId === '') {
    pendencias.push({
      texto: 'O app desta loja ainda não tem um identificador. Ele é definido na publicação.',
      de: 'storefy',
    });
  }

  return pendencias;
}

/**
 * O corpo da chamada de criação, no formato da Apps API da OneSignal.
 *
 * Separado e testado porque é a parte que falha em silêncio: um campo com o
 * nome trocado não dá erro de compilação nem de rede — o app é criado sem
 * credencial de iOS, e a descoberta acontece quando a primeira campanha não
 * chega em nenhum iPhone.
 */
export function corpoDaCriacao(credenciais: CredenciaisDaLoja): Record<string, unknown> {
  return {
    name: credenciais.nome,
    apns_env: credenciais.ambienteApns ?? 'production',
    apns_p8: credenciais.apnsP8,
    apns_key_id: credenciais.apnsKeyId,
    apns_team_id: credenciais.appleTeamId,
    apns_bundle_id: credenciais.bundleId,
    fcm_v1_service_account_json: credenciais.fcmServiceAccountJson,
  };
}

const TIMEOUT_MS = 30_000;

/**
 * Cria o app da loja na OneSignal.
 *
 * NÃO É IDEMPOTENTE: chamar duas vezes cria dois apps, e o segundo fica com os
 * mesmos certificados e nenhum aparelho. Quem chama precisa garantir que
 * `apps.onesignal_app_id` está vazio antes — é por isso que a ação do painel
 * relê essa coluna em vez de confiar no que a tela sabia.
 */
export async function criarAppDaLoja(
  orgApiKey: string,
  credenciais: CredenciaisDaLoja,
  buscador: typeof fetch = fetch,
): Promise<ResultadoDaCriacao> {
  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`${BASE_DA_API}/apps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${orgApiKey}`,
      },
      body: JSON.stringify(corpoDaCriacao(credenciais)),
      signal: controle.signal,
    });

    return lerRespostaDaCriacao(resposta.status, await resposta.text());
  } catch {
    return {
      ok: false,
      motivo: 'Não conseguimos falar com o serviço de notificações agora. Tente de novo.',
    };
  } finally {
    clearTimeout(relogio);
  }
}

/** Interpreta a resposta da criação. Separado para poder ser testado. */
export function lerRespostaDaCriacao(status: number, texto: string): ResultadoDaCriacao {
  let corpo: Record<string, unknown>;
  try {
    const lido: unknown = JSON.parse(texto);
    if (lido === null || typeof lido !== 'object') throw new Error('não é objeto');
    corpo = lido as Record<string, unknown>;
  } catch {
    return { ok: false, motivo: 'O serviço de notificações respondeu algo inesperado.' };
  }

  if (status < 200 || status >= 300) {
    return { ok: false, motivo: mensagemDeErro(corpo) };
  }

  const appId = corpo.id;
  /*
   * `basic_auth_key` é a chave REST daquele app, e a resposta da criação é a
   * ÚNICA vez em que ela aparece. Perdê-la aqui significaria um app criado na
   * OneSignal que a Storefy não consegue usar — e a correção seria apagar o
   * app e criar outro.
   */
  const chave = corpo.basic_auth_key;

  if (typeof appId !== 'string' || appId === '' || typeof chave !== 'string' || chave === '') {
    return {
      ok: false,
      motivo: 'O app foi criado, mas a resposta veio sem as chaves. Fale com o suporte.',
    };
  }

  return { ok: true, app: { appId, chaveRest: chave } };
}

function mensagemDeErro(corpo: Record<string, unknown>): string {
  const erros = corpo.errors;

  if (Array.isArray(erros)) {
    const primeiro = (erros as unknown[]).find(
      (item): item is string => typeof item === 'string' && item !== '',
    );
    if (primeiro !== undefined) return traduzir(primeiro);
  }
  if (erros !== null && typeof erros === 'object') {
    const valores: unknown[] = Object.values(erros as Record<string, unknown>).flat();
    const primeiro = valores.find(
      (item): item is string => typeof item === 'string' && item !== '',
    );
    if (primeiro !== undefined) return traduzir(primeiro);
  }

  return 'O serviço de notificações recusou os dados enviados.';
}

/**
 * Os erros que o lojista pode resolver ganham texto em pt-BR.
 *
 * O resto passa como veio: uma mensagem em inglês é ruim, mas é melhor do que
 * "algo deu errado" — pelo menos o suporte consegue procurar por ela.
 */
function traduzir(mensagem: string): string {
  const baixa = mensagem.toLowerCase();

  if (baixa.includes('p8') || baixa.includes('apns') || baixa.includes('certificate')) {
    return 'A chave de notificações da Apple não foi aceita. Gere outra e envie de novo.';
  }
  if (baixa.includes('service account') || baixa.includes('fcm') || baixa.includes('firebase')) {
    return 'O arquivo de serviço do Google não foi aceito. Baixe outro no Firebase e envie de novo.';
  }
  if (baixa.includes('unauthorized') || (baixa.includes('invalid') && baixa.includes('key'))) {
    return 'A Storefy precisa revisar a configuração do serviço de notificações.';
  }
  return mensagem;
}
