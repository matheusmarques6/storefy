/**
 * Como o autor de uma linha da auditoria aparece (A12 e A04): o "quem" do
 * "quem fez o quê".
 *
 * Três casos, e cada um diz uma coisa diferente a quem investiga:
 *   - sem autor: foi o sistema — um gatilho, uma rotina, o aviso de um
 *     serviço de fora (a Shopify, o EAS, o Asaas);
 *   - autor que não existe mais: a conta foi excluída, e a linha fica;
 *   - uma pessoa: o nome, quando há, com o e-mail ao lado — e a marca de
 *     equipe, porque uma ação do suporte num cliente não pode parecer do
 *     cliente.
 */
export interface AutorDaAuditoria {
  email: string;
  nome: string | null;
  /** Está na equipe da plataforma (`platform_admins`). */
  equipe: boolean;
}

export type RotuloDoAutor =
  | { tipo: 'sistema'; texto: string }
  | { tipo: 'excluido'; texto: string }
  | { tipo: 'pessoa'; texto: string; detalhe: string | null; equipe: boolean };

export function rotuloDoAutor(
  actorId: string | null,
  autor: AutorDaAuditoria | undefined,
): RotuloDoAutor {
  if (actorId === null) return { tipo: 'sistema', texto: 'O sistema' };
  if (autor === undefined) return { tipo: 'excluido', texto: 'Conta excluída' };

  const nome = autor.nome?.trim() ?? '';
  return nome === ''
    ? { tipo: 'pessoa', texto: autor.email, detalhe: null, equipe: autor.equipe }
    : { tipo: 'pessoa', texto: nome, detalhe: autor.email, equipe: autor.equipe };
}
