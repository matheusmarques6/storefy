/**
 * Convites (C16 na empresa, A03 para lojista piloto, A11 para a equipe).
 *
 * O convite é um link com um segredo. O banco guarda só o hash
 * (`supabase/migrations/*_convites.sql`); quem cria vê o link UMA vez, na
 * resposta da ação — depois, só reenviando, que gera outro segredo e mata o
 * anterior.
 *
 * Este arquivo é puro (textos, regras, e-mail): roda no servidor e no teste.
 * O que toca em criptografia e no banco está em `convites-servidor.ts`.
 */
import { z } from 'zod';
import {
  ROTULO_PAPEL,
  type InvitationKind,
  type MembershipRole,
  type PlatformAdminRole,
} from '@storefy/db';
import { escaparHtml } from '@/lib/escapar-html';
import { senhaSchema } from '@/lib/validacao';

/** Prazo do link. Uma semana cobre férias curtas sem deixar link velho vivo. */
export const PRAZO_DO_CONVITE_DIAS = 7;

/** Convites em aberto de uma empresa ao mesmo tempo. */
export const MAXIMO_DE_CONVITES_EM_ABERTO = 50;

/** Convites (novos ou reenviados) por empresa, por hora. Freia spam pelo nosso domínio. */
export const CONVITES_POR_HORA = 20;

export type SituacaoDoConvite = 'pendente' | 'expirado' | 'usado' | 'cancelado' | 'inexistente';

export type ResultadoDoAceite =
  | 'aceito'
  | 'ja_era_membro'
  | 'expirado'
  | 'usado'
  | 'cancelado'
  | 'inexistente'
  | 'outro_email'
  | 'email_nao_confirmado';

const SITUACOES: readonly SituacaoDoConvite[] = [
  'pendente',
  'expirado',
  'usado',
  'cancelado',
  'inexistente',
];

const RESULTADOS: readonly ResultadoDoAceite[] = [
  'aceito',
  'ja_era_membro',
  'expirado',
  'usado',
  'cancelado',
  'inexistente',
  'outro_email',
  'email_nao_confirmado',
];

/** O que o banco devolveu, conferido: texto desconhecido vira "inexistente". */
export function situacaoDoConvite(valor: string | null | undefined): SituacaoDoConvite {
  return SITUACOES.find((situacao) => situacao === valor) ?? 'inexistente';
}

export function resultadoDoAceite(valor: string | null | undefined): ResultadoDoAceite {
  return RESULTADOS.find((resultado) => resultado === valor) ?? 'inexistente';
}

/** Deu certo? `ja_era_membro` também é: a pessoa está na empresa. */
export function aceiteDeuCerto(resultado: ResultadoDoAceite): boolean {
  return resultado === 'aceito' || resultado === 'ja_era_membro';
}

/** A frase de cada desfecho, para quem clicou em aceitar. */
export function mensagemDoAceite(resultado: ResultadoDoAceite, emailDoConvite?: string): string {
  switch (resultado) {
    case 'aceito':
      return 'Convite aceito. Bem-vindo à equipe!';
    case 'ja_era_membro':
      return 'Você já fazia parte desta empresa. Seu papel continua o mesmo.';
    case 'expirado':
      return 'Este convite venceu. Peça um novo a quem convidou você.';
    case 'usado':
      return 'Este convite já foi usado. Se foi você, é só entrar no painel.';
    case 'cancelado':
      return 'Este convite foi cancelado. Peça um novo a quem convidou você.';
    case 'inexistente':
      return 'Não encontramos este convite. Confira se o link está completo, ou peça um novo.';
    case 'outro_email':
      return emailDoConvite === undefined
        ? 'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.'
        : `Este convite é para ${emailDoConvite}. Entre com a conta desse e-mail para aceitar.`;
    case 'email_nao_confirmado':
      return 'Confirme seu e-mail antes de aceitar. Procure a mensagem que enviamos na sua caixa de entrada.';
  }
}

/** Os papéis que se dão por convite. Proprietário é por promoção, depois de entrar. */
export const PAPEIS_CONVIDAVEIS = ['admin', 'member'] as const satisfies readonly MembershipRole[];
export type PapelConvidavel = (typeof PAPEIS_CONVIDAVEIS)[number];

/** O que cada papel pode, em uma frase, para quem escolhe. */
export const O_QUE_O_PAPEL_PODE: Record<MembershipRole, string> = {
  owner: 'Tudo, inclusive excluir lojas e a empresa e cuidar da equipe.',
  admin: 'Cria e edita lojas, o app, as notificações e as integrações.',
  member: 'Só vê. Bom para quem acompanha os números.',
};

export const ROTULO_PAPEL_NA_PLATAFORMA: Record<PlatformAdminRole, string> = {
  superadmin: 'Superadmin',
  support: 'Suporte',
};

/** O e-mail, como o banco guarda: minúsculo e sem espaço. */
export function emailDoConvite(bruto: string): string {
  return bruto.trim().toLowerCase();
}

export const conviteParaEmpresaSchema = z.object({
  email: z
    .string({ error: 'Digite o e-mail da pessoa.' })
    .trim()
    .min(1, 'Digite o e-mail da pessoa.')
    .max(254, 'Esse e-mail é longo demais.')
    .pipe(z.email('Esse e-mail não parece válido. Confira se tem @ e o domínio.'))
    .transform(emailDoConvite),
  papel: z.enum(PAPEIS_CONVIDAVEIS, { error: 'Escolha o papel da pessoa.' }),
});

export const conviteDePlataformaSchema = z.object({
  email: conviteParaEmpresaSchema.shape.email,
});

/**
 * Criar a conta pelo link. O e-mail NÃO vem do formulário: é o do convite,
 * que o servidor lê do banco — o link não serve para criar conta com outro.
 */
export const cadastroPeloConviteSchema = z.object({
  nome: z
    .string({ error: 'Digite seu nome.' })
    .trim()
    .min(2, 'Digite seu nome, com pelo menos 2 letras.')
    .max(120, 'O nome é muito longo.'),
  senha: senhaSchema,
});

/** O lojista piloto cria a conta junto com a empresa, como no cadastro normal. */
export const cadastroDeLojistaPeloConviteSchema = cadastroPeloConviteSchema.extend({
  nomeEmpresa: z
    .string({ error: 'Digite o nome da sua empresa.' })
    .trim()
    .min(2, 'O nome da empresa precisa de pelo menos 2 caracteres.')
    .max(120, 'O nome da empresa é muito longo.'),
});

/**
 * O segredo tem a forma que `gerarSegredo` produz: 32 bytes em base64url.
 * Conferir antes de ir ao banco poupa uma consulta por link quebrado.
 */
export function segredoTemFormato(segredo: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(segredo);
}

export function linkDoConvite(base: string, segredo: string): string {
  return `${base.replace(/\/+$/, '')}/convite/${segredo}`;
}

/** "Vence em 3 dias", "Vence hoje", "Venceu" — para listas, a data exata importa menos. */
export function prazoDoConvite(
  expiraEm: string,
  agoraMs: number,
): { texto: string; vencido: boolean } {
  const restante = new Date(expiraEm).getTime() - agoraMs;
  if (!Number.isFinite(restante) || restante <= 0) return { texto: 'Venceu', vencido: true };
  const dias = Math.ceil(restante / (24 * 60 * 60 * 1000));
  return { texto: dias <= 1 ? 'Vence hoje' : `Vence em ${String(dias)} dias`, vencido: false };
}

/** A data de vencimento de um convite criado agora. */
export function vencimentoDoConvite(agora: Date): Date {
  return new Date(agora.getTime() + PRAZO_DO_CONVITE_DIAS * 24 * 60 * 60 * 1000);
}

export interface DadosDoEmailDeConvite {
  tipo: InvitationKind;
  /** Nome da empresa (convite de empresa). */
  empresa?: string | null;
  papel?: MembershipRole | null;
  papelNaPlataforma?: PlatformAdminRole | null;
  /** Nome ou e-mail de quem convidou. */
  convidadoPor: string;
  link: string;
}

/** Assunto, texto e HTML do e-mail do convite. Tudo que vem de gente é escapado. */
export function montarEmailDoConvite(dados: DadosDoEmailDeConvite): {
  assunto: string;
  texto: string;
  html: string;
} {
  const prazo = `O link vale por ${String(PRAZO_DO_CONVITE_DIAS)} dias e só funciona para este e-mail.`;
  let assunto: string;
  let chamada: string;
  let detalhe: string;

  if (dados.tipo === 'organizacao') {
    const empresa = dados.empresa ?? 'uma empresa';
    const papel = dados.papel ?? 'member';
    assunto = `${dados.convidadoPor} convidou você para ${empresa} na Storefy`;
    chamada = `${dados.convidadoPor} convidou você para a equipe de ${empresa} na Storefy, o painel do app da loja.`;
    detalhe = `Seu papel: ${ROTULO_PAPEL[papel]}. ${O_QUE_O_PAPEL_PODE[papel]}`;
  } else if (dados.tipo === 'conta') {
    assunto = 'Seu convite para criar o app da sua loja na Storefy';
    chamada = `${dados.convidadoPor}, da Storefy, convidou você para criar sua conta e transformar sua loja em app.`;
    detalhe = 'Você cria a conta com este e-mail e já começa a montar o app.';
  } else {
    const papel = dados.papelNaPlataforma ?? 'support';
    assunto = 'Convite para a equipe da Storefy';
    chamada = `${dados.convidadoPor} convidou você para a equipe da Storefy.`;
    detalhe = `Seu papel: ${ROTULO_PAPEL_NA_PLATAFORMA[papel]}.`;
  }

  const texto = [
    chamada,
    '',
    detalhe,
    '',
    `Para aceitar, abra: ${dados.link}`,
    '',
    prazo,
    'Se você não esperava este convite, é só ignorar esta mensagem.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
    <p>${escaparHtml(chamada)}</p>
    <p>${escaparHtml(detalhe)}</p>
    <p>
      <a href="${escaparHtml(dados.link)}" style="display: inline-block; background: #111; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none;">Aceitar o convite</a>
    </p>
    <p style="color: #555; font-size: 13px;">${escaparHtml(prazo)} Se você não esperava este convite, é só ignorar esta mensagem.</p>
  </body>
</html>`;

  return { assunto, texto, html };
}
