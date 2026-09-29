import { describe, expect, it } from 'vitest';
import { configInicial, type AppConfig } from '@storefy/config-schema';
import { editarRecursos } from '@/lib/editor-de-config';
import { LIMITE_DAS_NOTAS, montarNotasDaRevisao } from '@/lib/notas-da-revisao';

const LOJA = { name: 'Oak Vintage', url: 'https://www.oakvintage.com.br' };

function notas(config: AppConfig, pushLigado = false): string {
  return montarNotasDaRevisao({
    nomeDaLoja: LOJA.name,
    urlDaLoja: LOJA.url,
    pushLigado,
    config,
  });
}

const comAvisos = (): AppConfig => {
  const config = configInicial(LOJA);
  config.tabs.push({
    id: 'avisos',
    label: 'Avisos',
    icon: 'bell',
    type: 'notifications',
    badge: 'unread',
  });
  return config;
};

describe('notas para a revisão da Apple', () => {
  it('apresenta a loja pelo nome e pelo domínio, sem o www', () => {
    expect(notas(configInicial(LOJA))).toMatch(
      /^This is the official app of Oak Vintage \(oakvintage\.com\.br\)/,
    );
  });

  it('lista as abas que o revisor vai ver, com o nome que o lojista deu', () => {
    expect(notas(configInicial(LOJA))).toContain(
      'Native tab bar ("Início", "Buscar", "Carrinho", "Conta")',
    );
  });

  it('sem push, não promete notificação nem mostra a aba de avisos', () => {
    // No app, a caixa de avisos some quando o build não tem push.
    const texto = notas(comAvisos(), false);
    expect(texto).not.toMatch(/notification/i);
    expect(texto).not.toContain('"Avisos"');
  });

  it('com push, conta a notificação, a caixa e como testar', () => {
    const texto = notas(comAvisos(), true);
    expect(texto).toContain('Push notifications from the store');
    expect(texto).toContain('notification inbox in the "Avisos" tab');
    expect(texto).toContain('also appear in the "Avisos" tab');
  });

  /*
   * A diretriz 4.5.4 exige desligar as notificações de promoção DENTRO do
   * app, e o revisor procura. A nota diz onde — o caminho que o app tem.
   */
  it('com push, diz onde desligar as notificações dentro do app', () => {
    const comCaixa = notas(comAvisos(), true);
    expect(comCaixa).toContain('Native settings screen (the gear icon in the "Avisos" tab)');
    expect(comCaixa).toContain('switch off "Receber notificações"');

    // Sem caixa de avisos, a entrada é a linha no topo da aba Conta.
    const semCaixa = notas(configInicial(LOJA), true);
    expect(semCaixa).toContain('"Ajustes do app" (App settings) at the top of the "Conta" tab');
    expect(semCaixa).toContain('turn notifications off inside the app');
  });

  it('sem push, os ajustes aparecem sem falar de notificação', () => {
    const texto = notas(configInicial(LOJA), false);
    expect(texto).toContain('Native settings screen');
    expect(texto).toContain('privacy policy');
    expect(texto).not.toMatch(/notification/i);
  });

  it('sem aba Conta nem caixa de avisos, não promete uma tela que o revisor não acha', () => {
    const config = configInicial(LOJA);
    config.tabs = config.tabs.filter((aba) => aba.type !== 'account');
    expect(notas(config, true)).not.toContain('settings screen');
  });

  it('Face ID só quando está ligado e há aba Conta', () => {
    const desligado = notas(configInicial(LOJA));
    expect(desligado).not.toMatch(/Face ID/);

    const ligado = notas(editarRecursos(configInicial(LOJA), { biometricLogin: true }));
    expect(ligado).toContain('Face ID / Touch ID protection for the "Conta" tab');
    expect(ligado).toContain('asks for Face ID first');

    const semConta = editarRecursos(configInicial(LOJA), { biometricLogin: true });
    semConta.tabs = semConta.tabs.filter((aba) => aba.type !== 'account');
    expect(notas(semConta)).not.toMatch(/Face ID/);
  });

  it('boas-vindas e avaliação seguem a config', () => {
    const sem = editarRecursos(configInicial(LOJA), { rateAppPrompt: false });
    expect(notas(sem)).not.toMatch(/welcome screens|rating prompt/);

    const com = editarRecursos(configInicial(LOJA), {
      rateAppPrompt: true,
      onboardingSlides: [{ title: 'Oi', body: 'Bem-vindo', image: '' }],
    });
    expect(notas(com)).toContain('welcome screens');
    expect(notas(com)).toContain('rating prompt after a completed purchase');
  });

  it('Universal Links só quando a Shopify já publica os links', () => {
    expect(notas(configInicial(LOJA))).not.toMatch(/Universal Links/);
    const texto = montarNotasDaRevisao({
      nomeDaLoja: LOJA.name,
      urlDaLoja: LOJA.url,
      pushLigado: false,
      config: configInicial(LOJA),
      linksNoApp: true,
    });
    expect(texto).toContain('Universal Links: links to oakvintage.com.br open directly in the app');
  });

  it('o passo do carrinho cita a aba do badge', () => {
    expect(notas(configInicial(LOJA))).toContain('the badge on the "Carrinho" tab updates');
  });

  it('fora da Shopify, não promete o que depende do carrinho dela', () => {
    const fora = configInicial({ ...LOJA, platform: 'other' });
    const texto = notas(fora);
    expect(texto).not.toMatch(/haptic/i);
    expect(texto).not.toContain('Shopify');
    expect(texto).toContain("the store's own checkout");
  });

  it('cabe no campo da App Store Connect', () => {
    const config = comAvisos();
    config.tabs = config.tabs.map((aba) => ({ ...aba, label: 'x'.repeat(12) }));
    expect(notas(config, true).length).toBeLessThanOrEqual(LIMITE_DAS_NOTAS);
  });
});
