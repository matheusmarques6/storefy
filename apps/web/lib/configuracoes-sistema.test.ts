/**
 * A lista de integrações da A13, e a trava contra ela envelhecer.
 *
 * O teste que importa aqui é o último: ele VARRE O CÓDIGO atrás de
 * `process.env.X` e falha quando acha uma variável que a tela não cobre. Sem
 * ele a lista vira documentação, e documentação envelhece calada — foi
 * exatamente o que aconteceu com a seção 12 do plano, que perdeu seis
 * variáveis, entre elas a que derrubou o OAuth da Shopify.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEGRACOES, conferir, resumo, variaveisCobertas } from '@/lib/configuracoes-sistema';

/** Tudo presente, para partir do caso feliz e ir tirando. */
function tudoPresente(): Record<string, boolean> {
  return Object.fromEntries(variaveisCobertas().map((nome) => [nome, true]));
}

describe('conferir', () => {
  it('com tudo no lugar, nada falta', () => {
    const conferidas = conferir(tudoPresente());

    expect(conferidas.every((i) => i.completa)).toBe(true);
    expect(conferidas.every((i) => i.faltando.length === 0)).toBe(true);
  });

  it('ambiente vazio deixa tudo incompleto, e diz o nome do que falta', () => {
    const conferidas = conferir({});

    expect(conferidas.every((i) => !i.completa)).toBe(true);
    const supabase = conferidas.find((i) => i.chave === 'supabase');
    expect(supabase?.faltando).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  /*
   * Meia integração é integração parada. "2 de 3" na tela daria a impressão de
   * estar quase lá quando na prática não funciona nada.
   */
  it('faltando uma variável de três, a integração inteira está incompleta', () => {
    const presentes = tudoPresente();
    presentes.SHOPIFY_API_SECRET = false;

    const shopify = conferir(presentes).find((i) => i.chave === 'shopify');
    expect(shopify?.completa).toBe(false);
    expect(shopify?.faltando).toEqual(['SHOPIFY_API_SECRET']);
  });

  it('variável presente com valor vazio conta como ausente', () => {
    const presentes = { ...tudoPresente(), ENCRYPTION_KEY: false };
    expect(conferir(presentes).find((i) => i.chave === 'cripto')?.completa).toBe(false);
  });
});

describe('resumo', () => {
  const necessarias = INTEGRACOES.filter((i) => i.nivel !== 'opcional').length;

  it('conta as completas e separa as essenciais que faltam', () => {
    const presentes = tudoPresente();
    presentes.ENCRYPTION_KEY = false;
    presentes.RESEND_API_KEY = false;

    const r = resumo(conferir(presentes));

    expect(r.total).toBe(necessarias);
    expect(r.completas).toBe(necessarias - 2);
    // Só a criptografia é essencial das duas que faltam.
    expect(r.essenciaisFaltando).toBe(1);
  });

  it('ambiente completo não tem essencial faltando', () => {
    expect(resumo(conferir(tudoPresente())).essenciaisFaltando).toBe(0);
  });

  /*
   * O defeito: Google e domínios próprios desligados apareciam como
   * "Faltando", com a chave tracejada em vermelho, ao lado de "Nada quebra".
   * Opcional desligada não é pendência, e não entra na conta de nada.
   */
  it('opcional desligada não falta, nem pesa na conta', () => {
    const presentes = tudoPresente();
    // Todas as opcionais, da própria lista: uma opcional nova entra sozinha.
    for (const integracao of INTEGRACOES.filter((item) => item.nivel === 'opcional')) {
      for (const variavel of integracao.variaveis) presentes[variavel] = false;
    }

    const r = resumo(conferir(presentes));

    expect(r.completas).toBe(r.total);
    expect(r.essenciaisFaltando).toBe(0);
    expect(r.opcionaisEmUso).toBe(0);
  });
});

describe('os níveis', () => {
  it('o que derruba o painel é essencial; o que é escolha é opcional', () => {
    const nivel = (chave: string) => INTEGRACOES.find((i) => i.chave === chave)?.nivel;

    expect(nivel('supabase')).toBe('essencial');
    expect(nivel('cripto')).toBe('essencial');
    expect(nivel('site')).toBe('essencial');
    expect(nivel('onesignal')).toBe('recurso');
    expect(nivel('google')).toBe('opcional');
    expect(nivel('dominios')).toBe('opcional');
  });

  it('opcional diz que nada deixa de funcionar sem ela', () => {
    for (const integracao of INTEGRACOES.filter((i) => i.nivel === 'opcional')) {
      expect(integracao.oQueQuebra, integracao.chave).toMatch(/continuam funcionando|Nada quebra/);
    }
  });
});

describe('a lista descreve o que precisa ser descrito', () => {
  it('toda integração diz o que quebra, em português e sem ficar vaga', () => {
    for (const integracao of INTEGRACOES) {
      expect(integracao.oQueQuebra.length, integracao.chave).toBeGreaterThan(20);
      expect(integracao.variaveis.length, integracao.chave).toBeGreaterThan(0);
    }
  });

  it('nenhuma chave de integração se repete', () => {
    const chaves = INTEGRACOES.map((i) => i.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('nenhuma variável aparece em duas integrações', () => {
    const todas = INTEGRACOES.flatMap((i) => i.variaveis);
    expect(new Set(todas).size).toBe(todas.length);
  });
});

/*
 * Variáveis que o código lê mas que NÃO pertencem à tela de configuração:
 * ambiente de execução e apoio de teste. Ficam nomeadas aqui em vez de
 * filtradas por prefixo para que somar uma nova exija um ato consciente.
 */
const FORA_DA_TELA = new Set([
  'NODE_ENV',
  'CI',
  'VERCEL_URL',
  'E2E_BASE_URL',
  'E2E_SEM_SERVIDOR',
  // O Chromium do e2e, quando o ambiente já tem um e não pode baixar outro.
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE',
]);

/**
 * O arquivo sem comentários.
 *
 * Necessário porque `process.env.X` aparece em PROSA nestes arquivos, ao
 * explicar o próprio mecanismo — e a primeira versão desta varredura acusou
 * `X` e `NEXT_PUBLIC_` como variáveis reais não descritas. Uma variável citada
 * num comentário não é uma variável lida.
 *
 * O `//` só é cortado quando não vem depois de `:`, senão `https://` levaria
 * meia linha junto.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function arquivosDeCodigo(raiz: string): string[] {
  const achados: string[] = [];

  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome === '.next' || nome.startsWith('.')) continue;

    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) {
      achados.push(caminho);
    }
  }

  return achados;
}

describe('a lista não envelhece', () => {
  /*
   * A trava. Somar uma variável nova ao código sem descrevê-la aqui faz este
   * teste falhar com o nome dela — e a pessoa que a somou é quem sabe dizer o
   * que quebra sem ela, seis meses antes de alguém precisar descobrir isso
   * sozinho num deploy quebrado.
   */
  it('toda variável que o código lê está descrita na tela', () => {
    const raiz = resolve(import.meta.dirname, '..');
    const lidas = new Set<string>();

    for (const arquivo of arquivosDeCodigo(raiz)) {
      const fonte = semComentarios(readFileSync(arquivo, 'utf8'));
      for (const achado of fonte.matchAll(/process\.env\.([A-Z][A-Z_0-9]*)/g)) {
        const nome = achado[1];
        if (nome != null && !FORA_DA_TELA.has(nome)) lidas.add(nome);
      }
    }

    const cobertas = new Set(variaveisCobertas());
    const descobertas = [...lidas].filter((nome) => !cobertas.has(nome)).sort();

    expect(descobertas, `variáveis lidas pelo código e não descritas na A13`).toEqual([]);
  });

  /* E o contrário: descrever uma variável que ninguém lê engana quem configura. */
  it('não descreve variável que o código não lê', () => {
    const raiz = resolve(import.meta.dirname, '..');
    const fontes = arquivosDeCodigo(raiz)
      .map((arquivo) => semComentarios(readFileSync(arquivo, 'utf8')))
      .join('\n');

    const orfas = variaveisCobertas().filter((nome) => !fontes.includes(`process.env.${nome}`));

    expect(orfas, 'variáveis descritas na A13 que o código não lê').toEqual([]);
  });
});
