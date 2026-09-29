import { describe, expect, it } from 'vitest';
import {
  ESCOPO_DOS_LINKS,
  appIdDaApple,
  arquivosDeAssociacao,
  lerImpressaoDigital,
  situacaoDosLinks,
  type DadosDosLinks,
} from '@/lib/links-do-app';

const IMPRESSAO =
  '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';

const PRONTA: DadosDosLinks = {
  plataformaDaLoja: 'shopify',
  shopifyConectada: true,
  escoposDaLoja: ['read_orders', ESCOPO_DOS_LINKS],
  storefyPedeOEscopo: true,
  conexao: 'oauth',
  bundleIdIos: 'me.convertfy.oakvintage',
  appleTeamId: 'A1B2C3D4E5',
  packageAndroid: 'me.convertfy.oakvintage',
  impressoesAndroid: [IMPRESSAO],
  iosVinculadoEm: null,
  androidVinculadoEm: null,
};

describe('lerImpressaoDigital', () => {
  it('aceita como o Play Console mostra', () => {
    expect(lerImpressaoDigital(IMPRESSAO)).toBe(IMPRESSAO);
  });

  it('aceita sem os dois-pontos, em minúsculas e com espaços do copiar e colar', () => {
    const colada = ` ${IMPRESSAO.replace(/:/g, '').toLowerCase()} \n`;
    expect(lerImpressaoDigital(colada)).toBe(IMPRESSAO);
  });

  it('recusa o que não é uma SHA-256, em vez de consertar', () => {
    // Uma impressão errada no domínio faz o Android recusar os links calado.
    for (const ruim of [
      '',
      'abc',
      IMPRESSAO.slice(0, -3),
      `${IMPRESSAO}:AA`,
      IMPRESSAO.replace('14', 'ZZ'),
      // SHA-1 tem 20 pares: é a impressão errada, e é a mais fácil de colar.
      '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42',
      `${IMPRESSAO.slice(0, 20)}::${IMPRESSAO.slice(22)}`,
    ]) {
      expect(lerImpressaoDigital(ruim), ruim).toBeNull();
    }
  });
});

describe('appIdDaApple', () => {
  it('é o Team ID na frente do bundle', () => {
    expect(appIdDaApple('a1b2c3d4e5', 'me.convertfy.oakvintage')).toBe(
      'A1B2C3D4E5.me.convertfy.oakvintage',
    );
  });

  it('sem Team ID ou sem bundle válidos, não há App ID', () => {
    expect(appIdDaApple(null, 'me.convertfy.oakvintage')).toBeNull();
    expect(appIdDaApple('CURTO', 'me.convertfy.oakvintage')).toBeNull();
    expect(appIdDaApple('A1B2C3D4E5', null)).toBeNull();
    expect(appIdDaApple('A1B2C3D4E5', 'semponto')).toBeNull();
    expect(appIdDaApple('A1B2C3D4E5', 'me.convertfy/../x')).toBeNull();
  });
});

describe('situacaoDosLinks', () => {
  it('tudo pronto: dá para mandar a Shopify publicar', () => {
    const situacao = situacaoDosLinks(PRONTA);
    expect(situacao.bloqueio).toBeNull();
    expect(situacao.ios).toEqual({ estado: 'pronto' });
    expect(situacao.android).toEqual({ estado: 'pronto' });
    expect(situacao.podeVincular).toBe(true);
  });

  it('já vinculado mostra desde quando, e continua podendo vincular de novo', () => {
    const situacao = situacaoDosLinks({
      ...PRONTA,
      iosVinculadoEm: '2026-09-29T12:00:00Z',
      androidVinculadoEm: '2026-09-29T12:00:00Z',
    });
    expect(situacao.ios).toEqual({ estado: 'vinculado', em: '2026-09-29T12:00:00Z' });
    expect(situacao.podeVincular).toBe(true);
  });

  it('Shopify desconectada bloqueia as duas plataformas', () => {
    const situacao = situacaoDosLinks({ ...PRONTA, shopifyConectada: false });
    expect(situacao.bloqueio?.tipo).toBe('conectar');
    expect(situacao.podeVincular).toBe(false);
  });

  it('sem a permissão, diz se é para reconectar ou se é a Shopify que ainda não liberou', () => {
    const semEscopo = { ...PRONTA, escoposDaLoja: ['read_orders'] };
    expect(situacaoDosLinks(semEscopo).bloqueio?.tipo).toBe('reconectar');
    expect(situacaoDosLinks({ ...semEscopo, storefyPedeOEscopo: false }).bloqueio?.tipo).toBe(
      'aguardando-shopify',
    );
    expect(situacaoDosLinks(semEscopo).podeVincular).toBe(false);
  });

  it('no app que o lojista criou, a permissão é dele: a frase diz qual é', () => {
    const bloqueio = situacaoDosLinks({
      ...PRONTA,
      conexao: 'manual',
      escoposDaLoja: ['read_orders'],
      storefyPedeOEscopo: false,
    }).bloqueio;
    expect(bloqueio?.tipo).toBe('reconectar');
    expect(bloqueio?.motivo).toContain(ESCOPO_DOS_LINKS);
  });

  it('cada plataforma diz o que falta, em português', () => {
    const situacao = situacaoDosLinks({
      ...PRONTA,
      appleTeamId: null,
      impressoesAndroid: [],
    });
    expect(situacao.ios).toEqual({
      estado: 'falta',
      motivo: 'Conecte a conta Apple da sua empresa.',
    });
    expect(situacao.android.estado).toBe('falta');
    expect(situacao.android.estado === 'falta' && situacao.android.motivo).toMatch(/Play Console/);
    // Nada a publicar em nenhuma das duas: não há botão.
    expect(situacao.podeVincular).toBe(false);
  });

  it('uma plataforma pronta já basta para vincular', () => {
    expect(situacaoDosLinks({ ...PRONTA, impressoesAndroid: [] }).podeVincular).toBe(true);
  });

  it('sem os identificadores, explica que eles nascem no primeiro build', () => {
    const situacao = situacaoDosLinks({ ...PRONTA, bundleIdIos: null, packageAndroid: null });
    expect(situacao.ios.estado === 'falta' && situacao.ios.motivo).toMatch(/Apple/);
    expect(situacao.android.estado === 'falta' && situacao.android.motivo).toMatch(/build/);
  });

  it('fora da Shopify não há o que mandar publicar: o lojista publica', () => {
    const situacao = situacaoDosLinks({
      ...PRONTA,
      plataformaDaLoja: 'other',
      shopifyConectada: false,
      escoposDaLoja: [],
    });
    expect(situacao.bloqueio).toBeNull();
    expect(situacao.podeVincular).toBe(false);
  });
});

describe('arquivosDeAssociacao', () => {
  it('o da Apple libera a loja inteira para o App ID', () => {
    const { apple } = arquivosDeAssociacao(PRONTA);
    expect(JSON.parse(apple ?? '')).toEqual({
      applinks: {
        details: [{ appIDs: ['A1B2C3D4E5.me.convertfy.oakvintage'], components: [{ '/': '*' }] }],
      },
    });
  });

  it('o do Android leva o pacote e a impressão', () => {
    const { android } = arquivosDeAssociacao(PRONTA);
    expect(JSON.parse(android ?? '')).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'me.convertfy.oakvintage',
          sha256_cert_fingerprints: [IMPRESSAO],
        },
      },
    ]);
  });

  it('sem o que pôr, não entrega arquivo pela metade', () => {
    expect(arquivosDeAssociacao({ ...PRONTA, appleTeamId: null, impressoesAndroid: [] })).toEqual({
      apple: null,
      android: null,
    });
  });
});
