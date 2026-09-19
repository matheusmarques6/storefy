import 'server-only';

/**
 * O e-mail que o lojista recebe quando a Apple decide (passo 6 do plano).
 *
 * SÓ APROVADO E RECUSADO. `in_review` é informação; aprovado e recusado pedem
 * uma ação dele — publicar o app ou corrigir alguma coisa. Mandar os três
 * transformaria três dias de espera em três e-mails, e o terceiro seria lido
 * com a mesma atenção do segundo: nenhuma.
 *
 * O corpo é escrito para quem tem uma loja, não para quem faz apps: nada de
 * "binário", "bundle" ou "revisão de conformidade".
 */
import { escaparHtml, type Mensagem } from '@/lib/email';

export type DecisaoAvisavel = 'approved' | 'rejected';

/** Esta decisão merece um e-mail? */
export function mereceAviso(status: string): status is DecisaoAvisavel {
  return status === 'approved' || status === 'rejected';
}

export interface DadosDoAviso {
  decisao: DecisaoAvisavel;
  nomeDaLoja: string;
  plataforma: 'ios' | 'android';
  /** O que a Apple disse, já traduzido, quando recusou. */
  motivo: string | null;
  /** Link da tela de publicação. */
  url: string;
}

export function montarAviso(dados: DadosDoAviso): Omit<Mensagem, 'para'> {
  const loja = dados.nomeDaLoja.trim() === '' ? 'sua loja' : dados.nomeDaLoja.trim();
  const nomeDaStore = dados.plataforma === 'ios' ? 'App Store' : 'Play Store';

  if (dados.decisao === 'approved') {
    const assunto = `O app de ${loja} foi aprovado na ${nomeDaStore} 🎉`;
    const linhas = [
      `O app de ${loja} passou na revisão da ${nomeDaStore}.`,
      '',
      'Se a publicação estiver configurada para sair automaticamente, ele já está disponível para download. Se você escolheu publicar manualmente, falta só apertar o botão na loja.',
      '',
      `Acompanhe por aqui: ${dados.url}`,
    ];
    return { assunto, texto: linhas.join('\n'), html: html(assunto, linhas, dados.url) };
  }

  const assunto = `O app de ${loja} não passou na revisão da ${nomeDaStore}`;
  const linhas = [
    `A ${nomeDaStore} recusou esta versão do app de ${loja}.`,
    '',
    dados.motivo ?? 'O motivo detalhado está na conta de desenvolvedor da sua loja.',
    '',
    'Isso é comum e costuma se resolver numa segunda tentativa. Corrija o que foi apontado e publique de novo pelo painel.',
    '',
    `Veja os detalhes: ${dados.url}`,
  ];
  return { assunto, texto: linhas.join('\n'), html: html(assunto, linhas, dados.url) };
}

/**
 * O HTML do e-mail, em tabela e com estilo em linha.
 *
 * Não é preguiça nem código antigo: Gmail, Outlook e Yahoo descartam `<style>`
 * e não aplicam flexbox. Um layout moderno chega quebrado justamente nos três
 * clientes em que quase todo lojista lê e-mail.
 */
function html(assunto: string, linhas: readonly string[], url: string): string {
  const corpo = linhas
    .filter(
      (linha) =>
        linha !== '' &&
        !linha.startsWith('Acompanhe por aqui:') &&
        !linha.startsWith('Veja os detalhes:'),
    )
    .map(
      (linha) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111827">${escaparHtml(linha)}</p>`,
    )
    .join('');

  return [
    '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">',
    '<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px" cellpadding="0" cellspacing="0" border="0"><tr><td>',
    `<h1 style="margin:0 0 20px;font-size:19px;line-height:1.35;color:#111827">${escaparHtml(assunto)}</h1>`,
    corpo,
    `<p style="margin:24px 0 0"><a href="${escaparHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Abrir o painel</a></p>`,
    '<p style="margin:24px 0 0;font-size:12px;color:#6b7280">Você recebe este aviso porque administra esta loja na Storefy.</p>',
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
}
