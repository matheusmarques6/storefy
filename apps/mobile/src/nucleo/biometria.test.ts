import { describe, expect, it } from 'vitest';
import { PLUGIN_BIOMETRIA, montarPlugins, nomeDoPlugin } from '../config/plugins';
import {
  PLUGIN_DE_BIOMETRIA,
  TRANCAR_DEPOIS_DE_MS,
  binarioComBiometria,
  depoisDoPedido,
  deveProtegerConta,
  ehDadoDaConta,
  trancarAoVoltar,
} from './biometria';

const TUDO: Parameters<typeof deveProtegerConta>[0] = {
  recursoLigado: true,
  binarioPermite: true,
  temSensor: true,
  temCadastro: true,
};

describe('Face ID na aba Conta', () => {
  it('protege só com tudo a favor', () => {
    expect(deveProtegerConta(TUDO)).toBe(true);
  });

  it('nunca tranca quem não tem como abrir', () => {
    expect(deveProtegerConta({ ...TUDO, recursoLigado: false })).toBe(false);
    expect(deveProtegerConta({ ...TUDO, binarioPermite: false })).toBe(false);
    expect(deveProtegerConta({ ...TUDO, temSensor: false })).toBe(false);
    expect(deveProtegerConta({ ...TUDO, temCadastro: false })).toBe(false);
  });

  it('reconhece o binário gerado com a permissão, com ou sem opções', () => {
    expect(
      binarioComBiometria(['expo-router', [PLUGIN_DE_BIOMETRIA, { faceIDPermission: 'x' }]]),
    ).toBe(true);
    expect(binarioComBiometria([PLUGIN_DE_BIOMETRIA])).toBe(true);
    expect(binarioComBiometria(['expo-router'])).toBe(false);
    expect(binarioComBiometria(undefined)).toBe(false);
  });

  it('volta a trancar só depois de um tempo fora', () => {
    expect(trancarAoVoltar(null, 1_000_000)).toBe(false);
    expect(trancarAoVoltar(1_000_000, 1_000_000 + TRANCAR_DEPOIS_DE_MS - 1)).toBe(false);
    expect(trancarAoVoltar(1_000_000, 1_000_000 + TRANCAR_DEPOIS_DE_MS)).toBe(true);
  });
});

describe('o binário com Face ID', () => {
  it('todo app nosso sai com a permissão, e o app a reconhece', () => {
    const plugins = montarPlugins({ modoApns: 'production' });
    expect(PLUGIN_DE_BIOMETRIA).toBe(PLUGIN_BIOMETRIA);
    expect(plugins.map(nomeDoPlugin)).toContain(PLUGIN_BIOMETRIA);
    expect(binarioComBiometria(plugins)).toBe(true);
  });

  it('a permissão fala português com o cliente da loja', () => {
    const plugin = montarPlugins({ modoApns: 'production' }).find(
      (item) => nomeDoPlugin(item) === PLUGIN_BIOMETRIA,
    );
    expect(Array.isArray(plugin) && String(plugin[1].faceIDPermission)).toMatch(/Face ID/);
    expect(Array.isArray(plugin) && String(plugin[1].faceIDPermission)).toMatch(/sua conta/);
  });
});

describe('a resposta do sistema', () => {
  it('abre quando o cliente confirma', () => {
    expect(depoisDoPedido({ success: true })).toEqual({ acao: 'abrir' });
  });

  it('abre quando o aparelho perdeu o jeito de confirmar no meio da sessão', () => {
    // Rosto, digital ou senha apagados com o app em segundo plano: trancar
    // agora seria trancar para sempre.
    for (const erro of ['not_enrolled', 'passcode_not_set', 'not_available']) {
      expect(depoisDoPedido({ success: false, error: erro })).toEqual({ acao: 'abrir' });
    }
  });

  it('quem cancelou continua na trava, sem bronca', () => {
    for (const erro of ['user_cancel', 'system_cancel', 'app_cancel']) {
      expect(depoisDoPedido({ success: false, error: erro })).toEqual({
        acao: 'manter',
        aviso: null,
      });
    }
  });

  it('muitas tentativas pedem a senha do celular', () => {
    const resposta = depoisDoPedido({ success: false, error: 'lockout' });
    expect(resposta.acao).toBe('manter');
    expect(resposta.acao === 'manter' ? resposta.aviso : '').toMatch(/senha/);
  });

  it('qualquer outra falha mantém a trava e explica', () => {
    for (const erro of ['authentication_failed', 'timeout', 'unknown', 'algo-novo']) {
      const resposta = depoisDoPedido({ success: false, error: erro });
      expect(resposta.acao).toBe('manter');
      expect(resposta.acao === 'manter' ? resposta.aviso : null).toMatch(/Tente de novo/);
    }
  });
});

describe('o que é dado da conta', () => {
  it('a conta e tudo abaixo dela', () => {
    expect(ehDadoDaConta('/account', '/account')).toBe(true);
    expect(ehDadoDaConta('/account/', '/account')).toBe(true);
    expect(ehDadoDaConta('/account/orders/123', '/account')).toBe(true);
    expect(ehDadoDaConta('/account/addresses', '/account')).toBe(true);
    expect(ehDadoDaConta('/account?view=orders', '/account')).toBe(true);
    expect(ehDadoDaConta('/Account/Orders', '/account')).toBe(true);
  });

  it('a mesma conta em outra língua dos mercados da Shopify', () => {
    expect(ehDadoDaConta('/en/account', '/account')).toBe(true);
    expect(ehDadoDaConta('/pt-pt/account/orders', '/account')).toBe(true);
  });

  it('a conta nova da Shopify, com o id da loja na frente', () => {
    expect(ehDadoDaConta('/12345/account', '/account')).toBe(true);
    expect(ehDadoDaConta('/12345/account/orders/678', '/account')).toBe(true);
    expect(ehDadoDaConta('/12345/account/logout', '/account')).toBe(false);
    expect(ehDadoDaConta('/authentication/12345/login', '/account')).toBe(false);
  });

  it('login, cadastro e senha esquecida ficam livres', () => {
    // O "Entrar" do checkout passa por aqui e volta para o pagamento.
    for (const porta of [
      '/account/login',
      '/account/login?checkout_url=/checkouts/abc',
      '/account/register',
      '/account/recover',
      '/account/activate/1/abc',
      '/account/reset/1/abc',
      '/account/logout',
      '/en/account/login',
    ]) {
      expect(ehDadoDaConta(porta, '/account')).toBe(false);
    }
  });

  it('não confunde com caminho parecido', () => {
    expect(ehDadoDaConta('/accounting-livros', '/account')).toBe(false);
    expect(ehDadoDaConta('/account.json', '/account')).toBe(false);
    expect(ehDadoDaConta('/products/account', '/account')).toBe(false);
    expect(ehDadoDaConta('/', '/account')).toBe(false);
  });

  it('segue o caminho que o lojista deu à aba', () => {
    expect(ehDadoDaConta('/pages/minha-conta', '/pages/minha-conta/')).toBe(true);
    expect(ehDadoDaConta('/account', '/pages/minha-conta')).toBe(false);
  });

  it('uma aba Conta apontando para a raiz não prende a loja inteira', () => {
    expect(ehDadoDaConta('/products/x', '/')).toBe(false);
    expect(ehDadoDaConta('/', '')).toBe(false);
  });
});
