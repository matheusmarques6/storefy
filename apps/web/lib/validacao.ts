/**
 * Schemas dos formulários. Um único lugar para as regras e as mensagens.
 * As mesmas mensagens aparecem no formulário e na Server Action, para o usuário
 * ver sempre o mesmo texto.
 */
import { z } from 'zod';

export const MIN_SENHA = 8;

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Informe seu e-mail.')
  // O `.email()` encadeado foi deprecado no Zod 4; `z.email()` é a forma atual.
  .pipe(z.email('E-mail inválido. Confira se digitou corretamente.'));

export const senhaSchema = z
  .string()
  .min(MIN_SENHA, `A senha precisa de pelo menos ${String(MIN_SENHA)} caracteres.`);

export const cadastroSchema = z.object({
  nomeEmpresa: z
    .string()
    .trim()
    .min(2, 'O nome da empresa precisa de pelo menos 2 caracteres.')
    .max(120, 'O nome da empresa é muito longo.'),
  email: emailSchema,
  senha: senhaSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, 'Informe sua senha.'),
});

export const recuperarSenhaSchema = z.object({ email: emailSchema });

export const redefinirSenhaSchema = z
  .object({
    senha: senhaSchema,
    confirmacao: z.string().min(1, 'Repita a nova senha.'),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: 'As senhas não conferem.',
    path: ['confirmacao'],
  });

/**
 * URL da loja.
 *
 * Aceita o que o lojista costuma digitar ("minhaloja.com.br") e normaliza para
 * https. Exigir o esquema seria correto e inútil: só geraria erro em um campo
 * que a gente sabe consertar.
 */
export const urlLojaSchema = z
  .string()
  .trim()
  .min(1, 'Informe o endereço da sua loja.')
  .transform((valor) => (/^https?:\/\//i.test(valor) ? valor : `https://${valor}`))
  .refine(
    (valor) => {
      try {
        const url = new URL(valor);
        // Precisa de um domínio com ponto: "localhost" ou "loja" não servem.
        return /^[^\s.]+\.[^\s.]{2,}/.test(url.hostname) && url.hostname.includes('.');
      } catch {
        return false;
      }
    },
    { message: 'Endereço inválido. Exemplo: minhaloja.com.br' },
  );

/**
 * O e-mail de atendimento da loja.
 *
 * OPCIONAL, e é de propósito: exigi-lo no cadastro travaria quem só quer ver o
 * painel funcionando. Ele vira necessário na hora de publicar — a política de
 * privacidade e a ficha do app pedem um contato —, e a tela de publicação diz
 * isso lá, onde faz diferença.
 *
 * Campo vazio vira `null`, e não string vazia: no banco, "sem contato" e
 * "contato em branco" precisam ser a mesma coisa, senão a política mostraria
 * um endereço vazio para o cliente final escrever.
 */
export const emailDeAtendimentoSchema = z
  .string()
  .trim()
  .max(200, 'O e-mail é muito longo.')
  .transform((valor) => (valor === '' ? null : valor))
  .refine(
    (valor) => valor === null || z.email().safeParse(valor).success,
    'Digite um e-mail válido, como atendimento@sualoja.com.br.',
  );

export const lojaSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'O nome da loja precisa de pelo menos 2 caracteres.')
    .max(120, 'O nome da loja é muito longo.'),
  url: urlLojaSchema,
  /*
   * Ausente vale como "sem contato". O cadastro não pede este campo — pedi-lo
   * ali travaria quem só quer ver o painel funcionando —, e a edição pede.
   */
  emailDeAtendimento: emailDeAtendimentoSchema.default(null),
});

export const organizacaoSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'O nome da empresa precisa de pelo menos 2 caracteres.')
    .max(120, 'O nome da empresa é muito longo.'),
});

export const contaSchema = z.object({
  nome: z.string().trim().max(120, 'O nome é muito longo.'),
});

export const trocarEmailSchema = z.object({ email: emailSchema });

export const trocarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe sua senha atual.'),
    senha: senhaSchema,
    confirmacao: z.string().min(1, 'Repita a nova senha.'),
  })
  .refine((dados) => dados.senha === dados.confirmacao, {
    message: 'As senhas não conferem.',
    path: ['confirmacao'],
  });

/** Erros por campo, no formato que os formulários consomem. */
export type ErrosDeCampo = Record<string, string>;

export function extrairErros(erro: z.ZodError): ErrosDeCampo {
  const erros: ErrosDeCampo = {};
  for (const problema of erro.issues) {
    const campo = String(problema.path[0] ?? '_');
    erros[campo] ??= problema.message;
  }
  return erros;
}
