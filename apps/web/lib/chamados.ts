/**
 * C17 — chamados do lojista para a equipe (A14 do lado do admin).
 *
 * Puro: rótulos, validação e o texto dos avisos por e-mail. O envio mora nas
 * ações, que sabem quem avisar.
 */
import { z } from 'zod';
import type { TicketStatus, TicketTopic } from '@storefy/db';
import { escaparHtml } from '@/lib/escapar-html';

export const ASSUNTOS: readonly TicketTopic[] = [
  'publicacao',
  'notificacoes',
  'shopify',
  'app',
  'cobranca',
  'outro',
];

export const ROTULO_DO_ASSUNTO: Record<TicketTopic, string> = {
  publicacao: 'Publicação nas lojas de aplicativos',
  notificacoes: 'Notificações',
  shopify: 'Shopify',
  app: 'Editor do app',
  cobranca: 'Cobrança',
  outro: 'Outro assunto',
};

/** A situação dita do ponto de vista de quem lê. */
export const ROTULO_DA_SITUACAO_PARA_LOJISTA: Record<TicketStatus, string> = {
  aberto: 'Aguardando a Storefy',
  respondido: 'Respondido',
  fechado: 'Fechado',
};

export const ROTULO_DA_SITUACAO_PARA_EQUIPE: Record<TicketStatus, string> = {
  aberto: 'Esperando resposta',
  respondido: 'Aguardando o cliente',
  fechado: 'Fechado',
};

/**
 * O que a data do chamado quer dizer. `updated_at` só muda com a SITUAÇÃO — a
 * mensagem que não troca a vez não mexe no chamado —, então, num chamado
 * esperando resposta, ela diz desde quando ele espera: a medida da fila.
 */
export const DATA_DA_SITUACAO_PARA_LOJISTA: Record<TicketStatus, string> = {
  aberto: 'aguardando desde',
  respondido: 'respondido em',
  fechado: 'fechado em',
};

export const DATA_DA_SITUACAO_PARA_EQUIPE: Record<TicketStatus, string> = {
  aberto: 'Esperando desde',
  respondido: 'Respondido em',
  fechado: 'Fechado em',
};

export const TAMANHO_MAXIMO_DA_MENSAGEM = 5000;

const texto = z
  .string({ error: 'Escreva a mensagem.' })
  .trim()
  .min(10, 'Conte um pouco mais: pelo menos 10 caracteres.')
  .max(
    TAMANHO_MAXIMO_DA_MENSAGEM,
    `A mensagem passa de ${String(TAMANHO_MAXIMO_DA_MENSAGEM)} caracteres.`,
  );

export const novoChamadoSchema = z.object({
  assunto: z.enum(ASSUNTOS as [TicketTopic, ...TicketTopic[]], { error: 'Escolha o assunto.' }),
  titulo: z
    .string({ error: 'Dê um título ao chamado.' })
    .trim()
    .min(3, 'Dê um título ao chamado, com pelo menos 3 letras.')
    .max(120, 'O título é longo demais: resuma em uma frase.'),
  mensagem: texto,
  /** Vazio é "não é sobre uma loja específica". */
  loja: z
    .string()
    .optional()
    .transform((valor) => (valor === undefined || valor === '' ? null : valor)),
});

export const respostaSchema = z.object({
  mensagem: z
    .string({ error: 'Escreva a resposta.' })
    .trim()
    .min(1, 'Escreva a resposta.')
    .max(
      TAMANHO_MAXIMO_DA_MENSAGEM,
      `A mensagem passa de ${String(TAMANHO_MAXIMO_DA_MENSAGEM)} caracteres.`,
    ),
});

interface AvisoDeChamado {
  titulo: string;
  empresa: string;
  assunto: TicketTopic;
  trecho: string;
  link: string;
}

/** Para a caixa do suporte: um chamado novo, ou o cliente respondeu. */
export function avisoParaOSuporte(dados: AvisoDeChamado & { novo: boolean }): {
  assunto: string;
  texto: string;
  html: string;
} {
  const assunto = dados.novo
    ? `[Chamado] ${dados.empresa}: ${dados.titulo}`
    : `[Chamado] ${dados.empresa} respondeu: ${dados.titulo}`;
  const trecho = dados.trecho.length > 600 ? `${dados.trecho.slice(0, 600)}…` : dados.trecho;
  const texto = [
    `${dados.novo ? 'Chamado novo' : 'Nova mensagem'} de ${dados.empresa} — ${ROTULO_DO_ASSUNTO[dados.assunto]}.`,
    '',
    trecho,
    '',
    `Responda pelo painel: ${dados.link}`,
  ].join('\n');
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
    <p><strong>${escaparHtml(dados.novo ? 'Chamado novo' : 'Nova mensagem')}</strong> de ${escaparHtml(dados.empresa)} — ${escaparHtml(ROTULO_DO_ASSUNTO[dados.assunto])}.</p>
    <p style="white-space: pre-wrap;">${escaparHtml(trecho)}</p>
    <p><a href="${escaparHtml(dados.link)}">Responder pelo painel</a></p>
  </body>
</html>`;
  return { assunto, texto, html };
}

/** Para quem abriu: a equipe respondeu. O texto vai inteiro — é a resposta. */
export function avisoDeResposta(dados: { titulo: string; resposta: string; link: string }): {
  assunto: string;
  texto: string;
  html: string;
} {
  const assunto = `A Storefy respondeu: ${dados.titulo}`;
  const texto = [
    `A equipe da Storefy respondeu o seu chamado "${dados.titulo}":`,
    '',
    dados.resposta,
    '',
    `Para responder ou fechar o chamado, abra: ${dados.link}`,
    '',
    'Você recebe este aviso porque abriu o chamado. Dá para desligar em Configurações › Empresa.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
    <p>A equipe da Storefy respondeu o seu chamado <strong>${escaparHtml(dados.titulo)}</strong>:</p>
    <blockquote style="margin: 0; padding: 8px 12px; border-left: 3px solid #ddd; white-space: pre-wrap;">${escaparHtml(dados.resposta)}</blockquote>
    <p><a href="${escaparHtml(dados.link)}">Responder ou fechar o chamado</a></p>
    <p style="color: #555; font-size: 13px;">Você recebe este aviso porque abriu o chamado. Dá para desligar em Configurações › Empresa.</p>
  </body>
</html>`;
  return { assunto, texto, html };
}
