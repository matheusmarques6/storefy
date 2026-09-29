import { describe, expect, it, vi } from 'vitest';
import { abrirFicha, fichaNaLoja, lojaDaPlataforma, textosDaAtualizacao } from './loja-de-apps';

const APP = { appStoreId: '6478123456', pacoteAndroid: 'br.com.oakvintage.app' };

describe('fichaNaLoja', () => {
  it('no iPhone, a ficha pelo número do app na App Store', () => {
    expect(fichaNaLoja(APP, 'ios')).toEqual({
      nativo: 'itms-apps://apps.apple.com/app/id6478123456',
      web: 'https://apps.apple.com/app/id6478123456',
    });
  });

  it('no Android, a ficha pelo pacote', () => {
    expect(fichaNaLoja(APP, 'android')).toEqual({
      nativo: 'market://details?id=br.com.oakvintage.app',
      web: 'https://play.google.com/store/apps/details?id=br.com.oakvintage.app',
    });
  });

  /* Sem ficha, a tela explica onde procurar: nunca um botão que não abre nada. */
  it('sem o identificador da plataforma, não há ficha', () => {
    expect(fichaNaLoja({ ...APP, appStoreId: null }, 'ios')).toBeNull();
    expect(fichaNaLoja({ ...APP, pacoteAndroid: null }, 'android')).toBeNull();
    // O identificador da OUTRA plataforma não serve.
    expect(fichaNaLoja({ appStoreId: null, pacoteAndroid: 'br.com.x.app' }, 'ios')).toBeNull();
  });

  it('o nome da loja de cada plataforma, como o cliente a vê no celular', () => {
    expect(lojaDaPlataforma('ios')).toBe('App Store');
    expect(lojaDaPlataforma('android')).toBe('Play Store');
  });
});

describe('textosDaAtualizacao', () => {
  it('com a ficha, o corpo manda atualizar pela loja da plataforma', () => {
    const textos = textosDaAtualizacao({ plataforma: 'android', temFicha: true, nomeDoApp: 'Oak' });
    expect(textos.corpo).toBe(
      'Esta versão ficou para trás. Atualize pela Play Store para continuar comprando.',
    );
    // Se nada abrir, diz onde procurar, pelo nome do app.
    expect(textos.naoAbriu).toBe(
      'Não conseguimos abrir a Play Store. Abra a Play Store, procure por Oak e toque em Atualizar.',
    );
  });

  /* Sem a ficha não há botão: o próprio corpo diz onde procurar. */
  it('sem a ficha, o corpo já diz onde procurar', () => {
    expect(
      textosDaAtualizacao({ plataforma: 'ios', temFicha: false, nomeDoApp: 'Oak Vintage' }).corpo,
    ).toBe(
      'Esta versão ficou para trás. Abra a App Store, procure por Oak Vintage e toque em Atualizar.',
    );
  });

  it('sem o nome do app, "este app"', () => {
    expect(
      textosDaAtualizacao({ plataforma: 'ios', temFicha: false, nomeDoApp: '  ' }).corpo,
    ).toContain('procure por este app e');
  });
});

describe('abrirFicha', () => {
  const ficha = fichaNaLoja(APP, 'android');
  if (ficha === null) throw new Error('ficha de teste');

  it('abre direto no app da loja quando ele atende', async () => {
    const abrir = vi.fn(() => Promise.resolve(true));
    expect(await abrirFicha(ficha, abrir)).toBe(true);
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledWith(ficha.nativo);
  });

  /* Um Android sem Google Play (ou um simulador) não atende `market://`. */
  it('sem o app da loja, cai para a ficha no navegador', async () => {
    const abrir = vi.fn((url: string) =>
      url.startsWith('market:')
        ? Promise.reject(new Error('sem quem atenda'))
        : Promise.resolve(true),
    );
    expect(await abrirFicha(ficha, abrir)).toBe(true);
    expect(abrir.mock.calls.map(([url]) => url)).toEqual([ficha.nativo, ficha.web]);
  });

  it('nada abre: devolve false, e a tela diz onde procurar', async () => {
    const abrir = vi.fn(() => Promise.reject(new Error('nada')));
    expect(await abrirFicha(ficha, abrir)).toBe(false);
    expect(abrir).toHaveBeenCalledTimes(2);
  });
});
