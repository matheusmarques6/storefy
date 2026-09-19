import { describe, expect, it, vi } from 'vitest';
import {
  BASE_DA_API,
  buscarEstatisticas,
  corpoDaNotificacao,
  enviarNotificacao,
  filtrosDoSegmento,
  lerEstatisticas,
  lerRespostaDoEnvio,
} from '@/lib/onesignal';

const CREDENCIAIS = { appId: 'os-app-1', chave: 'chave-rest-da-loja' };

describe('corpoDaNotificacao', () => {
  it('manda o essencial no formato que a v16 da API exige', () => {
    const corpo = corpoDaNotificacao(CREDENCIAIS, {
      title: 'Promoção',
      body: 'Até 40% OFF',
      deepLink: null,
    });

    expect(corpo).toMatchObject({
      app_id: 'os-app-1',
      // Sem `target_channel` a OneSignal recusa com um erro que não diz o que
      // falta.
      target_channel: 'push',
      headings: { en: 'Promoção' },
      contents: { en: 'Até 40% OFF' },
      included_segments: ['Subscribed Users'],
    });
  });

  /*
   * O caminho vai em `data.deep_link`, e não em `url`. `url` abre o NAVEGADOR
   * do celular: o cliente sai do app e cai numa aba sem carrinho e sem login.
   */
  it('põe o caminho em data.deep_link, nunca em url', () => {
    const corpo = corpoDaNotificacao(CREDENCIAIS, {
      title: 'a',
      body: 'b',
      deepLink: '/promocoes',
    });
    expect(corpo.data).toEqual({ deep_link: '/promocoes' });
    expect(corpo).not.toHaveProperty('url');
  });

  it('sem caminho, não manda data vazio', () => {
    const corpo = corpoDaNotificacao(CREDENCIAIS, { title: 'a', body: 'b', deepLink: '' });
    expect(corpo).not.toHaveProperty('data');
  });

  it('com inscrições, manda só para elas e ignora o segmento', () => {
    const corpo = corpoDaNotificacao(CREDENCIAIS, {
      title: 'a',
      body: 'b',
      deepLink: null,
      inscricoes: ['sub-1', 'sub-2'],
      segment: { vip: 'true' },
    });

    expect(corpo.include_subscription_ids).toEqual(['sub-1', 'sub-2']);
    expect(corpo).not.toHaveProperty('included_segments');
    expect(corpo).not.toHaveProperty('filters');
  });

  it('com segmento, manda filtros em vez do público inteiro', () => {
    const corpo = corpoDaNotificacao(CREDENCIAIS, {
      title: 'a',
      body: 'b',
      deepLink: null,
      segment: { has_purchased: 'true' },
    });

    expect(corpo.filters).toEqual([
      { field: 'tag', key: 'has_purchased', relation: '=', value: 'true' },
    ]);
    expect(corpo).not.toHaveProperty('included_segments');
  });
});

describe('filtrosDoSegmento', () => {
  it('sem segmento, sem filtro: a campanha vai para todos', () => {
    for (const vazio of [null, undefined, {}, [], 'texto', 42]) {
      expect(filtrosDoSegmento(vazio)).toBeNull();
    }
  });

  it('liga dois filtros com E', () => {
    expect(filtrosDoSegmento({ vip: 'true', cidade: 'sp' })).toEqual([
      { field: 'tag', key: 'vip', relation: '=', value: 'true' },
      { operator: 'AND' },
      { field: 'tag', key: 'cidade', relation: '=', value: 'sp' },
    ]);
  });

  /*
   * Um valor que não é texto vira NADA, e não um filtro adivinhado. O
   * alternativo seria mandar algo que a OneSignal interpreta de outro jeito —
   * e aí a oferta vai para as pessoas erradas, muitas vezes com preço errado.
   */
  it('descarta o que não dá para traduzir, em vez de adivinhar', () => {
    expect(filtrosDoSegmento({ vip: 123, cidade: null, '': 'x' })).toBeNull();
    expect(filtrosDoSegmento({ vip: 123, cidade: 'sp' })).toEqual([
      { field: 'tag', key: 'cidade', relation: '=', value: 'sp' },
    ]);
  });
});

describe('lerRespostaDoEnvio', () => {
  it('sucesso devolve o id e quantos receberam', () => {
    expect(lerRespostaDoEnvio(200, JSON.stringify({ id: 'n-1', recipients: 1240 }))).toEqual({
      ok: true,
      notificationId: 'n-1',
      destinatarios: 1240,
    });
  });

  it('sucesso sem contagem ainda devolve o id', () => {
    const r = lerRespostaDoEnvio(200, JSON.stringify({ id: 'n-1' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.destinatarios).toBeNull();
  });

  /*
   * 200 sem `id` é o "nenhum destinatário" da OneSignal: ela aceita a chamada
   * e não cria notificação nenhuma. Não é erro de configuração, e repetir não
   * muda nada — a campanha não tinha público.
   */
  it('200 sem id é falha permanente, e não motivo para repetir', () => {
    const r = lerRespostaDoEnvio(
      200,
      JSON.stringify({ errors: ['All included players are not subscribed'] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.permanente).toBe(true);
      expect(r.motivo).toContain('not subscribed');
    }
  });

  it('chave errada é permanente: repetir não conserta', () => {
    for (const status of [400, 401, 403, 404]) {
      const r = lerRespostaDoEnvio(status, JSON.stringify({ errors: ['Invalid app_id format'] }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.permanente).toBe(true);
    }
  });

  it('erro do servidor NÃO é permanente: vale tentar de novo', () => {
    for (const status of [500, 502, 503, 429]) {
      const r = lerRespostaDoEnvio(status, '{}');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.permanente).toBe(false);
    }
  });

  it('lê o erro tanto em lista quanto em objeto', () => {
    const lista = lerRespostaDoEnvio(400, JSON.stringify({ errors: ['deu ruim'] }));
    const objeto = lerRespostaDoEnvio(400, JSON.stringify({ errors: { app_id: ['inválido'] } }));
    if (!lista.ok) expect(lista.motivo).toBe('deu ruim');
    if (!objeto.ok) expect(objeto.motivo).toBe('inválido');
  });

  /*
   * 2xx com corpo ilegível é bizarro o bastante para não repetir às cegas:
   * pode ter enviado, e repetir mandaria a campanha duas vezes para a base.
   */
  it('2xx ilegível não é repetido: pode ter enviado', () => {
    const r = lerRespostaDoEnvio(200, '<html>erro</html>');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanente).toBe(true);
  });

  it('5xx ilegível pode ser repetido', () => {
    const r = lerRespostaDoEnvio(503, '<html>indisponível</html>');
    if (!r.ok) expect(r.permanente).toBe(false);
  });
});

describe('enviarNotificacao', () => {
  it('chama o endpoint certo, com a chave da loja', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify({ id: 'n-1', recipients: 10 })));
    }) as unknown as typeof fetch;

    const r = await enviarNotificacao(
      CREDENCIAIS,
      { title: 'a', body: 'b', deepLink: null },
      buscador,
    );

    expect(r.ok).toBe(true);
    expect(chamadas[0]?.url).toBe(`${BASE_DA_API}/notifications`);
    const cabecalhos = chamadas[0]?.init.headers as Record<string, string>;
    expect(cabecalhos.Authorization).toBe('Key chave-rest-da-loja');
  });

  it('rede caindo não é permanente', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    const r = await enviarNotificacao(
      CREDENCIAIS,
      { title: 'a', body: 'b', deepLink: null },
      quebrado,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanente).toBe(false);
  });
});

describe('lerEstatisticas', () => {
  it('lê o que a OneSignal devolve', () => {
    expect(
      lerEstatisticas(JSON.stringify({ successful: 950, converted: 190, failed: 50 })),
    ).toEqual({ enviados: 950, entregues: 950, abertos: 190, falhas: 50 });
  });

  /*
   * O que não vier fica `null`, e a tela mostra traço. Um zero inventado aqui
   * faria o lojista achar que a campanha não abriu (regra 1 do CLAUDE.md).
   */
  it('o que não vier fica null, nunca zero', () => {
    expect(lerEstatisticas('{}')).toEqual({
      enviados: null,
      entregues: null,
      abertos: null,
      falhas: null,
    });
  });

  it('corpo ilegível vira null, sem lançar', () => {
    expect(lerEstatisticas('<html>')).toBeNull();
    expect(lerEstatisticas('null')).toBeNull();
    expect(lerEstatisticas('42')).toBeNull();
  });

  it('descarta número impossível', () => {
    const lido = lerEstatisticas(JSON.stringify({ successful: -5, converted: 'muitos' }));
    expect(lido?.entregues).toBeNull();
    expect(lido?.abertos).toBeNull();
  });
});

describe('buscarEstatisticas', () => {
  it('consulta a notificação com o app_id na query', async () => {
    const urls: string[] = [];
    const buscador = vi.fn((url: string | URL | Request) => {
      urls.push(url instanceof Request ? url.url : url.toString());
      return Promise.resolve(new Response(JSON.stringify({ successful: 10, converted: 2 })));
    }) as unknown as typeof fetch;

    const r = await buscarEstatisticas(CREDENCIAIS, 'n-1', buscador);
    expect(r).toMatchObject({ entregues: 10, abertos: 2 });
    expect(urls[0]).toBe(`${BASE_DA_API}/notifications/n-1?app_id=os-app-1`);
  });

  it('falha na consulta vira null, e o job segue com as outras', async () => {
    const quebrado = (() => Promise.reject(new Error('sem rede'))) as unknown as typeof fetch;
    await expect(buscarEstatisticas(CREDENCIAIS, 'n-1', quebrado)).resolves.toBeNull();

    const recusado = (() =>
      Promise.resolve(new Response('{}', { status: 403 }))) as unknown as typeof fetch;
    await expect(buscarEstatisticas(CREDENCIAIS, 'n-1', recusado)).resolves.toBeNull();
  });
});
