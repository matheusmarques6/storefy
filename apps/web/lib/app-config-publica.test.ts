import { describe, expect, it } from 'vitest';
import { configInicial } from '@storefy/config-schema';
import {
  ehUuid,
  etagConfere,
  etagDaVersao,
  montarResposta,
  type EntradaDaResposta,
} from '@/lib/app-config-publica';

const APP_ID = '0c62dfef-c42f-4385-b8a6-1059bce0aa11';
const CONFIG = configInicial({ name: 'Oak Vintage', url: 'https://oakvintage.com.br' }, 3);

function entrada(extra: Partial<EntradaDaResposta> = {}): EntradaDaResposta {
  return {
    appId: APP_ID,
    ifNoneMatch: null,
    servidorPronto: true,
    linha: { config: CONFIG, version: 3 },
    ...extra,
  };
}

describe('ehUuid', () => {
  it('aceita o formato que o banco gera', () => {
    expect(ehUuid(APP_ID)).toBe(true);
    expect(ehUuid(APP_ID.toUpperCase())).toBe(true);
    expect(ehUuid(`  ${APP_ID}  `)).toBe(true);
  });

  it('recusa o que não é UUID', () => {
    for (const valor of [
      '',
      'app_123',
      '0c62dfef-c42f-4385-b8a6-1059bce',
      '0c62dfef-c42f-4385-b8a6-1059bce0aa11x',
      '../../admin',
      "' or 1=1--",
    ]) {
      expect(ehUuid(valor), valor).toBe(false);
    }
  });
});

describe('etagConfere', () => {
  const etag = etagDaVersao(3);

  it('reconhece a própria etag', () => {
    expect(etagConfere(etag, etag)).toBe(true);
  });

  it('reconhece a etag sem o prefixo fraco', () => {
    // CDN e proxy no caminho reescrevem o cabeçalho; comparar a string inteira
    // faria o 304 nunca acontecer, e todo aparelho baixaria a config de novo.
    expect(etagConfere('"v3"', etag)).toBe(true);
  });

  it('aceita lista de etags', () => {
    expect(etagConfere('W/"v1", W/"v2", W/"v3"', etag)).toBe(true);
    expect(etagConfere('W/"v1", W/"v2"', etag)).toBe(false);
  });

  it('aceita o curinga', () => {
    expect(etagConfere('*', etag)).toBe(true);
  });

  it('não confere com ausente nem vazio', () => {
    expect(etagConfere(null, etag)).toBe(false);
    expect(etagConfere('   ', etag)).toBe(false);
  });
});

describe('montarResposta', () => {
  it('devolve a AppConfig CRUA, sem envelope', () => {
    // `buscarNaRede` do app entrega isto direto ao `decidirConfig`. Um
    // `{ data: ... }` em volta faria a config ser descartada como inválida, e
    // o app abriria com a embutida para sempre, sem erro nenhum aparecendo.
    const resposta = montarResposta(entrada());
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toEqual(CONFIG);
    expect(resposta.corpo).toHaveProperty('store.url', 'https://oakvintage.com.br');
  });

  it('manda a CDN guardar por um minuto, com etag da versão', () => {
    const resposta = montarResposta(entrada());
    expect(resposta.cabecalhos['Cache-Control']).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    expect(resposta.cabecalhos.ETag).toBe('W/"v3"');
  });

  it('responde 304 quando o app já tem a versão', () => {
    const resposta = montarResposta(entrada({ ifNoneMatch: 'W/"v3"' }));
    expect(resposta.status).toBe(304);
    expect(resposta.corpo).toBeNull();
    expect(resposta.cabecalhos.ETag).toBe('W/"v3"');
  });

  it('manda o corpo quando a versão do app está velha', () => {
    expect(montarResposta(entrada({ ifNoneMatch: 'W/"v2"' })).status).toBe(200);
  });

  it('recusa id malformado sem ir ao banco, e guarda essa recusa', () => {
    const resposta = montarResposta(entrada({ appId: 'não-é-uuid' }));
    expect(resposta.status).toBe(400);
    expect(resposta.cabecalhos['Cache-Control']).toBe('public, s-maxage=3600');
  });

  it('404 de quem ainda não publicou vale pouco tempo', () => {
    // É exatamente quem está prestes a publicar: guardar por um minuto faria o
    // lojista achar que publicar não funcionou.
    const resposta = montarResposta(entrada({ linha: null }));
    expect(resposta.status).toBe(404);
    expect(resposta.cabecalhos['Cache-Control']).toBe('public, s-maxage=10');
  });

  it('NUNCA guarda uma falha nossa', () => {
    for (const quebrado of [
      entrada({ servidorPronto: false }),
      entrada({ falhaNoBanco: true }),
      entrada({ linha: { config: { version: 1 }, version: 1 } }),
    ]) {
      const resposta = montarResposta(quebrado);
      expect(resposta.status).toBeGreaterThanOrEqual(500);
      expect(resposta.cabecalhos['Cache-Control']).toBe('no-store');
    }
  });

  it('config corrompida vira 500, e não config quebrada no celular', () => {
    // Devolver assim mesmo faria todo app da loja abrir errado. Melhor o app
    // cair na config embutida, que ao menos funciona.
    const resposta = montarResposta(entrada({ linha: { config: { lixo: true }, version: 9 } }));
    expect(resposta.status).toBe(500);
    expect(resposta.corpo).toEqual({ erro: 'A configuração publicada não é válida.' });
  });

  it('nenhuma resposta de erro conta o que houve por dentro', () => {
    // Mensagem de erro do Postgres vazando para um endpoint público é como se
    // descobre o nome das tabelas.
    for (const quebrado of [
      entrada({ appId: 'x' }),
      entrada({ linha: null }),
      entrada({ falhaNoBanco: true }),
      entrada({ servidorPronto: false }),
      entrada({ linha: { config: null, version: 1 } }),
    ]) {
      const corpo = montarResposta(quebrado).corpo;
      const texto = JSON.stringify(corpo);
      expect(texto).not.toMatch(/app_configs|postgres|relation|supabase|select/i);
    }
  });

  it('aplica os defaults do schema no que sai', () => {
    // Uma config gravada antes de um campo existir precisa sair completa, ou o
    // app derruba ela na validação e volta para a embutida.
    const semDefaults = {
      version: 2,
      store: { name: 'X', url: 'https://x.com', domains: ['x.com'] },
      theme: {
        primary: '#000',
        background: '#fff',
        text: '#000',
        tabBarBg: '#fff',
        tabBarActive: '#000',
        tabBarInactive: '#999',
        statusBar: 'dark',
      },
      tabs: [
        { id: 'a', label: 'A', icon: 'house', type: 'webview', url: '/' },
        { id: 'b', label: 'B', icon: 'user', type: 'account' },
      ],
      webview: { hideSelectors: [] },
      features: {
        pushPromptTiming: 'onboarding',
        onboardingSlides: [],
        appBanner: { enabled: false, text: '' },
      },
    };
    const resposta = montarResposta(entrada({ linha: { config: semDefaults, version: 2 } }));
    expect(resposta.status).toBe(200);
    expect(resposta.corpo).toHaveProperty('minSupportedBuild', 1);
    expect(resposta.corpo).toHaveProperty('webview.pullToRefresh', true);
    expect(resposta.corpo).toHaveProperty('tabs.0.badge', 'none');
  });
});
