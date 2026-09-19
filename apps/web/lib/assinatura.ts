import 'server-only';

/**
 * Assinatura das requisições que o app manda (seção 6 do plano).
 *
 * `/api/public/devices` e `/api/public/events` não têm sessão: quem fala ali é
 * o app instalado no celular do cliente final. Sem assinatura, qualquer um
 * poderia inventar aparelhos e eventos de carrinho de qualquer loja — e o
 * carrinho abandonado dispararia push para gente que nunca entrou na loja.
 *
 * O SEGREDO VIAJA DENTRO DO BINÁRIO, e isso é sabido: quem desmonta o app
 * acha. O que a assinatura entrega, então, não é sigilo — é que o segredo é
 * ÚNICO POR LOJA e revogável, e que o envio é datado. Um vazamento fica
 * contido numa loja e morre quando a chave é trocada, em vez de abrir o
 * endpoint para o produto inteiro.
 *
 * O formato segue o do Stripe (`t=<segundos>,v1=<hex>`) porque é o que
 * qualquer pessoa que já integrou webhook reconhece de imediato.
 */
import { createHmac } from 'node:crypto';
import { iguaisEmTempoConstante } from '@/lib/cripto';

export const CABECALHO_DA_ASSINATURA = 'x-storefy-signature';

/**
 * Quanto tempo uma assinatura vale.
 *
 * Cinco minutos cobre relógio de celular atrasado e 3G lento, e ainda deixa
 * curta a janela em que uma requisição capturada pode ser reenviada.
 */
export const TOLERANCIA_MS = 5 * 60 * 1000;

/** Monta o cabeçalho. O app faz o mesmo cálculo do lado dele. */
export function assinar(segredo: string, quandoMs: number, corpo: string): string {
  const t = Math.floor(quandoMs / 1000);
  return `t=${String(t)},v1=${calcular(segredo, t, corpo)}`;
}

function calcular(segredo: string, t: number, corpo: string): string {
  return createHmac('sha256', segredo)
    .update(`${String(t)}.${corpo}`)
    .digest('hex');
}

export type ResultadoDaAssinatura = { ok: true } | { ok: false; motivo: string };

/**
 * Confere o cabeçalho contra o corpo recebido.
 *
 * O motivo da recusa é para o NOSSO log, não para a resposta: contar ao
 * chamador que a assinatura está certa mas o horário venceu já entrega meio
 * caminho de um ataque de repetição.
 */
export function conferirAssinatura(
  cabecalho: string | null,
  segredo: string,
  corpo: string,
  agoraMs: number,
): ResultadoDaAssinatura {
  if (cabecalho === null || cabecalho.trim() === '') {
    return { ok: false, motivo: 'sem assinatura' };
  }
  if (segredo === '') {
    return { ok: false, motivo: 'app sem segredo configurado' };
  }

  const campos = new Map<string, string>();
  for (const parte of cabecalho.split(',')) {
    const igual = parte.indexOf('=');
    if (igual <= 0) continue;
    campos.set(parte.slice(0, igual).trim(), parte.slice(igual + 1).trim());
  }

  const t = Number.parseInt(campos.get('t') ?? '', 10);
  const v1 = campos.get('v1') ?? '';
  if (!Number.isFinite(t) || v1 === '') {
    return { ok: false, motivo: 'assinatura malformada' };
  }

  /*
   * A janela vale para os dois lados. Um relógio adiantado no celular é tão
   * comum quanto um atrasado, e recusar só o futuro deixaria uma parte dos
   * aparelhos sem conseguir registrar nada.
   */
  if (Math.abs(agoraMs - t * 1000) > TOLERANCIA_MS) {
    return { ok: false, motivo: 'assinatura fora da janela de tempo' };
  }

  // Comparação em tempo constante: `===` para na primeira diferença, e isso
  // basta para descobrir a assinatura byte a byte.
  if (!iguaisEmTempoConstante(v1, calcular(segredo, t, corpo))) {
    return { ok: false, motivo: 'assinatura não confere' };
  }

  return { ok: true };
}
