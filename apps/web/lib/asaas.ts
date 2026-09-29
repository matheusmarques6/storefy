import 'server-only';

/**
 * A API da Asaas — só o que a assinatura da Storefy usa: o cliente (quem
 * paga), a assinatura mensal e as faturas dela.
 *
 * As rotas, os cabeçalhos e os eventos seguem a integração oficial da Asaas
 * (`@asaasbr/n8n-nodes-asaas`): `access_token` no cabeçalho, `PUT` para
 * atualizar, `DELETE` para cancelar a assinatura.
 *
 * SEM CHAVE, NÃO COBRA E DIZ QUE NÃO COBROU. Não existe modo de teste
 * escondido: sem `ASAAS_API_KEY` a C15 mostra os planos e diz que a
 * assinatura pelo painel ainda não está ligada.
 */
import { reaisParaAsaas } from '@/lib/cobranca';

export const URL_DA_ASAAS = 'https://api.asaas.com/v3';
const TIMEOUT_MS = 15_000;

export type Resposta<T> = { ok: true; dados: T } | { ok: false; motivo: string; status: number };

/** A chave e o endereço, ou por que a cobrança ainda não está ligada. */
export function configuracaoDaAsaas():
  { ok: true; chave: string; url: string } | { ok: false; falta: string } {
  const chave = (process.env.ASAAS_API_KEY ?? '').trim();
  if (chave === '') return { ok: false, falta: 'ASAAS_API_KEY' };

  const url = (process.env.ASAAS_API_URL ?? '').trim().replace(/\/+$/, '') || URL_DA_ASAAS;
  /*
   * HTTPS sempre — a chave vai no cabeçalho. A exceção é a própria máquina,
   * que é onde o teste de ponta a ponta sobe um servidor no lugar da Asaas.
   */
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${url}/`);
  if (!url.startsWith('https://') && !local) {
    return { ok: false, falta: 'ASAAS_API_URL (precisa começar com https://)' };
  }
  return { ok: true, chave, url };
}

export function cobrancaConfigurada(): boolean {
  return configuracaoDaAsaas().ok;
}

/** O segredo que a Asaas manda em cada aviso, ou `null` sem configuração. */
export function tokenDoWebhook(): string | null {
  const token = (process.env.ASAAS_WEBHOOK_TOKEN ?? '').trim();
  // A Asaas aceita qualquer texto; curto demais se adivinha.
  return token.length >= 16 ? token : null;
}

interface ErroDaAsaas {
  errors?: { code?: string; description?: string }[];
}

/**
 * O motivo de uma recusa, pronto para a tela.
 *
 * O 400 da Asaas vem em português e fala do que a pessoa digitou ("O CPF/CNPJ
 * informado é inválido."): esse atravessa. Chave recusada e queda deles viram
 * frase nossa — e o detalhe vai para o log.
 */
export function motivoDaRecusa(status: number, corpo: unknown): string {
  if (status === 400) {
    const descricao = (corpo as ErroDaAsaas | null)?.errors?.[0]?.description?.trim();
    if (descricao != null && descricao !== '') return descricao;
    return 'A Asaas recusou os dados. Confira e tente de novo.';
  }
  if (status === 401 || status === 403) {
    return 'O sistema de cobrança recusou a nossa chave. Avise a equipe da Storefy pela Ajuda.';
  }
  if (status === 404) return 'O sistema de cobrança não encontrou este registro.';
  return 'Não conseguimos falar com o sistema de cobrança agora. Tente de novo em instantes.';
}

async function chamar<T>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  corpo: unknown,
  buscador: typeof fetch,
): Promise<Resposta<T>> {
  const config = configuracaoDaAsaas();
  if (!config.ok) {
    return { ok: false, status: 0, motivo: 'A cobrança pelo painel ainda não está ligada.' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(`${config.url}${caminho}`, {
      method: metodo,
      headers: {
        access_token: config.chave,
        'Content-Type': 'application/json',
        'User-Agent': 'Storefy',
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: controle.signal,
      cache: 'no-store',
    });

    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto === '' ? null : JSON.parse(texto);
    } catch {
      json = null;
    }

    if (!resposta.ok) {
      console.error('[asaas] recusado:', metodo, caminho, resposta.status, texto.slice(0, 500));
      return { ok: false, status: resposta.status, motivo: motivoDaRecusa(resposta.status, json) };
    }
    return { ok: true, dados: json as T };
  } catch (erro) {
    console.error(
      '[asaas] sem resposta:',
      metodo,
      caminho,
      erro instanceof Error ? erro.message : erro,
    );
    return { ok: false, status: 0, motivo: motivoDaRecusa(0, null) };
  } finally {
    clearTimeout(relogio);
  }
}

// -------------------------------------------------------------- clientes

export interface DadosDoCliente {
  nome: string;
  /** Só letras e números (`normalizarDocumento`). */
  documento: string;
  email: string;
  orgId: string;
}

function corpoDoCliente(dados: DadosDoCliente) {
  return {
    name: dados.nome,
    cpfCnpj: dados.documento,
    email: dados.email,
    externalReference: dados.orgId,
    // A Asaas avisa quem paga das faturas (vencendo, vencida, recebida).
    notificationDisabled: false,
  };
}

export async function criarCliente(
  dados: DadosDoCliente,
  buscador: typeof fetch = fetch,
): Promise<Resposta<{ id: string }>> {
  const resposta = await chamar<{ id?: unknown }>(
    'POST',
    '/customers',
    corpoDoCliente(dados),
    buscador,
  );
  if (!resposta.ok) return resposta;
  if (typeof resposta.dados.id !== 'string' || resposta.dados.id === '') {
    return { ok: false, status: 502, motivo: motivoDaRecusa(502, null) };
  }
  return { ok: true, dados: { id: resposta.dados.id } };
}

export async function atualizarCliente(
  id: string,
  dados: DadosDoCliente,
  buscador: typeof fetch = fetch,
): Promise<Resposta<null>> {
  const resposta = await chamar<unknown>(
    'PUT',
    `/customers/${encodeURIComponent(id)}`,
    corpoDoCliente(dados),
    buscador,
  );
  return resposta.ok ? { ok: true, dados: null } : resposta;
}

// ------------------------------------------------------------ assinatura

export interface NovaAssinatura {
  cliente: string;
  valorCentavos: number;
  /** "AAAA-MM-DD". */
  primeiroVencimento: string;
  descricao: string;
  orgId: string;
}

export async function criarAssinatura(
  dados: NovaAssinatura,
  buscador: typeof fetch = fetch,
): Promise<Resposta<{ id: string }>> {
  const resposta = await chamar<{ id?: unknown }>(
    'POST',
    '/subscriptions',
    {
      customer: dados.cliente,
      // "Pergunte ao cliente": a fatura abre com Pix, boleto e cartão, e quem
      // paga escolhe.
      billingType: 'UNDEFINED',
      value: reaisParaAsaas(dados.valorCentavos),
      nextDueDate: dados.primeiroVencimento,
      cycle: 'MONTHLY',
      description: dados.descricao,
      externalReference: dados.orgId,
    },
    buscador,
  );
  if (!resposta.ok) return resposta;
  if (typeof resposta.dados.id !== 'string' || resposta.dados.id === '') {
    return { ok: false, status: 502, motivo: motivoDaRecusa(502, null) };
  }
  return { ok: true, dados: { id: resposta.dados.id } };
}

/** Troca de plano: o valor novo vale também para a fatura que ainda está aberta. */
export async function mudarValorDaAssinatura(
  id: string,
  valorCentavos: number,
  descricao: string,
  buscador: typeof fetch = fetch,
): Promise<Resposta<null>> {
  const resposta = await chamar<unknown>(
    'PUT',
    `/subscriptions/${encodeURIComponent(id)}`,
    { value: reaisParaAsaas(valorCentavos), description: descricao, updatePendingPayments: true },
    buscador,
  );
  return resposta.ok ? { ok: true, dados: null } : resposta;
}

/**
 * Cancela na Asaas. Já cancelada lá (404) conta como feito: o que importa é
 * não haver cobrança saindo.
 */
export async function cancelarAssinatura(
  id: string,
  buscador: typeof fetch = fetch,
): Promise<Resposta<null>> {
  const resposta = await chamar<unknown>(
    'DELETE',
    `/subscriptions/${encodeURIComponent(id)}`,
    undefined,
    buscador,
  );
  if (resposta.ok || resposta.status === 404) return { ok: true, dados: null };
  return resposta;
}

export interface FaturaDaAsaas {
  id: string;
  value: number;
  status: string;
  dueDate: string;
  invoiceUrl: string | null;
  clientPaymentDate: string | null;
  paymentDate: string | null;
}

/** As faturas da assinatura, para gravar a primeira sem esperar o aviso. */
export async function faturasDaAssinatura(
  id: string,
  buscador: typeof fetch = fetch,
): Promise<Resposta<FaturaDaAsaas[]>> {
  const resposta = await chamar<{ data?: unknown }>(
    'GET',
    `/subscriptions/${encodeURIComponent(id)}/payments`,
    undefined,
    buscador,
  );
  if (!resposta.ok) return resposta;
  const lista = Array.isArray(resposta.dados.data) ? (resposta.dados.data as unknown[]) : [];
  const faturas = lista.flatMap((item): FaturaDaAsaas[] => {
    if (typeof item !== 'object' || item === null) return [];
    const f = item as Record<string, unknown>;
    if (typeof f.id !== 'string' || typeof f.status !== 'string' || typeof f.dueDate !== 'string') {
      return [];
    }
    return [
      {
        id: f.id,
        value: typeof f.value === 'number' ? f.value : 0,
        status: f.status,
        dueDate: f.dueDate,
        invoiceUrl: typeof f.invoiceUrl === 'string' ? f.invoiceUrl : null,
        clientPaymentDate: typeof f.clientPaymentDate === 'string' ? f.clientPaymentDate : null,
        paymentDate: typeof f.paymentDate === 'string' ? f.paymentDate : null,
      },
    ];
  });
  return { ok: true, dados: faturas };
}
