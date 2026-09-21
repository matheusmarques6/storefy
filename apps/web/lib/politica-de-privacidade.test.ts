import { describe, expect, it } from 'vitest';
import { formatarData, montarPolitica, type DadosDaPolitica } from '@/lib/politica-de-privacidade';

const BASE: DadosDaPolitica = {
  nomeDaLoja: 'Loja da Ana',
  urlDaLoja: 'https://lojadaana.com.br',
  emailDeContato: 'atendimento@lojadaana.com.br',
  pushLigado: true,
  eventosDeCarrinho: true,
  atualizadaEm: '2026-09-19T12:00:00.000Z',
};

const texto = (dados: DadosDaPolitica): string =>
  montarPolitica(dados)
    .secoes.flatMap((secao) => [secao.titulo, ...secao.paragrafos])
    .join('\n');

describe('montarPolitica', () => {
  it('diz de quem é a loja e quem é a Storefy', () => {
    const corpo = texto(BASE);
    expect(corpo).toContain('Loja da Ana');
    expect(corpo).toContain('lojadaana.com.br');
    expect(corpo).toContain('operadora');
  });

  /*
   * A seção que mais importa para o revisor: o que acontece DENTRO da loja é
   * da loja. O app é uma janela para o site dela, e a compra acontece lá.
   */
  it('deixa claro que a compra acontece no site da loja', () => {
    expect(texto(BASE)).toContain('acontecem no site');
  });

  /*
   * Uma política que descreve notificações num app que não notifica é uma
   * mentira que o revisor às vezes pega; uma que as omite num app que
   * notifica é um problema jurídico do lojista.
   */
  it('a seção de notificações só existe quando o push está ligado', () => {
    expect(texto({ ...BASE, pushLigado: true })).toContain('OneSignal');
    expect(texto({ ...BASE, pushLigado: false })).not.toContain('OneSignal');

    const semPush = montarPolitica({ ...BASE, pushLigado: false });
    expect(semPush.secoes.some((s) => s.titulo === 'Notificações')).toBe(false);
  });

  it('o carrinho só é descrito quando o app registra eventos', () => {
    expect(texto({ ...BASE, eventosDeCarrinho: true })).toContain('carrinho');
    const semCarrinho = texto({ ...BASE, eventosDeCarrinho: false, pushLigado: false });
    expect(semCarrinho).not.toContain('itens adicionados ao carrinho');
  });

  /*
   * Enumerar o que o app NÃO acessa é o que faz o revisor parar de procurar —
   * e é verdade: não há permissão de localização, câmera nem contatos no app.
   */
  it('lista o que o app não acessa', () => {
    const corpo = texto(BASE);
    for (const palavra of ['localização', 'câmera', 'contatos', 'microfone']) {
      expect(corpo).toContain(palavra);
    }
  });

  /*
   * Sem contato cadastrado, o texto NÃO inventa um endereço. Um e-mail
   * inventado numa política de privacidade é pior do que um canal indireto.
   */
  it('sem e-mail de contato, manda para o site em vez de inventar um endereço', () => {
    for (const vazio of [null, '', '   ']) {
      const corpo = texto({ ...BASE, emailDeContato: vazio });
      expect(corpo).toContain('canais de atendimento do site');
      expect(corpo).not.toContain('@');
    }
  });

  it('com e-mail de contato, é ele que aparece', () => {
    const corpo = texto(BASE);
    expect(corpo).toContain('atendimento@lojadaana.com.br');
    expect(corpo).not.toContain('canais de atendimento do site');
  });

  it('loja sem nome ganha um jeito de ser chamada', () => {
    const politica = montarPolitica({ ...BASE, nomeDaLoja: '   ' });
    expect(politica.titulo).toContain('esta loja');
    expect(politica.titulo).not.toMatch(/— *$/);
  });

  /** A LGPD exige que os direitos do titular estejam escritos. */
  it('lista os direitos do titular', () => {
    const corpo = texto(BASE);
    for (const direito of ['acesso', 'correção', 'exclusão', 'revogar o consentimento']) {
      expect(corpo).toContain(direito);
    }
  });

  it('nenhuma seção fica vazia', () => {
    for (const push of [true, false]) {
      for (const carrinho of [true, false]) {
        const politica = montarPolitica({
          ...BASE,
          pushLigado: push,
          eventosDeCarrinho: carrinho,
        });
        for (const secao of politica.secoes) {
          expect(secao.titulo.length, secao.titulo).toBeGreaterThan(3);
          expect(secao.paragrafos.length, secao.titulo).toBeGreaterThan(0);
          for (const paragrafo of secao.paragrafos) {
            expect(paragrafo.trim().length, secao.titulo).toBeGreaterThan(10);
          }
        }
      }
    }
  });

  it('não sobra marcador de template em lugar nenhum', () => {
    const corpo = texto(BASE) + montarPolitica(BASE).titulo;
    for (const marcador of ['{{', '}}', 'undefined', 'null', 'lorem', 'TODO', '[nome']) {
      expect(corpo.toLowerCase()).not.toContain(marcador.toLowerCase());
    }
  });
});

describe('formatarData', () => {
  it('escreve a data por extenso em pt-BR', () => {
    expect(formatarData('2026-09-19T12:00:00.000Z')).toContain('setembro');
    expect(formatarData('2026-09-19T12:00:00.000Z')).toContain('2026');
  });

  /** Data inválida vira vazio, nunca "Invalid Date" na cara do revisor. */
  it('data inválida vira vazio', () => {
    for (const ruim of ['', 'ontem', 'quase-uma-data']) {
      expect(formatarData(ruim)).toBe('');
    }
  });
});
