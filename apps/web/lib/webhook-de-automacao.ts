/**
 * O webhook de automação (C09 e C14): o que a Storefy aceita de fora.
 *
 * Quem chama é a ferramenta de marketing da loja — um fluxo do Klaviyo, uma
 * automação do Omnisend, um nó do n8n. Ela diz QUEM recebe (o id do cliente na
 * Shopify, ou o e-mail) e, se quiser, o texto. Funções puras: a rota só liga
 * isto ao banco, e o teste prova as fronteiras sem rede.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { MAXIMO_DO_CORPO, MAXIMO_DO_TITULO } from '@/lib/campanha';

/**
 * `gid://shopify/Customer/123`, `123` ou 123 → `"123"`: é assim que o app grava
 * o cliente no aparelho (o `__st.cid` da página). Qualquer outra coisa é `null`.
 */
export function idDoCliente(bruto: unknown): string | null {
  const texto = typeof bruto === 'number' ? String(bruto) : typeof bruto === 'string' ? bruto : '';
  const casou = /^(?:gid:\/\/shopify\/Customer\/)?(\d{1,20})$/.exec(texto.trim());
  return casou?.[1] ?? null;
}

/** A busca da Shopify, com o e-mail entre aspas e sem nada que quebre a sintaxe. */
export function buscaPeloEmail(email: string): string {
  return `email:"${email.trim().replace(/["\\]/g, '')}"`;
}

/**
 * O prefixo deixa a chave reconhecível — para o lojista, e para os
 * varredores de segredo (o do GitHub acha `sfy_wh_` num repositório público).
 */
export const PREFIXO_DA_CHAVE = 'sfy_wh_';
const FORMATO_DA_CHAVE = /^sfy_wh_[A-Za-z0-9_-]{43}$/;

/** 32 bytes aleatórios: a chave, mostrada uma vez e nunca guardada. */
export function gerarChave(): string {
  return `${PREFIXO_DA_CHAVE}${randomBytes(32).toString('base64url')}`;
}

export function hashDaChave(chave: string): string {
  return createHash('sha256').update(chave, 'utf8').digest('hex');
}

/** Os 4 últimos caracteres, para a tela mostrar "termina em ••••abcd". */
export function dicaDaChave(chave: string): string {
  return chave.slice(-4);
}

/**
 * A chave do pedido: no cabeçalho (`Authorization: Bearer ...`), que é o
 * recomendado, ou em `?token=`, para a ferramenta que não deixa pôr cabeçalho.
 * Qualquer coisa fora do formato é `null` — nem chega ao banco.
 */
export function chaveDoPedido(autorizacao: string | null, token: string | null): string | null {
  const doCabecalho = /^Bearer\s+(\S+)$/i.exec((autorizacao ?? '').trim())?.[1];
  const chave = doCabecalho ?? token?.trim() ?? '';
  return FORMATO_DA_CHAVE.test(chave) ? chave : null;
}

/** O maior corpo aceito: o texto mais longo, com folga para o resto. */
export const TAMANHO_MAXIMO_DO_CORPO = 8 * 1024;
/** Quantos clientes um aviso alcança. Mais do que isso é campanha, não fluxo. */
export const MAXIMO_DE_CLIENTES = 50;

/** O id do cliente na Shopify: só números, ou o gid. O que não for, recusa dizendo. */
const idAceito = z.union([z.string(), z.number()]).refine((valor) => idDoCliente(valor) !== null, {
  message: 'Use o id do cliente na Shopify: só números, ou o gid://shopify/Customer/….',
});

export const CorpoDoWebhook = z
  .object({
    customerId: idAceito.optional(),
    customerIds: z.array(idAceito).max(MAXIMO_DE_CLIENTES).optional(),
    email: z.email({ message: 'O e-mail não parece válido.' }).max(254).optional(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(MAXIMO_DO_TITULO, {
        message: `O título passa de ${String(MAXIMO_DO_TITULO)} caracteres.`,
      })
      .optional(),
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAXIMO_DO_CORPO, { message: `O texto passa de ${String(MAXIMO_DO_CORPO)} caracteres.` })
      .optional(),
    deepLink: z.string().trim().max(500).optional(),
    /** O id do evento na ferramenta: a mesma entrega repetida não vira dois pushes. */
    id: z.union([z.string().trim().max(100), z.number()]).optional(),
  })
  .refine(
    (corpo) =>
      corpo.customerId !== undefined ||
      (corpo.customerIds !== undefined && corpo.customerIds.length > 0) ||
      corpo.email !== undefined,
    { message: 'Diga quem recebe: customerId, customerIds ou email.', path: ['customerId'] },
  );

export type CorpoDoWebhook = z.infer<typeof CorpoDoWebhook>;

/**
 * Os ids de cliente do corpo, no formato que o app grava (`"123"`). Aceita o
 * número, o texto e o gid da Shopify; o que não for id de cliente fica de fora.
 */
export function clientesDoCorpo(corpo: CorpoDoWebhook): string[] {
  const brutos = [
    ...(corpo.customerId === undefined ? [] : [corpo.customerId]),
    ...(corpo.customerIds ?? []),
  ];
  const ids = brutos.map(idDoCliente).filter((id): id is string => id !== null);
  return [...new Set(ids)];
}
