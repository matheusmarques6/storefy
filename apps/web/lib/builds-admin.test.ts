/**
 * As duas decisões que custam caro: quem pode ser reexecutado, e quando uma
 * revisão deixou de ser normal.
 *
 * A primeira é a que quebra de verdade — reexecutar um build que ainda roda
 * gera dois binários disputando o mesmo número de versão, e a Apple recusa o
 * segundo depois de gerar os dois. Esse erro custa uma hora de build e uma
 * submissão perdida, e não aparece em nenhum lugar até a loja responder.
 */
import { describe, expect, it } from 'vitest';
import type { BuildStatus } from '@storefy/db';
import {
  MINUTOS_NA_FILA,
  buildParado,
  descricaoDoParado,
  diasEsperando,
  lerFiltro,
  lerOrganizacao,
  lerPlataforma,
  podeReexecutar,
  statusDoFiltro,
} from '@/lib/builds-admin';

const TODOS: BuildStatus[] = [
  'queued',
  'building',
  'finished',
  'errored',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'canceled',
];

describe('podeReexecutar', () => {
  it('só o que parou e parou mal', () => {
    const podem = TODOS.filter(podeReexecutar);
    expect(podem).toEqual(['errored', 'canceled']);
  });

  /*
   * O caso que motiva a função. Se alguém relaxar isto para "tudo que não é
   * finished", `queued` e `building` entram e o bug volta.
   */
  it('build ainda rodando NUNCA pode ser reexecutado', () => {
    expect(podeReexecutar('queued')).toBe(false);
    expect(podeReexecutar('building')).toBe(false);
  });

  /* O binário está com a Apple: gerar outro cria uma segunda revisão. */
  it('build que está com a loja não pode ser reexecutado', () => {
    expect(podeReexecutar('submitted')).toBe(false);
    expect(podeReexecutar('in_review')).toBe(false);
  });
});

describe('lerFiltro e statusDoFiltro', () => {
  /*
   * O padrão é "com problema", e não "todos": quem abre a fila está atrás do
   * que quebrou, e numa plataforma com trezentos builds "todos" enterra os
   * cinco que importam.
   */
  it('sem filtro na URL, abre no que tem problema', () => {
    expect(lerFiltro(undefined)).toBe('problema');
    expect(lerFiltro('')).toBe('problema');
    expect(lerFiltro('inventado')).toBe('problema');
  });

  it('respeita um filtro conhecido', () => {
    expect(lerFiltro('andamento')).toBe('andamento');
    expect(lerFiltro('todos')).toBe('todos');
  });

  it('"todos" não filtra nada', () => {
    expect(statusDoFiltro('todos')).toBeNull();
  });

  /*
   * Os recortes não podem se sobrepor: um build que aparece em dois lugares
   * faz a pessoa contar o mesmo problema duas vezes.
   */
  it('os recortes não se sobrepõem', () => {
    const vistos = new Set<string>();
    for (const filtro of ['problema', 'andamento', 'revisao'] as const) {
      for (const status of statusDoFiltro(filtro) ?? []) {
        expect(vistos.has(status)).toBe(false);
        vistos.add(status);
      }
    }
  });
});

describe('diasEsperando', () => {
  const AGORA = Date.parse('2026-09-23T12:00:00Z');

  it('conta os dias inteiros desde o envio', () => {
    expect(diasEsperando('2026-09-20T12:00:00Z', AGORA)).toBe(3);
  });

  it('sem data de envio, não há conta a fazer', () => {
    expect(diasEsperando(null, AGORA)).toBeNull();
    expect(diasEsperando('', AGORA)).toBeNull();
    expect(diasEsperando('não é data', AGORA)).toBeNull();
  });

  /* Relógio torto não vira "esperando há -1 dia" na tela. */
  it('data no futuro vira zero, nunca negativo', () => {
    expect(diasEsperando('2026-09-30T12:00:00Z', AGORA)).toBe(0);
  });
});

describe('lerPlataforma e lerOrganizacao', () => {
  it('a plataforma só vale se for uma das duas; o resto é "as duas"', () => {
    expect(lerPlataforma('ios')).toBe('ios');
    expect(lerPlataforma('android')).toBe('android');
    for (const bruto of [undefined, '', 'IOS', 'windows', "ios' or 1=1"]) {
      expect(lerPlataforma(bruto), String(bruto)).toBeNull();
    }
  });

  it('o cliente só vale como uuid — um texto qualquer viraria erro do banco', () => {
    const id = '3F6C1A2E-8D4B-4C7A-9E10-5B2F8A7C6D41';
    expect(lerOrganizacao(id)).toBe(id.toLowerCase());
    expect(lerOrganizacao(` ${id} `)).toBe(id.toLowerCase());
    for (const bruto of [undefined, '', 'empresa', `${id},outro`, `${id})`]) {
      expect(lerOrganizacao(bruto), String(bruto)).toBeNull();
    }
  });
});

describe('buildParado', () => {
  const agora = Date.parse('2026-09-30T12:00:00Z');
  const antes = (minutos: number) => new Date(agora - minutos * 60_000).toISOString();

  it('na fila há mais de meia hora é parado; há menos, está esperando a vez', () => {
    expect(
      buildParado(
        { status: 'queued', criadoEm: antes(MINUTOS_NA_FILA + 1), iniciadoEm: null },
        agora,
      ),
    ).toBe(true);
    expect(
      buildParado(
        { status: 'queued', criadoEm: antes(MINUTOS_NA_FILA - 1), iniciadoEm: null },
        agora,
      ),
    ).toBe(false);
  });

  it('gerando conta desde o começo, e não desde a fila', () => {
    // Criado há 5 h, mas começou há 1 h: só está demorando.
    expect(
      buildParado({ status: 'building', criadoEm: antes(300), iniciadoEm: antes(60) }, agora),
    ).toBe(false);
    expect(
      buildParado({ status: 'building', criadoEm: antes(300), iniciadoEm: antes(200) }, agora),
    ).toBe(true);
    // Sem o começo gravado, vale a criação.
    expect(buildParado({ status: 'building', criadoEm: antes(200), iniciadoEm: null }, agora)).toBe(
      true,
    );
  });

  it('o que já terminou, bem ou mal, nunca está parado', () => {
    for (const status of ['finished', 'errored', 'submitted', 'approved', 'canceled'] as const) {
      expect(
        buildParado({ status, criadoEm: antes(10_000), iniciadoEm: antes(10_000) }, agora),
      ).toBe(false);
    }
    expect(buildParado({ status: 'queued', criadoEm: 'lixo', iniciadoEm: null }, agora)).toBe(
      false,
    );
  });

  it('diz onde parou e há quanto tempo', () => {
    expect(
      descricaoDoParado({ status: 'queued', criadoEm: antes(45), iniciadoEm: null }, agora),
    ).toBe('Na fila há 45 min');
    expect(
      descricaoDoParado(
        { status: 'building', criadoEm: antes(600), iniciadoEm: antes(250) },
        agora,
      ),
    ).toBe('Gerando há 4 h');
  });
});
