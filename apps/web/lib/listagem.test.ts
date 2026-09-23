import { describe, expect, it } from 'vitest';
import {
  POR_PAGINA,
  lerParams,
  montarUrlDePagina,
  normalizarBusca,
  termoParaIlike,
  totalDePaginas,
} from './listagem';

describe('lerParams', () => {
  it('usa a primeira página quando nada é informado', () => {
    expect(lerParams({})).toEqual({ busca: '', pagina: 1, de: 0, ate: POR_PAGINA - 1 });
  });

  it('calcula o intervalo da página pedida', () => {
    const { pagina, de, ate } = lerParams({ pagina: '3' });
    expect(pagina).toBe(3);
    expect(de).toBe(40);
    expect(ate).toBe(59);
  });

  it('cai para a primeira página com valor inválido', () => {
    for (const valor of ['0', '-5', 'abc', '', 'NaN']) {
      expect(lerParams({ pagina: valor }).pagina).toBe(1);
    }
  });

  it('limita uma página absurda, para não estourar o offset no banco', () => {
    // Sem o teto, `?pagina=99999999999` vira um offset maior do que um integer
    // do Postgres aguenta, e a consulta falha com 400 em vez de lista vazia.
    const { pagina, de } = lerParams({ pagina: '99999999999' });
    expect(pagina).toBeLessThanOrEqual(100_000);
    expect(Number.isSafeInteger(de)).toBe(true);
    expect(de).toBeLessThan(2_147_483_647);
  });

  it('ignora parte decimal', () => {
    expect(lerParams({ pagina: '2.9' }).pagina).toBe(2);
  });
});

describe('normalizarBusca', () => {
  it('remove espaços nas pontas', () => {
    expect(normalizarBusca('  loja  ')).toBe('loja');
  });

  it('devolve vazio quando não há termo', () => {
    expect(normalizarBusca(undefined)).toBe('');
  });

  it('corta termo longo demais', () => {
    expect(normalizarBusca('x'.repeat(500))).toHaveLength(80);
  });
});

describe('termoParaIlike', () => {
  it('mantém um termo comum intacto', () => {
    expect(termoParaIlike('Minha Loja')).toBe('Minha Loja');
  });

  it('troca os separadores do PostgREST por espaço', () => {
    // Vírgula e parênteses separam cláusulas no filtro `or`: sem trocar, o
    // servidor devolveria 400 e o usuário veria tela de erro.
    expect(termoParaIlike('loja, teste')).toBe('loja  teste');
    expect(termoParaIlike('loja (nova)')).toBe('loja  nova');
  });

  it('escapa os curingas do LIKE', () => {
    // Sem escapar, buscar por "%" casaria com tudo.
    expect(termoParaIlike('%')).toBe('\\%');
    expect(termoParaIlike('a_b')).toBe('a\\_b');
    expect(termoParaIlike('100%')).toBe('100\\%');
  });

  it('escapa a barra invertida antes dos curingas', () => {
    expect(termoParaIlike('a\\b')).toBe('a\\\\b');
  });

  it('devolve vazio para termo só de separadores', () => {
    expect(termoParaIlike(' , ( ) ')).toBe('');
  });
});

describe('totalDePaginas', () => {
  it('devolve ao menos uma página, mesmo sem resultados', () => {
    expect(totalDePaginas(0)).toBe(1);
  });

  it('arredonda para cima', () => {
    expect(totalDePaginas(POR_PAGINA)).toBe(1);
    expect(totalDePaginas(POR_PAGINA + 1)).toBe(2);
  });
});

describe('montarUrlDePagina', () => {
  it('página 1 não aparece na URL', () => {
    expect(montarUrlDePagina('/admin/lojas', { pagina: 1 })).toBe('/admin/lojas');
  });

  it('leva a busca e a página juntas', () => {
    const url = montarUrlDePagina('/admin/lojas', { busca: 'acme', pagina: 3 });
    expect(url).toBe('/admin/lojas?q=acme&pagina=3');
  });

  /*
   * O bug que motivou extrair esta função do componente: um `base` que já
   * trazia filtro virava `/admin/builds?filtro=problema?pagina=2`, com dois
   * pontos de interrogação. O navegador lê o segundo como parte do VALOR do
   * primeiro, e a página 2 volta calada para a 1.
   */
  it('base que já tem query não ganha um segundo "?"', () => {
    const url = montarUrlDePagina('/admin/builds?filtro=problema', { pagina: 2 });
    expect(url.match(/\?/g)).toHaveLength(1);
    expect(url).toBe('/admin/builds?filtro=problema&pagina=2');
  });

  it('o filtro sobrevive à troca de página', () => {
    const url = montarUrlDePagina('/admin/builds', { pagina: 2, extras: { filtro: 'andamento' } });
    expect(url).toContain('filtro=andamento');
    expect(url).toContain('pagina=2');
  });

  it('extra vazio não polui a URL', () => {
    expect(montarUrlDePagina('/admin/builds', { extras: { filtro: '' } })).toBe('/admin/builds');
  });

  /* Voltar para a página 1 tem que TIRAR o `pagina` que veio no base. */
  it('voltar para a primeira página remove o parâmetro antigo', () => {
    const url = montarUrlDePagina('/admin/builds?filtro=todos&pagina=5', { pagina: 1 });
    expect(url).toBe('/admin/builds?filtro=todos');
  });
});
