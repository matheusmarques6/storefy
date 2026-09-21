import { describe, expect, it } from 'vitest';
import { LIMITES, cortar, dominioDe, montarFicha, palavrasChave } from '@/lib/ficha-da-loja';

const BASE = {
  nomeDaLoja: 'Loja da Ana',
  urlDaLoja: 'https://www.lojadaana.com.br/colecoes',
  pushLigado: true,
};

describe('montarFicha', () => {
  /*
   * O limite é a razão de a ficha existir: a Apple TRUNCA sem avisar, e o app
   * vai para a loja com o texto cortado no meio — que é como o cliente final
   * vai encontrá-lo para sempre.
   */
  it('nenhum campo passa do limite da loja de aplicativos', () => {
    for (const push of [true, false]) {
      for (const nome of ['Loja da Ana', 'Uma Loja Com Um Nome Absurdamente Longo Mesmo', 'A']) {
        for (const campo of montarFicha({ ...BASE, nomeDaLoja: nome, pushLigado: push })) {
          expect(campo.valor.length, `${campo.chave} (${nome})`).toBeLessThanOrEqual(campo.limite);
        }
      }
    }
  });

  it('todo campo tem rótulo, lugar e conteúdo', () => {
    for (const campo of montarFicha(BASE)) {
      expect(campo.rotulo.length).toBeGreaterThan(3);
      expect(campo.onde.length).toBeGreaterThan(3);
      expect(campo.valor.trim().length).toBeGreaterThan(0);
    }
  });

  it('o nome do app é o nome da loja', () => {
    const titulo = montarFicha(BASE).find((c) => c.chave === 'titulo');
    expect(titulo?.valor).toBe('Loja da Ana');
  });

  /*
   * Prometer notificação num app sem notificação é motivo de recusa na
   * revisão: o revisor procura o recurso e não acha.
   */
  it('só promete notificações quando o app as tem', () => {
    const comPush = montarFicha({ ...BASE, pushLigado: true }).find((c) => c.chave === 'descricao');
    const semPush = montarFicha({ ...BASE, pushLigado: false }).find(
      (c) => c.chave === 'descricao',
    );

    expect(comPush?.valor).toContain('avisos');
    expect(semPush?.valor).not.toContain('avisos');
  });

  it('a descrição usa o domínio da loja, não a URL inteira', () => {
    const descricao = montarFicha(BASE).find((c) => c.chave === 'descricao');
    expect(descricao?.valor).toContain('lojadaana.com.br');
    expect(descricao?.valor).not.toContain('https://');
    expect(descricao?.valor).not.toContain('/colecoes');
  });

  it('loja sem nome ainda produz uma ficha usável', () => {
    for (const campo of montarFicha({ ...BASE, nomeDaLoja: '  ' })) {
      expect(campo.valor.trim().length).toBeGreaterThan(0);
      expect(campo.valor).not.toContain('undefined');
    }
  });

  it('não sobra marcador de template', () => {
    const tudo = montarFicha(BASE)
      .map((c) => c.valor)
      .join(' ');
    for (const marcador of ['{{', 'lorem', 'TODO', 'undefined', '[nome']) {
      expect(tudo.toLowerCase()).not.toContain(marcador.toLowerCase());
    }
  });
});

describe('palavrasChave', () => {
  /*
   * Separadas por vírgula SEM espaço: o espaço conta no limite de 100
   * caracteres, e a Apple ignora espaços na busca.
   */
  it('não gasta caractere com espaço', () => {
    expect(palavrasChave('Loja da Ana')).not.toContain(' ');
  });

  it('cabe no limite mesmo com nome comprido', () => {
    for (const nome of [
      'A',
      'Loja da Ana',
      'Uma Loja Absurdamente Longa De Roupas Femininas',
      // Comprido o bastante para as palavras do nome, sozinhas, estourarem os
      // 100 caracteres: é o caso em que o corte precisa mesmo acontecer.
      'Boutique Internacional Absolutamente Extraordinária Maravilhosa Incrível Fantástica Sensacional Deslumbrante',
    ]) {
      expect(palavrasChave(nome).length, nome).toBeLessThanOrEqual(LIMITES.palavrasChave);
    }
  });

  it('não repete palavra', () => {
    const lista = palavrasChave('Loja Loja Compras').split(',');
    expect(new Set(lista).size).toBe(lista.length);
  });

  /** Palavra de duas letras não ajuda ninguém a achar o app. */
  it('descarta palavras curtas demais do nome', () => {
    expect(palavrasChave('Ar de Sol').split(',')).not.toContain('ar');
    expect(palavrasChave('Ar de Sol').split(',')).toContain('sol');
  });

  it('pontuação no nome não vira palavra-chave', () => {
    expect(palavrasChave('Loja & Cia.')).not.toContain('&');
    expect(palavrasChave('Loja & Cia.')).not.toContain('.');
  });
});

describe('dominioDe', () => {
  it('tira o protocolo, o www e o caminho', () => {
    expect(dominioDe('https://www.lojadaana.com.br/x/y?z=1')).toBe('lojadaana.com.br');
    expect(dominioDe('http://loja.com')).toBe('loja.com');
  });

  /** Endereço torto não pode estourar: ele vem do cadastro do lojista. */
  it('endereço inválido ainda devolve algo utilizável', () => {
    expect(dominioDe('lojadaana.com.br')).toBe('lojadaana.com.br');
    expect(dominioDe('www.loja.com/x')).toBe('loja.com');
  });
});

describe('cortar', () => {
  it('texto curto passa inteiro', () => {
    expect(cortar('Loja da Ana', 30)).toBe('Loja da Ana');
  });

  /*
   * Uma descrição cortada no meio de uma palavra passa despercebida no painel
   * e aparece na loja de aplicativos para sempre.
   */
  it('corta no espaço, não no meio da palavra', () => {
    const original = 'Compre na Loja da Ana com entrega rápida';
    const resultado = cortar(original, 20);

    expect(resultado.length).toBeLessThanOrEqual(20);
    expect(resultado.endsWith(' ')).toBe(false);
    expect(original.startsWith(resultado)).toBe(true);

    /*
     * A prova do corte: o caractere seguinte no original tem de ser espaço (ou
     * o texto acabou). Sem isto, cortar no meio de uma palavra passaria — foi
     * o que aconteceu na primeira versão deste teste.
     */
    const seguinte = original.charAt(resultado.length);
    expect(seguinte === '' || seguinte === ' ', `cortou em "${resultado}|${seguinte}"`).toBe(true);
  });

  /** Uma palavra única maior que o limite é cortada mesmo: não há espaço. */
  it('palavra única gigante é cortada no limite', () => {
    expect(cortar('a'.repeat(50), 10)).toBe('a'.repeat(10));
  });

  it('apara espaço nas pontas', () => {
    expect(cortar('   Loja   ', 30)).toBe('Loja');
  });
});
