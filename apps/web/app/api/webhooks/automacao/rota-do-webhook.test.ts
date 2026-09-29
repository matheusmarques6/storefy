/**
 * `POST /api/webhooks/automacao`, de ponta a ponta: a chave, o corpo, o teto,
 * a automação desligada, o cliente pelo e-mail e o que a ferramenta ouve.
 *
 * O Supabase e a busca na Shopify são falsos (a rede não existe neste
 * ambiente); a rota, não. O que as funções do banco fazem com o pedido está
 * provado no `rls.test.sql`, e a busca pelo e-mail em `clientes-da-shopify.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';
import type { ClientesPeloEmail } from '@/lib/clientes-da-shopify';
import { gerarChave, hashDaChave } from '@/lib/webhook-de-automacao';

const AUTOMACAO = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const LOJA = '33333333-3333-4333-8333-333333333333';

interface Resposta {
  data: unknown;
  error: { message: string } | null;
}

let configurado = true;
let respostas: Record<string, Resposta> = {};
let chamadas: { nome: string; args: Record<string, unknown> }[] = [];
let buscas: { storeId: string; email: string }[] = [];
let respostaDaBusca: ClientesPeloEmail = { ok: true, ids: [] };

vi.mock('@/lib/env', () => ({
  get supabaseConfigurado() {
    return configurado;
  },
  get serviceRoleConfigurada() {
    return configurado;
  },
  env: { supabaseUrl: 'https://exemplo.supabase.co' },
  chaveServiceRole: () => 'chave-de-teste',
}));

vi.mock('@/lib/supabase/admin', () => ({
  criarClientServiceRole: () => ({
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return Promise.resolve(respostas[nome] ?? { data: null, error: null });
    },
  }),
}));

vi.mock('@/lib/clientes-da-shopify', () => ({
  clientesPeloEmail: (_servico: unknown, storeId: string, email: string) => {
    buscas.push({ storeId, email });
    return Promise.resolve(respostaDaBusca);
  },
}));

const { POST } = await import('@/app/api/webhooks/automacao/route');

const CHAVE = gerarChave();

function achada(ligada: boolean): Resposta {
  return {
    data: [
      {
        automacao: AUTOMACAO,
        app_id: APP,
        store_id: LOJA,
        primary_url: 'https://www.loja-teste.com.br',
        ligada,
      },
    ],
    error: null,
  };
}

function pedido(
  corpo: unknown,
  { chave = CHAVE, noEndereco = false }: { chave?: string | null; noEndereco?: boolean } = {},
): NextRequest {
  const endereco = new URL('https://app.storefy.com.br/api/webhooks/automacao');
  if (noEndereco && chave !== null) endereco.searchParams.set('token', chave);
  return new NextRequest(endereco, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(noEndereco || chave === null ? {} : { Authorization: `Bearer ${chave}` }),
    },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

async function responder(requisicao: NextRequest) {
  const resposta = await POST(requisicao);
  return {
    status: resposta.status,
    cache: resposta.headers.get('cache-control'),
    corpo: (await resposta.json()) as Record<string, unknown>,
  };
}

const agendamento = () => chamadas.find((chamada) => chamada.nome === 'agendar_pelo_webhook');

let avisos: MockInstance;
let erros: MockInstance;

beforeEach(() => {
  configurado = true;
  chamadas = [];
  buscas = [];
  respostaDaBusca = { ok: true, ids: [] };
  respostas = {
    consumir_limite: { data: true, error: null },
    ler_webhook_de_automacao: achada(true),
    agendar_pelo_webhook: { data: 2, error: null },
  };
  avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  erros = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a chave', () => {
  it('sem chave, 401 — e nem chega ao banco', async () => {
    const { status, corpo, cache } = await responder(pedido({ customerId: '1' }, { chave: null }));
    expect(status).toBe(401);
    expect(corpo.erro).toBe('chave_invalida');
    expect(corpo.mensagem).toContain('Authorization: Bearer');
    expect(cache).toBe('no-store');
    expect(chamadas).toEqual([]);
  });

  it('chave fora do formato, 401 sem consultar nada', async () => {
    const { status } = await responder(pedido({ customerId: '1' }, { chave: 'sk_live_123' }));
    expect(status).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it('chave que o banco não conhece (trocada ou desativada), 401 dizendo o que fazer', async () => {
    respostas.ler_webhook_de_automacao = { data: [], error: null };
    const { status, corpo } = await responder(pedido({ customerId: '1' }));
    expect(status).toBe(401);
    expect(corpo.mensagem).toBe('Esta chave não vale mais. Gere outra no painel da Storefy.');
    expect(agendamento()).toBeUndefined();
    expect(avisos).toHaveBeenCalled();
  });

  it('o banco procura pelo HASH; a chave em si não sai da rota, nem no teto', async () => {
    await responder(pedido({ customerId: '1' }));
    const leitura = chamadas.find((chamada) => chamada.nome === 'ler_webhook_de_automacao');
    expect(leitura?.args).toEqual({ p_token_hash: hashDaChave(CHAVE) });
    for (const chamada of chamadas) {
      expect(JSON.stringify(chamada.args)).not.toContain(CHAVE);
    }
  });

  it('aceita a chave em ?token=, para a ferramenta que não deixa pôr cabeçalho', async () => {
    const { status } = await responder(pedido({ customerId: '1' }, { noEndereco: true }));
    expect(status).toBe(202);
  });
});

describe('o corpo', () => {
  it('maior que 8 KB, 413', async () => {
    const { status, corpo } = await responder(
      pedido({ customerId: '1', body: 'x'.repeat(9 * 1024) }),
    );
    expect(status).toBe(413);
    expect(corpo.erro).toBe('corpo_grande_demais');
    expect(chamadas).toEqual([]);
  });

  it('que se declara maior que 8 KB, 413 sem nem ler', async () => {
    const requisicao = new NextRequest('https://app.storefy.com.br/api/webhooks/automacao', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CHAVE}`, 'Content-Length': String(64 * 1024) },
      body: JSON.stringify({ customerId: '1' }),
    });
    const { status } = await responder(requisicao);
    expect(status).toBe(413);
    expect(chamadas).toEqual([]);
  });

  it('id de cliente que não é da Shopify, 400 dizendo o formato — e não "0 aparelhos"', async () => {
    const { status, corpo } = await responder(pedido({ customerId: 'cliente-123' }));
    expect(status).toBe(400);
    expect(corpo.campos).toEqual(['customerId']);
    expect(corpo.mensagem).toBe(
      'Use o id do cliente na Shopify: só números, ou o gid://shopify/Customer/….',
    );
    expect(chamadas).toEqual([]);
  });

  it('que não é JSON, 400', async () => {
    const { status, corpo } = await responder(pedido('email=cliente@loja.com'));
    expect(status).toBe(400);
    expect(corpo.mensagem).toBe('O corpo precisa ser JSON.');
  });

  it('sem dizer quem recebe, 400 apontando o campo', async () => {
    const { status, corpo } = await responder(pedido({ title: 'Oi' }));
    expect(status).toBe(400);
    expect(corpo.campos).toEqual(['customerId']);
    expect(corpo.mensagem).toBe('Diga quem recebe: customerId, customerIds ou email.');
    expect(chamadas).toEqual([]);
  });

  it('link para fora da loja, 400 no deepLink', async () => {
    const { status, corpo } = await responder(
      pedido({ customerId: '1', deepLink: 'https://golpe.example.com/pix' }),
    );
    expect(status).toBe(400);
    expect(corpo.campos).toEqual(['deepLink']);
    expect(agendamento()).toBeUndefined();
  });
});

describe('o teto', () => {
  it('passou de 600 por minuto na mesma automação, 429 — sem agendar nada', async () => {
    respostas.consumir_limite = { data: false, error: null };
    const { status, corpo } = await responder(pedido({ customerId: '1' }));
    expect(status).toBe(429);
    expect(corpo.erro).toBe('limite');
    expect(chamadas.map((chamada) => chamada.nome)).toEqual([
      'ler_webhook_de_automacao',
      'consumir_limite',
    ]);
  });

  it('o teto é da automação, e de 600', async () => {
    await responder(pedido({ customerId: '1' }));
    const teto = chamadas.find((chamada) => chamada.nome === 'consumir_limite');
    expect(teto?.args).toEqual({ p_chave: `webhook-automacao:${AUTOMACAO}`, p_maximo: 600 });
  });

  it('chave inventada não conta no teto: não vira linha no banco', async () => {
    respostas.ler_webhook_de_automacao = { data: [], error: null };
    await responder(pedido({ customerId: '1' }, { chave: gerarChave() }));
    expect(chamadas.map((chamada) => chamada.nome)).toEqual(['ler_webhook_de_automacao']);
  });
});

describe('ligada', () => {
  it('agenda para os clientes do corpo, com o texto, o link e o id do evento', async () => {
    const { status, corpo } = await responder(
      pedido({
        customerId: 'gid://shopify/Customer/7208822145',
        customerIds: [7208822146],
        title: 'Seu cupom chegou',
        body: 'Use até domingo.',
        deepLink: 'https://www.loja-teste.com.br/collections/novidades?utm=app',
        id: 'evt_42',
      }),
    );
    expect(status).toBe(202);
    expect(corpo).toEqual({ recebido: true, aparelhos: 2 });
    expect(agendamento()?.args).toEqual({
      p_automacao: AUTOMACAO,
      p_clientes: ['7208822145', '7208822146'],
      p_titulo: 'Seu cupom chegou',
      p_corpo: 'Use até domingo.',
      p_link: '/collections/novidades?utm=app',
      p_ref: 'evt_42',
    });
    expect(buscas).toEqual([]);
  });

  it('sem texto no corpo, não manda texto: vale o da automação', async () => {
    await responder(pedido({ customerId: '1' }));
    expect(agendamento()?.args).toEqual({ p_automacao: AUTOMACAO, p_clientes: ['1'] });
  });

  it('cliente sem o app não é erro: 202 com zero aparelhos', async () => {
    respostas.agendar_pelo_webhook = { data: 0, error: null };
    const { status, corpo } = await responder(pedido({ customerId: '1' }));
    expect(status).toBe(202);
    expect(corpo).toEqual({ recebido: true, aparelhos: 0 });
  });
});

describe('o cliente pelo e-mail', () => {
  it('só com o e-mail, a Shopify diz quem é, e o push vai para esse cliente', async () => {
    respostaDaBusca = { ok: true, ids: ['555'] };
    const { status } = await responder(pedido({ email: 'cliente@loja.com.br' }));
    expect(status).toBe(202);
    expect(buscas).toEqual([{ storeId: LOJA, email: 'cliente@loja.com.br' }]);
    expect(agendamento()?.args.p_clientes).toEqual(['555']);
  });

  it('com o id no corpo, o e-mail não custa uma busca na Shopify', async () => {
    await responder(pedido({ customerId: '9', email: 'cliente@loja.com.br' }));
    expect(buscas).toEqual([]);
    expect(agendamento()?.args.p_clientes).toEqual(['9']);
  });

  it('loja sem a Shopify conectada: 422, e não agenda', async () => {
    respostaDaBusca = { ok: false, motivo: 'Conecte a Shopify.', causa: 'reconectar' };
    const { status, corpo } = await responder(pedido({ email: 'cliente@loja.com.br' }));
    expect(status).toBe(422);
    expect(corpo).toEqual({ erro: 'shopify_desconectada', mensagem: 'Conecte a Shopify.' });
    expect(agendamento()).toBeUndefined();
  });

  it('a Shopify sem liberar dados de cliente: 422 pedindo o id no lugar', async () => {
    respostaDaBusca = { ok: false, motivo: 'Mande o customerId.', causa: 'use-o-id' };
    const { status, corpo } = await responder(pedido({ email: 'cliente@loja.com.br' }));
    expect(status).toBe(422);
    expect(corpo.erro).toBe('busca_por_email_indisponivel');
  });

  it('a Shopify fora do ar: 503, para a ferramenta tentar de novo', async () => {
    respostaDaBusca = { ok: false, motivo: 'Tente de novo.', causa: 'tente-de-novo' };
    const { status, corpo } = await responder(pedido({ email: 'cliente@loja.com.br' }));
    expect(status).toBe(503);
    expect(corpo.erro).toBe('shopify_indisponivel');
  });
});

describe('desligada', () => {
  it('403 dizendo onde ligar — mas a chegada fica anotada, sem procurar cliente', async () => {
    respostas.ler_webhook_de_automacao = achada(false);
    const { status, corpo } = await responder(
      pedido({ email: 'cliente@loja.com.br', title: 'Oi' }),
    );
    expect(status).toBe(403);
    expect(corpo.erro).toBe('automacao_desligada');
    expect(corpo.mensagem).toContain('Notificações › Automações');
    expect(buscas).toEqual([]);
    expect(agendamento()?.args).toEqual({ p_automacao: AUTOMACAO, p_clientes: [], p_titulo: 'Oi' });
  });
});

describe('quando algo falha', () => {
  it('servidor sem o Supabase configurado: 503, sem tentar', async () => {
    configurado = false;
    const { status, corpo } = await responder(pedido({ customerId: '1' }));
    expect(status).toBe(503);
    expect(corpo.erro).toBe('servidor_nao_configurado');
    expect(chamadas).toEqual([]);
  });

  it.each([['consumir_limite'], ['ler_webhook_de_automacao'], ['agendar_pelo_webhook']])(
    'o banco falhou em %s: 503 e o erro no log, nunca um "recebido" falso',
    async (nome) => {
      respostas[nome] = { data: null, error: { message: 'conexão perdida' } };
      const { status, corpo } = await responder(pedido({ customerId: '1' }));
      expect(status).toBe(503);
      expect(corpo).toEqual({ erro: 'indisponivel', mensagem: 'Tente de novo em instantes.' });
      expect(erros).toHaveBeenCalledWith(expect.stringContaining('webhook-automacao.falhou'));
    },
  );
});
