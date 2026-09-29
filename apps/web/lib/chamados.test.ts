import { describe, expect, it } from 'vitest';
import {
  ASSUNTOS,
  DATA_DA_SITUACAO_PARA_EQUIPE,
  DATA_DA_SITUACAO_PARA_LOJISTA,
  ROTULO_DA_SITUACAO_PARA_EQUIPE,
  ROTULO_DA_SITUACAO_PARA_LOJISTA,
  ROTULO_DO_ASSUNTO,
  avisoDeResposta,
  avisoParaOSuporte,
  novoChamadoSchema,
  respostaSchema,
} from './chamados';

describe('abrir um chamado', () => {
  const valido = {
    assunto: 'publicacao',
    titulo: 'O app foi recusado',
    mensagem: 'A Apple recusou dizendo que falta a política de privacidade.',
    loja: '',
  };

  it('loja vazia vira "não é sobre uma loja"', () => {
    const resultado = novoChamadoSchema.safeParse(valido);
    expect(resultado.success && resultado.data.loja).toBeNull();
  });

  it('assunto fora da lista, título curto e mensagem curta têm erro em português', () => {
    const resultado = novoChamadoSchema.safeParse({
      assunto: 'hackear',
      titulo: 'oi',
      mensagem: 'ajuda',
    });
    expect(resultado.success).toBe(false);
    const texto = JSON.stringify(resultado.error?.issues);
    expect(texto).toContain('Escolha o assunto.');
    expect(texto).toContain('pelo menos 3 letras');
    expect(texto).toContain('pelo menos 10 caracteres');
  });

  it('todo assunto tem rótulo, e toda situação tem as duas leituras', () => {
    for (const assunto of ASSUNTOS) expect(ROTULO_DO_ASSUNTO[assunto].length).toBeGreaterThan(3);
    for (const situacao of ['aberto', 'respondido', 'fechado'] as const) {
      expect(ROTULO_DA_SITUACAO_PARA_LOJISTA[situacao]).not.toBe('');
      expect(ROTULO_DA_SITUACAO_PARA_EQUIPE[situacao]).not.toBe('');
      expect(DATA_DA_SITUACAO_PARA_LOJISTA[situacao]).not.toBe('');
      expect(DATA_DA_SITUACAO_PARA_EQUIPE[situacao]).not.toBe('');
    }
  });

  it('resposta vazia não sai', () => {
    expect(respostaSchema.safeParse({ mensagem: '   ' }).success).toBe(false);
    expect(respostaSchema.safeParse({ mensagem: 'Pode deixar.' }).success).toBe(true);
  });
});

describe('os avisos por e-mail', () => {
  it('escapam o que vem do lojista, e o título aparece no assunto', () => {
    const aviso = avisoParaOSuporte({
      titulo: 'Erro <b>grave</b>',
      empresa: 'Loja "Boa"',
      assunto: 'app',
      trecho: '<script>alert(1)</script>',
      link: 'https://app.storefy.com.br/admin/chamados/1',
      novo: true,
    });
    expect(aviso.assunto).toContain('Loja "Boa"');
    expect(aviso.html).not.toContain('<script>');
    expect(aviso.html).toContain('&lt;script&gt;');
    expect(aviso.html).toContain('Loja &quot;Boa&quot;');
    expect(aviso.texto).toContain('https://app.storefy.com.br/admin/chamados/1');
  });

  it('mensagem longa vai cortada para a caixa do suporte (o chamado inteiro está no painel)', () => {
    const aviso = avisoParaOSuporte({
      titulo: 't',
      empresa: 'e',
      assunto: 'outro',
      trecho: 'x'.repeat(2000),
      link: 'l',
      novo: false,
    });
    expect(aviso.texto.length).toBeLessThan(800);
    expect(aviso.assunto).toContain('respondeu');
  });

  it('a resposta vai inteira para quem abriu, com o caminho para desligar o aviso', () => {
    const aviso = avisoDeResposta({
      titulo: 'App recusado',
      resposta: 'Linha 1\nLinha 2 <com tag>',
      link: 'https://app.storefy.com.br/ajuda/chamados/1',
    });
    expect(aviso.texto).toContain('Linha 1\nLinha 2 <com tag>');
    expect(aviso.html).toContain('&lt;com tag&gt;');
    expect(aviso.texto).toContain('Configurações › Empresa');
  });
});
