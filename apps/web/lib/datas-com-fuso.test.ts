/**
 * Nenhuma data é formatada sem fuso.
 *
 * A Vercel roda em UTC. `toLocaleString` sem `timeZone` no servidor escreve a
 * hora de Greenwich — três horas à frente de Brasília —, e num componente de
 * cliente é pior: o servidor escreve UTC, o navegador reescreve no fuso local,
 * e o texto troca na frente do usuário. Eram dezessete lugares assim.
 *
 * Esta varredura exige `timeZone` em toda formatação de DATA fora de
 * `lib/fuso.ts`. Formatação de NÚMERO (`total.toLocaleString('pt-BR')`) não é
 * acusada: só entra aqui a chamada que é de data pelo nome
 * (`toLocaleDateString`, `toLocaleTimeString`) ou pelas opções (`dateStyle`,
 * `timeStyle`) ou por ser feita direto num `new Date(...)`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(import.meta.dirname, '..');

/**
 * Os que podem ficar sem fuso, e por quê. Somar um aqui exige escrever o
 * motivo — é o que separa uma exceção de um esquecimento.
 */
const PERMITIDOS: Record<string, string> = {
  'lib/fuso.ts': 'é onde o fuso é aplicado',
  'app/(client)/(painel)/app/previa-no-celular.tsx':
    'o "vale até" só nasce depois de um clique, no navegador, e é sobre o relógio de quem lê',
  'app/(client)/(painel)/push/adicionar-celular.tsx':
    'o "vale até" do código do celular de teste: nasce depois de um clique, e o prazo é contado no relógio de quem lê',
};

function arquivos(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** Os argumentos da chamada que começa em `inicio` (o índice do "("). */
function argumentos(fonte: string, inicio: number): string {
  let profundidade = 0;
  for (let i = inicio; i < fonte.length; i += 1) {
    if (fonte[i] === '(') profundidade += 1;
    if (fonte[i] === ')') {
      profundidade -= 1;
      if (profundidade === 0) return fonte.slice(inicio, i + 1);
    }
  }
  return fonte.slice(inicio);
}

function chamadasDeDataSemFuso(fonte: string): string[] {
  const achadas: string[] = [];
  const padrao = /(new Date\([^()]*\))?\.(toLocaleString|toLocaleDateString|toLocaleTimeString)\(/g;

  for (const achado of fonte.matchAll(padrao)) {
    const abre = achado.index + achado[0].length - 1;
    const args = argumentos(fonte, abre);
    const ehData =
      achado[2] !== 'toLocaleString' || achado[1] !== undefined || /dateStyle|timeStyle/.test(args);

    if (ehData && !args.includes('timeZone')) {
      const linha = fonte.slice(0, achado.index).split('\n').length;
      achadas.push(`linha ${String(linha)}: ${achado[0]}…`);
    }
  }
  return achadas;
}

describe('datas com fuso', () => {
  it('a varredura acha arquivos (senão passaria calada)', () => {
    expect(arquivos(RAIZ).length).toBeGreaterThan(100);
  });

  it('toda data formatada fora de lib/fuso.ts diz o fuso', () => {
    const problemas: string[] = [];

    for (const arquivo of arquivos(RAIZ)) {
      const nome = relative(RAIZ, arquivo);
      if (nome in PERMITIDOS) continue;
      for (const achado of chamadasDeDataSemFuso(readFileSync(arquivo, 'utf8'))) {
        problemas.push(`${nome} ${achado}`);
      }
    }

    expect(problemas, 'datas formatadas sem timeZone — use lib/fuso.ts').toEqual([]);
  });

  it('não acusa formatação de número', () => {
    expect(chamadasDeDataSemFuso("const x = total.toLocaleString('pt-BR');")).toEqual([]);
    expect(
      chamadasDeDataSemFuso("(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })"),
    ).toEqual([]);
  });

  it('acusa data sem fuso, nas três formas', () => {
    expect(chamadasDeDataSemFuso("new Date(x).toLocaleString('pt-BR')")).toHaveLength(1);
    expect(chamadasDeDataSemFuso("d.toLocaleDateString('pt-BR')")).toHaveLength(1);
    expect(chamadasDeDataSemFuso("d.toLocaleString('pt-BR', { dateStyle: 'short' })")).toHaveLength(
      1,
    );
  });

  it('não acusa quando o fuso está lá, mesmo em outra linha', () => {
    expect(
      chamadasDeDataSemFuso(
        "d.toLocaleDateString('pt-BR', {\n  day: '2-digit',\n  timeZone: 'America/Sao_Paulo',\n})",
      ),
    ).toEqual([]);
  });
});
