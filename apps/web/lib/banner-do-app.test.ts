import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DO_TEXTO,
  TEXTO_PADRAO,
  linkDaAppStore,
  linkDaPlayStore,
  montarBanner,
  textoDoBanner,
} from '@/lib/banner-do-app';

const COMPLETO = {
  ligado: true,
  texto: 'Baixe o app da Oak Vintage',
  appStoreId: '6478123456',
  pacoteAndroid: 'br.com.oakvintage.app',
};

describe('montarBanner', () => {
  it('monta os dois links a partir do que o painel já sabe', () => {
    const banner = montarBanner(COMPLETO);

    expect(banner).toEqual({
      ativo: true,
      texto: 'Baixe o app da Oak Vintage',
      ios: 'https://apps.apple.com/app/id6478123456',
      android: 'https://play.google.com/store/apps/details?id=br.com.oakvintage.app',
      smartBanner: 'app-id=6478123456',
    });
  });

  it('banner desligado no painel não vira nada', () => {
    expect(montarBanner({ ...COMPLETO, ligado: false }).ativo).toBe(false);
  });

  it('loja desconhecida não vira nada', () => {
    expect(montarBanner(null).ativo).toBe(false);
  });

  /*
   * Convidar a baixar um app que ainda não está em loja nenhuma leva o cliente
   * a um erro — e o erro fica na vitrine do lojista, não na nossa.
   */
  it('sem nenhum link não há banner, mesmo ligado', () => {
    const banner = montarBanner({ ...COMPLETO, appStoreId: null, pacoteAndroid: null });

    expect(banner.ativo).toBe(false);
  });

  it('com um link só, o banner existe para aquela plataforma', () => {
    const soAndroid = montarBanner({ ...COMPLETO, appStoreId: null });
    expect(soAndroid.ativo).toBe(true);
    expect(soAndroid.ios).toBeNull();
    expect(soAndroid.smartBanner).toBeNull();

    const soIos = montarBanner({ ...COMPLETO, pacoteAndroid: null });
    expect(soIos.ativo).toBe(true);
    expect(soIos.android).toBeNull();
  });

  it('texto vazio vira o padrão, e não uma tarja em branco', () => {
    expect(montarBanner({ ...COMPLETO, texto: '   ' }).texto).toBe(TEXTO_PADRAO);
  });

  /*
   * A resposta vai para a vitrine da loja. Um id de app, de loja ou de
   * organização aqui transformaria este endereço numa forma de enumerar os
   * clientes da Storefy.
   */
  it('a resposta não carrega identificador nosso nenhum', () => {
    const banner = montarBanner(COMPLETO);

    expect(Object.keys(banner).sort()).toEqual(['android', 'ativo', 'ios', 'smartBanner', 'texto']);
  });
});

describe('textoDoBanner', () => {
  it('corta o que não cabe numa tarja de celular', () => {
    const longo = 'a'.repeat(MAXIMO_DO_TEXTO + 50);
    const cortado = textoDoBanner(longo);

    expect(cortado.length).toBe(MAXIMO_DO_TEXTO);
    expect(cortado.endsWith('…')).toBe(true);
  });

  it('texto no limite passa inteiro, sem reticências', () => {
    const exato = 'a'.repeat(MAXIMO_DO_TEXTO);

    expect(textoDoBanner(exato)).toBe(exato);
  });

  it('junta espaços e quebras que o lojista deixou no campo', () => {
    expect(textoDoBanner('  Baixe   o\n app  ')).toBe('Baixe o app');
  });
});

describe('linkDaAppStore', () => {
  it('monta o link a partir do id numérico', () => {
    expect(linkDaAppStore(' 6478123456 ')).toBe('https://apps.apple.com/app/id6478123456');
  });

  /*
   * O id vem do nosso banco, mas quem o preenche é um assistente que fala com
   * a Apple. Um valor estranho ali viraria um link para um endereço que não
   * controlamos, na vitrine do lojista.
   */
  it('recusa qualquer coisa que não seja só dígitos', () => {
    for (const id of [null, '', 'abc', '123abc', '../evil', 'https://evil.com', '12 34']) {
      expect(linkDaAppStore(id), String(id)).toBeNull();
    }
  });
});

describe('linkDaPlayStore', () => {
  it('monta o link a partir do pacote', () => {
    expect(linkDaPlayStore('br.com.oakvintage.app')).toBe(
      'https://play.google.com/store/apps/details?id=br.com.oakvintage.app',
    );
  });

  it('recusa o que não tem formato de pacote Android', () => {
    for (const pacote of [
      null,
      '',
      'semponto',
      'com.',
      '.com.x',
      'com..x',
      'com.x/../y',
      '9.a.b',
    ]) {
      expect(linkDaPlayStore(pacote), String(pacote)).toBeNull();
    }
  });
});
