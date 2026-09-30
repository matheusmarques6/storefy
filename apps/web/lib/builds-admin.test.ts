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
