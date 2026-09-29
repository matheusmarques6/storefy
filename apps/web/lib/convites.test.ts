import { describe, expect, it } from 'vitest';
import {
  PAPEIS_CONVIDAVEIS,
  PRAZO_DO_CONVITE_DIAS,
  aceiteDeuCerto,
  cadastroDeLojistaPeloConviteSchema,
  cadastroPeloConviteSchema,
  conviteParaEmpresaSchema,
  linkDoConvite,
  mensagemDoAceite,
  montarEmailDoConvite,
  prazoDoConvite,
  resultadoDoAceite,
  segredoTemFormato,
  situacaoDoConvite,
  vencimentoDoConvite,
  type ResultadoDoAceite,
} from './convites';

const DIA = 24 * 60 * 60 * 1000;

describe('o que o banco devolve sobre o convite', () => {
  it('situação desconhecida vira "inexistente", e não um estado que a tela não sabe mostrar', () => {
    expect(situacaoDoConvite('pendente')).toBe('pendente');
    expect(situacaoDoConvite('expirado')).toBe('expirado');
    expect(situacaoDoConvite('qualquer coisa')).toBe('inexistente');
    expect(situacaoDoConvite(null)).toBe('inexistente');
  });

  it('resultado desconhecido do aceite também', () => {
    expect(resultadoDoAceite('aceito')).toBe('aceito');
    expect(resultadoDoAceite('outro_email')).toBe('outro_email');
    expect(resultadoDoAceite(undefined)).toBe('inexistente');
  });

  it('"já era membro" conta como certo: a pessoa está na empresa', () => {
    expect(aceiteDeuCerto('aceito')).toBe(true);
    expect(aceiteDeuCerto('ja_era_membro')).toBe(true);
    expect(aceiteDeuCerto('expirado')).toBe(false);
    expect(aceiteDeuCerto('outro_email')).toBe(false);
  });

  it('todo desfecho tem uma frase em português que diz o que fazer', () => {
    const todos: ResultadoDoAceite[] = [
      'aceito',
      'ja_era_membro',
      'expirado',
      'usado',
      'cancelado',
      'inexistente',
      'outro_email',
      'email_nao_confirmado',
    ];
    for (const resultado of todos) {
      const frase = mensagemDoAceite(resultado);
      expect(frase.length, resultado).toBeGreaterThan(20);
      expect(frase, resultado).not.toMatch(/invitation|token|error/i);
    }
    expect(mensagemDoAceite('outro_email', 'ana@loja.com.br')).toContain('ana@loja.com.br');
  });
});

describe('convidar para a empresa', () => {
  it('proprietário não se convida: vira-se dono por promoção, depois de entrar', () => {
    expect(PAPEIS_CONVIDAVEIS).not.toContain('owner');
    const recusado = conviteParaEmpresaSchema.safeParse({ email: 'a@b.com', papel: 'owner' });
    expect(recusado.success).toBe(false);
  });

  it('o e-mail vai como o banco guarda: minúsculo e sem espaço', () => {
    const certo = conviteParaEmpresaSchema.safeParse({
      email: '  Ana@Loja.COM.br ',
      papel: 'admin',
    });
    expect(certo.success && certo.data.email).toBe('ana@loja.com.br');
  });

  it('e-mail vazio ou torto tem erro no campo, em português', () => {
    const vazio = conviteParaEmpresaSchema.safeParse({ email: '', papel: 'member' });
    expect(vazio.success).toBe(false);
    expect(JSON.stringify(vazio.error?.issues)).toContain('Digite o e-mail da pessoa.');

    const torto = conviteParaEmpresaSchema.safeParse({ email: 'ana.loja', papel: 'member' });
    expect(JSON.stringify(torto.error?.issues)).toContain('não parece válido');
  });

  it('papel ausente pede para escolher', () => {
    const semPapel = conviteParaEmpresaSchema.safeParse({ email: 'a@b.com', papel: null });
    expect(JSON.stringify(semPapel.error?.issues)).toContain('Escolha o papel da pessoa.');
  });
});

describe('criar a conta pelo link', () => {
  it('pede nome e senha — o e-mail é o do convite, não do formulário', () => {
    expect(cadastroPeloConviteSchema.safeParse({ nome: 'Ana', senha: '12345678' }).success).toBe(
      true,
    );
    expect(cadastroPeloConviteSchema.safeParse({ nome: 'A', senha: '12345678' }).success).toBe(
      false,
    );
    expect(cadastroPeloConviteSchema.safeParse({ nome: 'Ana', senha: '123' }).success).toBe(false);
    expect(cadastroPeloConviteSchema.shape).not.toHaveProperty('email');
  });

  it('o lojista piloto dá o nome da empresa junto', () => {
    expect(
      cadastroDeLojistaPeloConviteSchema.safeParse({ nome: 'Ana', senha: '12345678' }).success,
    ).toBe(false);
    expect(
      cadastroDeLojistaPeloConviteSchema.safeParse({
        nome: 'Ana',
        senha: '12345678',
        nomeEmpresa: 'Loja Piloto',
      }).success,
    ).toBe(true);
  });
});

describe('o link', () => {
  it('só o formato que o servidor gera passa (43 caracteres de base64url)', () => {
    expect(segredoTemFormato('a'.repeat(43))).toBe(true);
    expect(segredoTemFormato('Ab_-9'.repeat(8) + 'xyz')).toBe(true);
    expect(segredoTemFormato('a'.repeat(42))).toBe(false);
    expect(segredoTemFormato(`${'a'.repeat(42)}/`)).toBe(false);
    expect(segredoTemFormato('../../admin')).toBe(false);
  });

  it('monta o endereço sem barra dobrada', () => {
    expect(linkDoConvite('https://app.storefy.com.br/', 'x')).toBe(
      'https://app.storefy.com.br/convite/x',
    );
  });

  it('vence em uma semana', () => {
    const agora = new Date('2026-09-29T12:00:00Z');
    expect(vencimentoDoConvite(agora).getTime() - agora.getTime()).toBe(
      PRAZO_DO_CONVITE_DIAS * DIA,
    );
  });

  it('o prazo em palavras', () => {
    const agora = Date.parse('2026-09-29T12:00:00Z');
    expect(prazoDoConvite('2026-10-06T12:00:00Z', agora)).toEqual({
      texto: 'Vence em 7 dias',
      vencido: false,
    });
    expect(prazoDoConvite('2026-09-29T20:00:00Z', agora)).toEqual({
      texto: 'Vence hoje',
      vencido: false,
    });
    expect(prazoDoConvite('2026-09-29T11:59:00Z', agora)).toEqual({
      texto: 'Venceu',
      vencido: true,
    });
    expect(prazoDoConvite('não é data', agora).vencido).toBe(true);
  });
});

describe('o e-mail do convite', () => {
  it('escapa o que vem de gente: nome da empresa e de quem convidou', () => {
    const email = montarEmailDoConvite({
      tipo: 'organizacao',
      empresa: 'Loja <script>alert(1)</script>',
      papel: 'admin',
      convidadoPor: 'Ana "Chefe"',
      link: 'https://app.storefy.com.br/convite/abc',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Ana &quot;Chefe&quot;');
    expect(email.html).toContain('href="https://app.storefy.com.br/convite/abc"');
    expect(email.texto).toContain('https://app.storefy.com.br/convite/abc');
    expect(email.texto).toContain('Administrador');
    expect(email.assunto).toContain('Loja <script>');
  });

  it('cada tipo diz o que é, e o prazo', () => {
    const conta = montarEmailDoConvite({ tipo: 'conta', convidadoPor: 'Bia', link: 'l' });
    expect(conta.assunto).toContain('criar o app da sua loja');
    const equipe = montarEmailDoConvite({
      tipo: 'equipe',
      papelNaPlataforma: 'superadmin',
      convidadoPor: 'Bia',
      link: 'l',
    });
    expect(equipe.texto).toContain('Superadmin');
    for (const email of [conta, equipe]) {
      expect(email.texto).toContain(`${String(PRAZO_DO_CONVITE_DIAS)} dias`);
    }
  });
});
