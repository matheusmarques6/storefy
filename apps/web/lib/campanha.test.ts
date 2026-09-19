import { describe, expect, it } from 'vitest';
import {
  ANTECEDENCIA_MINIMA_MS,
  CORTE_IOS_TITULO,
  interpretarAgendamento,
  lerMetricas,
  normalizarDeepLink,
  numeroOuTraco,
  podeCancelar,
  podeEditar,
  podeExcluir,
  porcentagemOuTraco,
  previaDaNotificacao,
  validarCampanha,
} from '@/lib/campanha';

const LOJA = 'https://oakvintage.com.br';
const AGORA = Date.parse('2026-09-19T12:00:00.000Z');

describe('o que dá para fazer em cada status', () => {
  /*
   * Uma notificação enviada não volta atrás. Deixar editar depois do envio
   * criaria a pior confusão possível: o histórico mostraria um texto que
   * ninguém recebeu.
   */
  it('campanha enviada não se edita, não se cancela e não se exclui', () => {
    expect(podeEditar('sent')).toBe(false);
    expect(podeCancelar('sent')).toBe(false);
    expect(podeExcluir('sent')).toBe(false);
  });

  it('rascunho se edita e se exclui', () => {
    expect(podeEditar('draft')).toBe(true);
    expect(podeExcluir('draft')).toBe(true);
    expect(podeCancelar('draft')).toBe(false);
  });

  it('agendada se edita e se cancela, mas não se exclui', () => {
    expect(podeEditar('scheduled')).toBe(true);
    expect(podeCancelar('scheduled')).toBe(true);
    expect(podeExcluir('scheduled')).toBe(false);
  });

  it('enviando não se mexe: já está saindo', () => {
    expect(podeEditar('sending')).toBe(false);
    expect(podeCancelar('sending')).toBe(false);
    expect(podeExcluir('sending')).toBe(false);
  });
});

describe('normalizarDeepLink', () => {
  it('aceita o caminho que o lojista digita', () => {
    expect(normalizarDeepLink('/promocoes', LOJA)).toEqual({ ok: true, caminho: '/promocoes' });
    expect(normalizarDeepLink('promocoes', LOJA)).toEqual({ ok: true, caminho: '/promocoes' });
  });

  it('aceita a URL inteira copiada do navegador', () => {
    expect(normalizarDeepLink('https://oakvintage.com.br/produtos/jaqueta', LOJA)).toEqual({
      ok: true,
      caminho: '/produtos/jaqueta',
    });
  });

  it('aceita o www, que é a mesma loja', () => {
    expect(normalizarDeepLink('https://www.oakvintage.com.br/x', LOJA).ok).toBe(true);
  });

  it('mantém busca e fragmento, que fazem parte do destino', () => {
    expect(normalizarDeepLink('/search?q=tenis#topo', LOJA)).toEqual({
      ok: true,
      caminho: '/search?q=tenis#topo',
    });
  });

  it('sem link é válido: a campanha só abre o app', () => {
    expect(normalizarDeepLink('', LOJA)).toEqual({ ok: true, caminho: null });
    expect(normalizarDeepLink(undefined, LOJA)).toEqual({ ok: true, caminho: null });
    expect(normalizarDeepLink('   ', LOJA)).toEqual({ ok: true, caminho: null });
  });

  /*
   * A mesma razão do lado do app: abrir host de terceiro numa WebView sem
   * barra de endereço, com o ícone da loja em volta, é uma tela de phishing
   * pronta. Aqui o erro é barrado antes de virar campanha.
   */
  it('recusa endereço de fora da loja, com mensagem que ensina', () => {
    for (const fora of [
      'https://site-falso.com.br/entrar',
      'https://falsooakvintage.com.br/x',
      'https://oakvintage.com.br.evil.com/x',
    ]) {
      const r = normalizarDeepLink(fora, LOJA);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensagem).toContain('/promocoes');
    }
  });

  it('recusa esquema que não seja http(s)', () => {
    expect(normalizarDeepLink('javascript:alert(1)', LOJA).ok).toBe(false);
    expect(normalizarDeepLink('data:text/html,<b>x', LOJA).ok).toBe(false);
  });
});

describe('interpretarAgendamento', () => {
  it('vazio quer dizer enviar agora', () => {
    expect(interpretarAgendamento('', AGORA)).toEqual({ ok: true, quando: null });
    expect(interpretarAgendamento(undefined, AGORA)).toEqual({ ok: true, quando: null });
  });

  it('aceita um horário à frente', () => {
    const r = interpretarAgendamento('2026-09-19T15:00:00.000Z', AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.quando?.toISOString()).toBe('2026-09-19T15:00:00.000Z');
  });

  it('exige cinco minutos de antecedência', () => {
    const emCima = new Date(AGORA + ANTECEDENCIA_MINIMA_MS - 1000).toISOString();
    expect(interpretarAgendamento(emCima, AGORA).ok).toBe(false);
    const folgado = new Date(AGORA + ANTECEDENCIA_MINIMA_MS + 1000).toISOString();
    expect(interpretarAgendamento(folgado, AGORA).ok).toBe(true);
  });

  it('recusa horário no passado', () => {
    expect(interpretarAgendamento('2020-01-01T00:00:00.000Z', AGORA).ok).toBe(false);
  });

  /*
   * Data ilegível é ERRO, não "enviar agora". Confundir os dois faria uma
   * campanha que o lojista quis agendar sair na hora, para todo mundo.
   */
  it('data ilegível é erro, e não "enviar agora"', () => {
    const r = interpretarAgendamento('amanhã de manhã', AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toContain('data');
  });
});

describe('validarCampanha', () => {
  const base = { title: 'Promoção', body: 'Até 40% OFF', deepLink: '/promocoes' };

  it('aceita uma campanha completa', () => {
    const r = validarCampanha(base, { urlDaLoja: LOJA, agoraMs: AGORA });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valores).toEqual({
        title: 'Promoção',
        body: 'Até 40% OFF',
        deepLink: '/promocoes',
        agendarPara: null,
      });
    }
  });

  it('cobra título e mensagem, em pt-BR', () => {
    const r = validarCampanha({ title: '  ', body: '' }, { urlDaLoja: LOJA, agoraMs: AGORA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.map((p) => p.campo).sort()).toEqual(['body', 'title']);
      for (const problema of r.problemas) {
        expect(problema.mensagem).toMatch(/[a-z]/);
        expect(problema.mensagem).not.toContain('String');
        expect(problema.mensagem).not.toContain('expected');
      }
    }
  });

  it('recusa título longo demais para o banco aceitar', () => {
    const r = validarCampanha(
      { ...base, title: 'a'.repeat(121) },
      { urlDaLoja: LOJA, agoraMs: AGORA },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]?.campo).toBe('title');
  });

  it('junta os problemas de link e de horário numa vez só', () => {
    const r = validarCampanha(
      { ...base, deepLink: 'https://evil.com/x', agendarPara: '2020-01-01T00:00' },
      { urlDaLoja: LOJA, agoraMs: AGORA },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.campo).sort()).toEqual(['agendarPara', 'deepLink']);
  });
});

describe('previaDaNotificacao', () => {
  it('não corta o que cabe', () => {
    expect(previaDaNotificacao('Promoção de inverno', CORTE_IOS_TITULO)).toEqual({
      texto: 'Promoção de inverno',
      cortado: false,
    });
  });

  /*
   * O lojista precisa ver o corte ANTES de enviar. Depois não tem volta, e um
   * título que termina no meio de uma palavra na tela bloqueada é o que faz a
   * pessoa não abrir.
   */
  it('mostra onde o sistema vai cortar', () => {
    const longo = 'Promoção imperdível de inverno com frete grátis para todo o Brasil';
    const r = previaDaNotificacao(longo, CORTE_IOS_TITULO);
    expect(r.cortado).toBe(true);
    expect(r.texto.endsWith('…')).toBe(true);
    expect(r.texto.length).toBeLessThanOrEqual(CORTE_IOS_TITULO + 1);
  });

  it('não deixa espaço sobrando antes das reticências', () => {
    expect(previaDaNotificacao('abcde fghij klmno', 6).texto).toBe('abcde…');
  });
});

describe('lerMetricas', () => {
  it('lê o que o job de estatísticas gravou', () => {
    expect(lerMetricas({ enviados: 1000, entregues: 950, abertos: 190, falhas: 50 })).toEqual({
      enviados: 1000,
      entregues: 950,
      abertos: 190,
      falhas: 50,
      taxaDeAbertura: 0.2,
    });
  });

  /*
   * O caso central da regra 1 do CLAUDE.md. "0 aberturas" é uma AFIRMAÇÃO
   * sobre o desempenho da campanha: dita antes de o número chegar, faz o
   * lojista concluir que a campanha fracassou. `null` vira traço na tela.
   */
  it('sem estatística ainda, tudo é null — nunca zero', () => {
    for (const vazio of [{}, null, undefined, 'texto', 42, []]) {
      const m = lerMetricas(vazio);
      expect(m.enviados).toBeNull();
      expect(m.entregues).toBeNull();
      expect(m.abertos).toBeNull();
      expect(m.taxaDeAbertura).toBeNull();
    }
  });

  it('não calcula taxa sem entregues: nada de NaN nem de Infinity na tela', () => {
    expect(lerMetricas({ entregues: 0, abertos: 0 }).taxaDeAbertura).toBeNull();
    expect(lerMetricas({ abertos: 10 }).taxaDeAbertura).toBeNull();
  });

  it('descarta número impossível em vez de mostrá-lo', () => {
    const m = lerMetricas({ enviados: -5, entregues: Number.NaN, abertos: 'muitos' });
    expect(m.enviados).toBeNull();
    expect(m.entregues).toBeNull();
    expect(m.abertos).toBeNull();
  });

  it('zero de verdade continua sendo zero', () => {
    // Quando o job DIZ que houve zero aberturas, isso é informação, e some
    // com o traço: o traço é para "ainda não sabemos".
    expect(lerMetricas({ entregues: 100, abertos: 0 }).abertos).toBe(0);
    expect(lerMetricas({ entregues: 100, abertos: 0 }).taxaDeAbertura).toBe(0);
  });
});

describe('como os números aparecem', () => {
  it('null vira traço, não zero', () => {
    expect(numeroOuTraco(null)).toBe('—');
    expect(porcentagemOuTraco(null)).toBe('—');
  });

  it('número vira número em pt-BR', () => {
    expect(numeroOuTraco(0)).toBe('0');
    expect(numeroOuTraco(1234)).toBe('1.234');
    expect(porcentagemOuTraco(0.2)).toBe('20%');
    expect(porcentagemOuTraco(0.1234)).toBe('12,3%');
  });
});
