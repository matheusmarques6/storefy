import { describe, expect, it } from 'vitest';
import {
  PADRAO,
  TAMANHO_MAXIMO_DO_AVISO,
  conferirAviso,
  conferirLinkDaPrevia,
  lerConfiguracoes,
  ondeBaixarAPrevia,
} from '@/lib/configuracoes-da-plataforma';

describe('lerConfiguracoes', () => {
  it('sem nada no banco, vale o padrão: cadastro aberto, nenhum aviso, Preview sem link', () => {
    expect(lerConfiguracoes([])).toEqual(PADRAO);
    expect(PADRAO).toEqual({
      cadastroAberto: true,
      avisoNoPainel: '',
      previaNoIphone: '',
      previaNoAndroid: '',
    });
  });

  it('lê o que foi mudado', () => {
    expect(
      lerConfiguracoes([
        { chave: 'cadastro_aberto', valor: false },
        { chave: 'aviso_no_painel', valor: '  Manutenção hoje às 23h.  ' },
      ]),
    ).toEqual({ ...PADRAO, cadastroAberto: false, avisoNoPainel: 'Manutenção hoje às 23h.' });
  });

  it('lê os links do Storefy Preview', () => {
    const lido = lerConfiguracoes([
      { chave: 'previa_no_iphone', valor: 'https://apps.apple.com/br/app/storefy-preview/id1' },
      { chave: 'previa_no_android', valor: 'https://play.google.com/store/apps/details?id=br.x' },
    ]);
    expect(ondeBaixarAPrevia(lido)).toEqual({
      iphone: 'https://apps.apple.com/br/app/storefy-preview/id1',
      android: 'https://play.google.com/store/apps/details?id=br.x',
    });
  });

  /*
   * O botão é tocado por TODO lojista: um link gravado à mão que não passa na
   * conferência vira "ainda não publicado", e não um botão para outro lugar.
   */
  it('link gravado fora do lugar vira "sem link"', () => {
    const lido = lerConfiguracoes([
      { chave: 'previa_no_iphone', valor: 'https://play.google.com/store/apps/details?id=x' },
      { chave: 'previa_no_android', valor: 'http://play.google.com/x' },
    ]);
    expect(ondeBaixarAPrevia(lido)).toEqual({ iphone: '', android: '' });
  });

  /*
   * Estas chaves são lidas em toda tela do painel. Um valor de tipo errado —
   * gravado à mão no banco, numa versão futura — vira o padrão em vez de
   * derrubar o painel de todos os lojistas.
   */
  it('valor de tipo errado vira o padrão, sem estourar', () => {
    expect(
      lerConfiguracoes([
        { chave: 'cadastro_aberto', valor: 'false' },
        { chave: 'aviso_no_painel', valor: { texto: 'x' } },
      ]),
    ).toEqual(PADRAO);
  });

  it('aviso longo demais é cortado na leitura', () => {
    const lido = lerConfiguracoes([{ chave: 'aviso_no_painel', valor: 'a'.repeat(500) }]);
    expect(lido.avisoNoPainel).toHaveLength(TAMANHO_MAXIMO_DO_AVISO);
  });
});

describe('conferirLinkDaPrevia', () => {
  it('aceita a App Store e o TestFlight no iPhone, e o Google Play no Android', () => {
    expect(conferirLinkDaPrevia(' https://apps.apple.com/app/id1 ', 'iphone')).toEqual({
      ok: true,
      link: 'https://apps.apple.com/app/id1',
    });
    expect(conferirLinkDaPrevia('https://testflight.apple.com/join/abc', 'iphone').ok).toBe(true);
    expect(
      conferirLinkDaPrevia('https://play.google.com/apps/internaltest/123', 'android').ok,
    ).toBe(true);
  });

  it('vazio tira o botão', () => {
    expect(conferirLinkDaPrevia('   ', 'android')).toEqual({ ok: true, link: '' });
  });

  it('recusa o link da outra loja, sem https ou que não é endereço — dizendo qual campo', () => {
    const casos: [string, 'iphone' | 'android'][] = [
      ['https://play.google.com/store/apps/details?id=x', 'iphone'],
      ['https://apps.apple.com/app/id1', 'android'],
      ['http://apps.apple.com/app/id1', 'iphone'],
      ['https://apps.apple.com.golpe.com/app', 'iphone'],
      ['apps.apple.com/app/id1', 'iphone'],
    ];
    for (const [link, plataforma] of casos) {
      const conferido = conferirLinkDaPrevia(link, plataforma);
      expect(conferido.ok, link).toBe(false);
      expect(!conferido.ok && conferido.mensagem, link).toContain(
        plataforma === 'iphone' ? 'iPhone' : 'Android',
      );
    }
  });
});

describe('conferirAviso', () => {
  it('aceita e arruma os espaços', () => {
    expect(conferirAviso('  Manutenção   às 23h. ')).toEqual({
      ok: true,
      aviso: 'Manutenção às 23h.',
    });
  });

  it('vazio desliga o aviso', () => {
    expect(conferirAviso('   ')).toEqual({ ok: true, aviso: '' });
  });

  it('recusa comunicado longo', () => {
    expect(conferirAviso('a'.repeat(TAMANHO_MAXIMO_DO_AVISO + 1)).ok).toBe(false);
  });
});
