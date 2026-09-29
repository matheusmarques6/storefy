import { describe, expect, it, vi } from 'vitest';
import { buscarPublico, type OpcoesDaBusca } from '@/lib/busca-publica';

interface Resposta {
  status: number;
  corpo?: string;
  cabecalhos?: Record<string, string>;
}

/** Um fetch que responde por endereço e anota por onde passou. */
function redeFalsa(rotas: Record<string, Resposta>) {
  const visitados: string[] = [];
  const buscador = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const endereco = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    visitados.push(endereco);
    // O salto é nosso: o fetch nunca pode seguir sozinho.
    expect(init?.redirect).toBe('manual');
    const rota = rotas[endereco];
    if (rota === undefined) return Promise.reject(new Error('sem rede'));
    return Promise.resolve(
      new Response(rota.status >= 300 && rota.status < 400 ? null : (rota.corpo ?? ''), {
        status: rota.status,
        headers: rota.cabecalhos,
      }),
    );
  });
  return { buscador: buscador as unknown as typeof fetch, visitados };
}

const OPCOES: Omit<OpcoesDaBusca, 'buscador'> = {
  aceitar: 'text/html',
  tamanhoMaximo: 1024,
  tempoLimiteMs: 1000,
  agente: 'teste',
};

describe('buscarPublico', () => {
  it('segue o redirecionamento para outro host público e devolve o destino', async () => {
    const { buscador, visitados } = redeFalsa({
      'https://loja.com.br/': { status: 301, cabecalhos: { location: 'https://www.loja.com.br/' } },
      'https://www.loja.com.br/': {
        status: 200,
        corpo: '<title>Loja</title>',
        cabecalhos: { 'content-type': 'text/html; charset=utf-8' },
      },
    });

    const resultado = await buscarPublico(new URL('https://loja.com.br/'), { ...OPCOES, buscador });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.urlFinal.toString()).toBe('https://www.loja.com.br/');
      expect(resultado.tipo).toBe('text/html; charset=utf-8');
      expect(new TextDecoder().decode(resultado.corpo)).toBe('<title>Loja</title>');
    }
    expect(visitados).toEqual(['https://loja.com.br/', 'https://www.loja.com.br/']);
  });

  /*
   * O SSRF clássico: um site público responde 302 para o endereço de
   * metadados da nuvem, ou para o próprio servidor. O salto é recusado ANTES
   * de ser buscado.
   */
  it('não segue redirecionamento para endereço interno', async () => {
    for (const interno of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/api',
      'http://10.0.0.5/',
      'http://[::1]/',
    ]) {
      const { buscador, visitados } = redeFalsa({
        'https://loja.com.br/': { status: 302, cabecalhos: { location: interno } },
      });

      const resultado = await buscarPublico(new URL('https://loja.com.br/'), {
        ...OPCOES,
        buscador,
      });

      expect(resultado, interno).toEqual({ ok: false, falha: 'host' });
      expect(visitados, interno).toEqual(['https://loja.com.br/']);
    }
  });

  it('endereço interno de saída nem é buscado', async () => {
    const { buscador, visitados } = redeFalsa({});
    expect(await buscarPublico(new URL('http://127.0.0.1/'), { ...OPCOES, buscador })).toEqual({
      ok: false,
      falha: 'host',
    });
    expect(await buscarPublico(new URL('file:///etc/passwd'), { ...OPCOES, buscador })).toEqual({
      ok: false,
      falha: 'host',
    });
    expect(visitados).toEqual([]);
  });

  it('redirecionamento sem fim para depois de alguns saltos', async () => {
    const { buscador, visitados } = redeFalsa({
      'https://a.com.br/': { status: 302, cabecalhos: { location: '/de-novo' } },
      'https://a.com.br/de-novo': { status: 302, cabecalhos: { location: '/' } },
    });

    expect(await buscarPublico(new URL('https://a.com.br/'), { ...OPCOES, buscador })).toEqual({
      ok: false,
      falha: 'saltos',
    });
    expect(visitados.length).toBe(6);
  });

  it('resposta grande demais é recusada, pelo cabeçalho ou pelo corpo', async () => {
    const pelaDeclaracao = redeFalsa({
      'https://a.com.br/': { status: 200, corpo: 'x', cabecalhos: { 'content-length': '999999' } },
    });
    expect(
      await buscarPublico(new URL('https://a.com.br/'), {
        ...OPCOES,
        buscador: pelaDeclaracao.buscador,
      }),
    ).toEqual({ ok: false, falha: 'grande' });

    const peloCorpo = redeFalsa({ 'https://a.com.br/': { status: 200, corpo: 'x'.repeat(2048) } });
    expect(
      await buscarPublico(new URL('https://a.com.br/'), {
        ...OPCOES,
        buscador: peloCorpo.buscador,
      }),
    ).toEqual({ ok: false, falha: 'grande' });
  });

  it('erro do servidor e falta de rede viram falhas nomeadas', async () => {
    const comErro = redeFalsa({ 'https://a.com.br/': { status: 503 } });
    expect(
      await buscarPublico(new URL('https://a.com.br/'), { ...OPCOES, buscador: comErro.buscador }),
    ).toEqual({ ok: false, falha: 'status', status: 503 });

    const semRede = redeFalsa({});
    expect(
      await buscarPublico(new URL('https://a.com.br/'), { ...OPCOES, buscador: semRede.buscador }),
    ).toEqual({ ok: false, falha: 'rede' });
  });
});
