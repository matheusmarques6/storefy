/**
 * O lojista lê português, e só o que foi escrito para ele.
 *
 * O defeito que isto trava: as ações devolviam `error.message` do Supabase
 * direto para a tela — "new row violates row-level security policy for table
 * stores", "JWT expired", "fetch failed" —, às vezes com um "Não foi possível
 * salvar:" em português na frente, o que só deixava a frase mais estranha.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErroParaATela,
  FALHA_GENERICA,
  FRASE_DO_ERRO,
  mensagemDaFalha,
  mensagemDeErro,
  situacaoDoErro,
  textoNossoDaFalha,
} from '@/lib/erros';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('textoNossoDaFalha', () => {
  it('deixa passar a frase das nossas funções SQL (P0001)', () => {
    expect(
      textoNossoDaFalha({
        code: 'P0001',
        message: 'A organização precisa de pelo menos um owner.',
      }),
    ).toBe('A organização precisa de pelo menos um owner.');
  });

  it('segura a mensagem de diagnóstico, mesmo nossa', () => {
    expect(
      textoNossoDaFalha({
        code: 'P0001',
        message: 'handle_audit: org_id não resolvido para a tabela stores',
      }),
    ).toBeNull();
  });

  it('segura tudo que vem do Postgres ou do Auth', () => {
    expect(
      textoNossoDaFalha({
        code: '42501',
        message: 'new row violates row-level security policy for table "stores"',
      }),
    ).toBeNull();
    expect(textoNossoDaFalha({ code: 'unexpected_failure', message: 'fetch failed' })).toBeNull();
    expect(textoNossoDaFalha({ message: 'JWT expired' })).toBeNull();
  });

  it('P0001 sem texto não vira mensagem vazia na tela', () => {
    expect(textoNossoDaFalha({ code: 'P0001', message: '   ' })).toBeNull();
  });
});

describe('mensagemDaFalha', () => {
  it('troca o texto técnico pela reserva e manda o original para o log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const mensagem = mensagemDaFalha(
      'lojas',
      { code: '42P01', message: 'relation "public.stores" does not exist' },
      FALHA_GENERICA,
    );

    expect(mensagem).toBe(FALHA_GENERICA);
    const linha = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, string>;
    expect(linha).toMatchObject({
      evento: 'lojas.falha-do-banco',
      codigo: '42P01',
      texto: 'relation "public.stores" does not exist',
    });
  });

  it('a frase nossa vai para a tela, e não enche o log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      mensagemDaFalha(
        'app',
        { code: 'P0001', message: 'Este app não tem rascunho para receber a restauração.' },
        FALHA_GENERICA,
      ),
    ).toBe('Este app não tem rascunho para receber a restauração.');
    expect(log).not.toHaveBeenCalled();
  });
});

/*
 * A trava contra a volta do defeito: nenhum arquivo que fala com a tela monta
 * mensagem com o `.message` de uma falha. As rotas de `app/api` ficam de fora
 * porque lá o `motivo` vai para o log, e não para ninguém ler.
 */
function arquivos(raiz: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

describe('nenhuma tela mostra a mensagem crua de uma falha', () => {
  it('ações e bibliotecas não devolvem `.message` como texto para o lojista', () => {
    const raiz = resolve(import.meta.dirname, '..');
    const suspeitos = [
      // mensagem: `Não foi possível salvar: ${error.message}`
      /(mensagem|motivo)\s*:\s*`[^`]*\$\{\s*\w+\.message\s*\}/,
      // motivo: error.message — e erroDaLoja.message, falhaDoBanco.message…
      /(mensagem|motivo)\s*:\s*(error|erro|falha)\w*\.message\b/,
      // return mensagem !== '' ? mensagem : '…'
      /mensagem\s*!==\s*''\s*\?\s*mensagem/,
    ];

    const achados: string[] = [];
    for (const arquivo of [...arquivos(join(raiz, 'app')), ...arquivos(join(raiz, 'lib'))]) {
      const relativo = relative(raiz, arquivo);
      if (relativo.startsWith('app/api/')) continue;

      readFileSync(arquivo, 'utf8')
        .split('\n')
        .forEach((linha, indice) => {
          if (suspeitos.some((padrao) => padrao.test(linha))) {
            achados.push(`${relativo}:${String(indice + 1)}: ${linha.trim()}`);
          }
        });
    }

    expect(achados).toEqual([]);
  });
});

/*
 * O que chega à tela vindo do motor fala inglês técnico. Cada caso conhecido
 * tem a sua frase; o nosso (`ErroParaATela`) passa como está; o resto, a
 * reserva de quem sabe o que estava sendo feito.
 */
describe('situacaoDoErro e mensagemDeErro', () => {
  const comDigest = (mensagem: string) => Object.assign(new Error(mensagem), { digest: '123456' });

  it('o erro escrito para a tela passa como está', () => {
    const erro = new ErroParaATela('Não foi possível abrir esta loja.');
    expect(situacaoDoErro(erro)).toBe('para-a-tela');
    expect(mensagemDeErro(erro, 'reserva')).toBe('Não foi possível abrir esta loja.');
  });

  it('o painel aberto antes de uma atualização pede para recarregar', () => {
    const pedaco = Object.assign(new Error('Loading chunk 123 failed.'), {
      name: 'ChunkLoadError',
    });
    const acao = new Error('Server Action "7f3a" was not found on the server.');
    for (const erro of [pedaco, acao]) {
      expect(situacaoDoErro(erro)).toBe('painel-atualizado');
      expect(mensagemDeErro(erro, 'reserva')).toBe(FRASE_DO_ERRO['painel-atualizado']);
    }
  });

  it('a rede fora, em qualquer navegador, vira "sem conexão"', () => {
    for (const texto of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
    ]) {
      expect(situacaoDoErro(new TypeError(texto)), texto).toBe('sem-conexao');
      expect(mensagemDeErro(new TypeError(texto), 'reserva')).toBe(FRASE_DO_ERRO['sem-conexao']);
    }
  });

  it('o erro do servidor, com a frase em inglês que o Next põe em produção, não vai para a tela', () => {
    const doServidor = comDigest(
      'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.',
    );
    expect(situacaoDoErro(doServidor)).toBe('servidor');
    expect(situacaoDoErro(new Error('An unexpected response was received from the server.'))).toBe(
      'servidor',
    );
    expect(mensagemDeErro(doServidor, 'Não foi possível excluir a loja.')).toBe(
      'Não foi possível excluir a loja.',
    );
  });

  it('o erro qualquer, em inglês ou não, fica com a reserva', () => {
    const tecnico = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(situacaoDoErro(tecnico)).toBe('outro');
    expect(mensagemDeErro(tecnico, 'Não foi possível trocar de loja.')).toBe(
      'Não foi possível trocar de loja.',
    );
    expect(mensagemDeErro('um texto solto', 'reserva')).toBe('reserva');
    expect(mensagemDeErro(new ErroParaATela(''), 'reserva')).toBe('reserva');
  });
});
