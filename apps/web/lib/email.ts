import 'server-only';

/**
 * Envio de e-mail transacional, pela Resend.
 *
 * É a Resend porque já é o que manda os e-mails de autenticação do Supabase
 * neste projeto — um remetente só, um domínio verificado só, uma conta só para
 * olhar quando algo não chega.
 *
 * SEM CHAVE, NÃO MANDA E DIZ QUE NÃO MANDOU. Não existe modo "faz de conta":
 * quem chama precisa saber que o aviso não saiu para poder tentar de novo
 * depois. Um `ok` mentiroso aqui faria o lojista nunca descobrir que o app foi
 * aprovado.
 */

const URL_DA_RESEND = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;

export interface Mensagem {
  para: readonly string[];
  assunto: string;
  /** Corpo em texto puro. Vai junto com o HTML, sempre. */
  texto: string;
  html: string;
}

export type Envio =
  | { ok: true }
  /** `passageiro` separa "tente de novo" de "não adianta tentar". */
  | { ok: false; passageiro: boolean; motivo: string };

/** O remetente configurado, ou `null` quando falta configuração. */
export function remetente(): string | null {
  const valor = process.env.EMAIL_REMETENTE;
  return valor == null || valor.trim() === '' ? null : valor.trim();
}

export function emailConfigurado(): boolean {
  const chave = process.env.RESEND_API_KEY;
  return chave != null && chave !== '' && remetente() !== null;
}

export async function enviarEmail(
  mensagem: Mensagem,
  buscador: typeof fetch = fetch,
): Promise<Envio> {
  const chave = process.env.RESEND_API_KEY;
  const de = remetente();

  if (chave == null || chave === '' || de === null) {
    return {
      ok: false,
      /*
       * Passageiro de propósito: quando a chave for configurada, o próximo
       * ciclo manda. Marcar como permanente faria o aviso ser descartado para
       * sempre por uma variável de ambiente que ainda vai ser preenchida.
       */
      passageiro: true,
      motivo: 'RESEND_API_KEY ou EMAIL_REMETENTE não configurados',
    };
  }

  const destinatarios = [...new Set(mensagem.para.map((e) => e.trim().toLowerCase()))].filter(
    (e) => e !== '',
  );
  if (destinatarios.length === 0) {
    return { ok: false, passageiro: false, motivo: 'nenhum destinatário' };
  }

  const controle = new AbortController();
  const relogio = setTimeout(() => {
    controle.abort();
  }, TIMEOUT_MS);

  try {
    const resposta = await buscador(URL_DA_RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: de,
        to: destinatarios,
        subject: mensagem.assunto,
        text: mensagem.texto,
        html: mensagem.html,
      }),
      signal: controle.signal,
    });

    return lerRespostaDaResend(resposta.status);
  } catch {
    return { ok: false, passageiro: true, motivo: 'não conseguimos falar com a Resend' };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * A Resend aceitou?
 *
 * A distinção entre passageiro e permanente decide se o aviso volta para a
 * fila. Chave errada (401) e domínio não verificado (403) não melhoram
 * sozinhos; limite de taxa e queda deles melhoram.
 */
export function lerRespostaDaResend(status: number): Envio {
  if (status >= 200 && status < 300) return { ok: true };

  if (status === 429 || status >= 500) {
    return { ok: false, passageiro: true, motivo: `Resend respondeu ${String(status)}` };
  }
  return { ok: false, passageiro: false, motivo: `Resend recusou com ${String(status)}` };
}

/**
 * Escapa texto que entra no HTML do e-mail.
 *
 * O nome da loja vem do lojista. Sem escapar, um nome com `<` quebraria o
 * layout do e-mail de todo mundo daquela organização — e cliente de e-mail não
 * é navegador, mas continua interpretando marcação.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
