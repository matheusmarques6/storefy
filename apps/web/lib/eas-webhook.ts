import 'server-only';

/**
 * O webhook do EAS (passo 4 da seção 7 do plano).
 *
 * O build leva de 15 a 30 minutos. Ficar perguntando ao EAS de minuto em
 * minuto gastaria cota e ainda assim daria uma tela atrasada; o webhook avisa
 * no instante em que termina.
 *
 * A ASSINATURA É SHA-1, e isso não é escolha nossa: é o que o EAS envia, no
 * cabeçalho `expo-signature`, no formato do GitHub (`sha1=<hex>`). SHA-1 não
 * serve mais para assinar documento, mas aqui ele protege contra forja de
 * mensagem com um segredo compartilhado, e quem escolhe o algoritmo é quem
 * envia. O que dá para fazer do nosso lado — e está feito — é comparar em
 * tempo constante e recusar quando o segredo não existe.
 */
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { iguaisEmTempoConstante } from '@/lib/cripto';

export const CABECALHO_DA_ASSINATURA = 'expo-signature';

export type Conferencia = { ok: true } | { ok: false; status: number; motivo: string };

/**
 * A assinatura confere com o corpo recebido?
 *
 * O corpo entra como TEXTO, igualzinho ao que chegou. Reserializar o JSON
 * mudaria um espaço e a assinatura deixaria de bater — e o sintoma seria
 * "o webhook parou de funcionar" sem nada nos logs.
 */
export function conferirAssinaturaDoEas(
  cabecalho: string | null,
  segredo: string | undefined,
  corpo: string,
): Conferencia {
  if (segredo == null || segredo === '') {
    return { ok: false, status: 503, motivo: 'EAS_WEBHOOK_SECRET não configurado' };
  }

  const recebida = (cabecalho ?? '').trim();
  if (recebida === '') return { ok: false, status: 401, motivo: 'sem assinatura' };

  const esperada = `sha1=${createHmac('sha1', segredo).update(corpo).digest('hex')}`;

  if (!iguaisEmTempoConstante(recebida, esperada)) {
    return { ok: false, status: 401, motivo: 'assinatura não confere' };
  }
  return { ok: true };
}

/**
 * O que o EAS manda quando um build termina.
 *
 * Só os campos que usamos — o payload real tem umas quarenta chaves, e exigir
 * que todas sejam conhecidas transformaria uma mudança do EAS numa queda
 * nossa.
 *
 * A VERSÃO E O NÚMERO DO BUILD MORAM EM `metadata`, e não no topo. Os campos
 * do topo estão aceitos aqui porque o payload do EAS mudou de forma entre
 * versões e não dá para conferir isto daqui contra o serviço real; aceitar os
 * dois lugares custa quatro linhas e evita um webhook que chega, é aceito e
 * grava a versão como nula.
 */
export const CorpoDoEas = z.object({
  id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  platform: z.string().trim().optional(),
  buildDetailsPageUrl: z.string().trim().optional(),
  artifacts: z
    .object({ buildUrl: z.string().trim().optional(), logsUrl: z.string().trim().optional() })
    .nullish(),
  metadata: z
    .object({
      appVersion: z.string().trim().optional(),
      appBuildVersion: z.string().trim().optional(),
    })
    .nullish(),
  appVersion: z.string().trim().optional(),
  appBuildVersion: z.string().trim().optional(),
  error: z.object({ message: z.string().optional(), errorCode: z.string().optional() }).nullish(),
});

export type CorpoDoEas = z.infer<typeof CorpoDoEas>;

export type StatusDoBuild = 'finished' | 'errored' | 'canceled';

/**
 * Traduz o status do EAS para o nosso.
 *
 * `null` para o que não conhecemos: um status novo inventado pelo EAS não pode
 * virar "aprovado" por acidente, e ignorar é mais seguro do que adivinhar.
 */
export function traduzirStatus(status: string): StatusDoBuild | null {
  switch (status.toLowerCase()) {
    case 'finished':
      return 'finished';
    case 'errored':
    case 'error':
      return 'errored';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return null;
  }
}

/** A versão do app que entrou no binário, venha de onde vier no payload. */
export function versaoDoBuild(corpo: CorpoDoEas): string | undefined {
  const bruta = corpo.metadata?.appVersion ?? corpo.appVersion ?? '';
  return bruta === '' ? undefined : bruta.slice(0, 40);
}

/**
 * O número do build, quando ele couber na coluna.
 *
 * `appBuildVersion` é TEXTO no EAS, e no iOS o `CFBundleVersion` pode ser
 * `1.2.3`. `parseInt('1.2.3')` devolveria 1 em silêncio, gravando um número
 * errado na trilha — então só passa o que é dígito puro e cabe num `integer`.
 * O resto fica nulo, e a tela simplesmente não mostra o número.
 */
export function numeroDoBuild(corpo: CorpoDoEas): number | undefined {
  const bruto = corpo.metadata?.appBuildVersion ?? corpo.appBuildVersion ?? '';
  if (!/^\d+$/.test(bruto)) return undefined;

  const numero = Number(bruto);
  return Number.isSafeInteger(numero) && numero >= 1 && numero <= 2147483647 ? numero : undefined;
}

/**
 * O link que o lojista abre para ver os detalhes.
 *
 * A página do build vem antes do arquivo de log: ela mostra o andamento, os
 * artefatos e o erro numa tela só, enquanto o log cru é uma parede de texto.
 */
export function urlDosLogs(corpo: CorpoDoEas): string | undefined {
  for (const candidata of [corpo.buildDetailsPageUrl, corpo.artifacts?.logsUrl]) {
    if (candidata == null || candidata === '') continue;
    if (/^https?:\/\//i.test(candidata)) return candidata.slice(0, 2000);
  }
  return undefined;
}

/**
 * O link do binário gerado.
 *
 * É por ele que o lojista baixa o `.aab` quando o envio automático não é
 * possível — no Google, o PRIMEIRO envio de um app é sempre manual. Sem
 * guardar este link, ele não teria o que subir e o build "pronto" não serviria
 * para nada.
 */
export function urlDoBinario(corpo: CorpoDoEas): string | undefined {
  const url = corpo.artifacts?.buildUrl ?? '';
  return /^https?:\/\//i.test(url) ? url.slice(0, 2000) : undefined;
}

/**
 * O erro do EAS em texto para o lojista.
 *
 * A mensagem crua do EAS costuma ser um stack de Gradle ou de Xcode. Quando dá
 * para reconhecer a causa, ela vira uma instrução; quando não dá, o texto do
 * EAS passa inteiro — ruim, mas melhor do que "algo deu errado", porque o
 * suporte consegue procurar por ele.
 */
export function mensagemDoErro(erro: { message?: string; errorCode?: string } | null): string {
  const codigo = (erro?.errorCode ?? '').toUpperCase();
  const texto = erro?.message ?? '';

  if (codigo.includes('CREDENTIALS') || /credential|provisioning|certificate/i.test(texto)) {
    return 'As credenciais da sua conta Apple não foram aceitas. Reconecte a conta e tente de novo.';
  }
  if (codigo.includes('QUOTA') || /concurrency|queue limit/i.test(texto)) {
    return 'A fila de geração está cheia agora. Tente publicar de novo em alguns minutos.';
  }
  if (/icon|image/i.test(texto) && /invalid|size|dimension/i.test(texto)) {
    return 'A imagem do app não foi aceita. Envie um ícone quadrado de 1024×1024 sem transparência.';
  }

  return texto === ''
    ? 'A geração do app falhou. Nossa equipe já foi avisada.'
    : texto.slice(0, 2000);
}

/** O que a linha de `builds` passa a valer depois deste webhook. */
export interface AtualizacaoDoBuild {
  status: StatusDoBuild;
  finished_at: string;
  version?: string;
  build_number?: number;
  logs_url?: string;
  artifact_url?: string;
  error?: string;
}

/**
 * Monta a atualização a partir do payload.
 *
 * Os campos que o EAS não mandou saem como `undefined` DE PROPÓSITO: o
 * supabase-js não os serializa, então a coluna fica como estava. Mandar `null`
 * apagaria o `logs_url` que o workflow já tinha gravado quando pôs o build na
 * fila — e o lojista perderia justamente o link de onde ver o que houve.
 */
export function montarAtualizacao(
  corpo: CorpoDoEas,
  status: StatusDoBuild,
  agora: string,
): AtualizacaoDoBuild {
  return {
    status,
    finished_at: agora,
    version: versaoDoBuild(corpo),
    build_number: numeroDoBuild(corpo),
    logs_url: urlDosLogs(corpo),
    artifact_url: urlDoBinario(corpo),
    error: status === 'errored' ? mensagemDoErro(corpo.error ?? null) : undefined,
  };
}
