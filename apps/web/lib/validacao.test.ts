import { describe, expect, it } from 'vitest';
import {
  cadastroSchema,
  extrairErros,
  lojaSchema,
  redefinirSenhaSchema,
  urlLojaSchema,
} from './validacao';

describe('urlLojaSchema', () => {
  it('aceita URL completa e mantém o esquema', () => {
    expect(urlLojaSchema.parse('https://minhaloja.com.br')).toBe('https://minhaloja.com.br');
  });

  it('completa com https quando o lojista digita só o domínio', () => {
    // É o que a pessoa realmente digita. Exigir o esquema só geraria erro em um
    // campo que sabemos consertar.
    expect(urlLojaSchema.parse('minhaloja.com.br')).toBe('https://minhaloja.com.br');
  });

  it('preserva http quando informado explicitamente', () => {
    expect(urlLojaSchema.parse('http://minhaloja.com.br')).toBe('http://minhaloja.com.br');
  });

  it('remove espaços em volta', () => {
    expect(urlLojaSchema.parse('  minhaloja.com.br  ')).toBe('https://minhaloja.com.br');
  });

  it('aceita subdomínio e caminho', () => {
    expect(urlLojaSchema.parse('loja.exemplo.com.br/br')).toBe('https://loja.exemplo.com.br/br');
    expect(urlLojaSchema.parse('minha-loja.myshopify.com')).toBe(
      'https://minha-loja.myshopify.com',
    );
  });

  it('recusa domínio sem ponto', () => {
    expect(urlLojaSchema.safeParse('localhost').success).toBe(false);
    expect(urlLojaSchema.safeParse('minhaloja').success).toBe(false);
  });

  it('recusa texto vazio', () => {
    expect(urlLojaSchema.safeParse('').success).toBe(false);
    expect(urlLojaSchema.safeParse('   ').success).toBe(false);
  });

  it('recusa entrada que não forma URL', () => {
    expect(urlLojaSchema.safeParse('http://').success).toBe(false);
    expect(urlLojaSchema.safeParse('a b c').success).toBe(false);
  });
});

describe('lojaSchema', () => {
  it('aceita nome e URL válidos', () => {
    const resultado = lojaSchema.parse({ nome: 'Minha Loja', url: 'minhaloja.com.br' });
    expect(resultado).toEqual({
      nome: 'Minha Loja',
      url: 'https://minhaloja.com.br',
      // Sem o campo, "sem contato": o cadastro não o pede, a edição pede.
      emailDeAtendimento: null,
    });
  });

  /*
   * O e-mail de atendimento vai para a política de privacidade do app, que o
   * cliente final lê. Campo em branco precisa virar `null`, e não string
   * vazia: a política mostraria um endereço vazio para ele escrever.
   */
  it('e-mail de atendimento em branco vira null, não string vazia', () => {
    for (const vazio of ['', '   ', undefined]) {
      const resultado = lojaSchema.parse({
        nome: 'Minha Loja',
        url: 'x.com.br',
        emailDeAtendimento: vazio,
      });
      expect(resultado.emailDeAtendimento).toBeNull();
    }
  });

  it('aceita e-mail de atendimento válido, sem espaços', () => {
    const resultado = lojaSchema.parse({
      nome: 'Minha Loja',
      url: 'x.com.br',
      emailDeAtendimento: '  atendimento@loja.com.br ',
    });
    expect(resultado.emailDeAtendimento).toBe('atendimento@loja.com.br');
  });

  it('recusa e-mail de atendimento inválido', () => {
    for (const ruim of ['atendimento', 'a@', '@loja.com', 'a b@loja.com']) {
      const r = lojaSchema.safeParse({
        nome: 'Minha Loja',
        url: 'x.com.br',
        emailDeAtendimento: ruim,
      });
      expect(r.success, ruim).toBe(false);
    }
  });

  it('recusa nome com menos de 2 caracteres', () => {
    expect(lojaSchema.safeParse({ nome: 'A', url: 'minhaloja.com.br' }).success).toBe(false);
  });

  it('remove espaços do nome', () => {
    expect(lojaSchema.parse({ nome: '  Minha Loja  ', url: 'x.com.br' }).nome).toBe('Minha Loja');
  });
});

describe('cadastroSchema', () => {
  it('aceita cadastro válido', () => {
    const dados = {
      nomeEmpresa: 'Convertfy',
      email: 'pessoa@convertfy.me',
      senha: 'senhaforte123',
    };
    expect(cadastroSchema.safeParse(dados).success).toBe(true);
  });

  it('recusa e-mail inválido', () => {
    const resultado = cadastroSchema.safeParse({
      nomeEmpresa: 'Convertfy',
      email: 'pessoa-arroba-convertfy',
      senha: 'senhaforte123',
    });
    expect(resultado.success).toBe(false);
  });

  it('recusa senha com menos de 8 caracteres', () => {
    const resultado = cadastroSchema.safeParse({
      nomeEmpresa: 'Convertfy',
      email: 'pessoa@convertfy.me',
      senha: 'curta',
    });
    expect(resultado.success).toBe(false);
  });
});

describe('redefinirSenhaSchema', () => {
  it('aceita quando as senhas conferem', () => {
    expect(
      redefinirSenhaSchema.safeParse({ senha: 'senhaforte123', confirmacao: 'senhaforte123' })
        .success,
    ).toBe(true);
  });

  it('recusa quando as senhas não conferem, apontando o campo de confirmação', () => {
    const resultado = redefinirSenhaSchema.safeParse({
      senha: 'senhaforte123',
      confirmacao: 'outra-senha',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['confirmacao']);
  });
});

describe('extrairErros', () => {
  it('devolve uma mensagem por campo', () => {
    const resultado = cadastroSchema.safeParse({ nomeEmpresa: '', email: 'x', senha: '1' });
    if (resultado.success) throw new Error('esperava falha de validação');
    const erros = extrairErros(resultado.error);
    expect(Object.keys(erros).sort()).toEqual(['email', 'nomeEmpresa', 'senha']);
  });

  it('mantém a primeira mensagem quando o campo tem mais de um erro', () => {
    const resultado = cadastroSchema.safeParse({ nomeEmpresa: 'ok', email: '', senha: 'x' });
    if (resultado.success) throw new Error('esperava falha de validação');
    const erros = extrairErros(resultado.error);
    expect(erros.email).toBe('Informe seu e-mail.');
  });
});
