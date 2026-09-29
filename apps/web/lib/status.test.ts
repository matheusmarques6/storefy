import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOBS_DO_STATUS, haQuanto, resumoDoStatus, situacaoDoJob } from '@/lib/status';

const AGORA = Date.parse('2026-09-29T12:00:00Z');
const MIN = 60_000;
const antes = (minutos: number): string => new Date(AGORA - minutos * MIN).toISOString();

describe('haQuanto', () => {
  it('fala como gente', () => {
    expect(haQuanto(10_000)).toBe('há menos de 1 minuto');
    expect(haQuanto(MIN)).toBe('há 1 minuto');
    expect(haQuanto(45 * MIN)).toBe('há 45 minutos');
    expect(haQuanto(60 * MIN)).toBe('há 1 hora');
    expect(haQuanto(5 * 60 * MIN)).toBe('há 5 horas');
    expect(haQuanto(24 * 60 * MIN)).toBe('há 1 dia');
    expect(haQuanto(3 * 24 * 60 * MIN)).toBe('há 3 dias');
  });
});

describe('situacaoDoJob — o despacho, que roda a cada minuto', () => {
  it('sem batimento nenhum, está aguardando, e não "parado"', () => {
    expect(situacaoDoJob(undefined, 1, AGORA).estado).toBe('aguardando');
    expect(
      situacaoDoJob({ ultimoSucesso: null, ultimaFalha: null, falhandoDesde: null }, 1, AGORA)
        .estado,
    ).toBe('aguardando');
  });

  it('em dia até 5 minutos', () => {
    const certo = situacaoDoJob(
      { ultimoSucesso: antes(2), ultimaFalha: null, falhandoDesde: null },
      1,
      AGORA,
    );
    expect(certo).toEqual({ estado: 'operacional', detalhe: 'Última execução há 2 minutos.' });
    expect(
      situacaoDoJob({ ultimoSucesso: antes(5), ultimaFalha: null, falhandoDesde: null }, 1, AGORA)
        .estado,
    ).toBe('operacional');
  });

  it('com atraso até 30 minutos, e parado depois disso', () => {
    expect(
      situacaoDoJob({ ultimoSucesso: antes(12), ultimaFalha: null, falhandoDesde: null }, 1, AGORA)
        .estado,
    ).toBe('instavel');
    const parado = situacaoDoJob(
      { ultimoSucesso: antes(90), ultimaFalha: null, falhandoDesde: null },
      1,
      AGORA,
    );
    expect(parado).toEqual({ estado: 'parado', detalhe: 'Sem executar há 1 hora.' });
  });

  it('a última falhou: instável enquanto a falha é recente, parado depois da tolerância', () => {
    expect(
      situacaoDoJob(
        { ultimoSucesso: antes(3), ultimaFalha: antes(1), falhandoDesde: antes(1) },
        1,
        AGORA,
      ).estado,
    ).toBe('instavel');
    expect(
      situacaoDoJob(
        { ultimoSucesso: antes(125), ultimaFalha: antes(1), falhandoDesde: antes(120) },
        1,
        AGORA,
      ),
    ).toEqual({ estado: 'parado', detalhe: 'Falhando há 2 horas.' });
  });

  it('a primeira execução falhou agora: a próxima tenta, e não é "parado"', () => {
    expect(
      situacaoDoJob(
        { ultimoSucesso: null, ultimaFalha: antes(1), falhandoDesde: antes(1) },
        1,
        AGORA,
      ),
    ).toEqual({
      estado: 'instavel',
      detalhe: 'A última execução falhou; a próxima tenta de novo.',
    });
  });

  it('o tempo de falha conta de quando começou, e não da última tentativa', () => {
    // Enquanto o cron roda, a última tentativa é sempre recente.
    expect(
      situacaoDoJob(
        { ultimoSucesso: null, ultimaFalha: antes(1), falhandoDesde: antes(90) },
        1,
        AGORA,
      ).estado,
    ).toBe('parado');
  });

  it('uma falha antiga, seguida de sucesso, não pesa', () => {
    expect(
      situacaoDoJob(
        { ultimoSucesso: antes(1), ultimaFalha: antes(30), falhandoDesde: null },
        1,
        AGORA,
      ).estado,
    ).toBe('operacional');
  });
});

describe('situacaoDoJob — a revisão, que roda de hora em hora', () => {
  it('duas horas sem rodar ainda é normal; doze, não', () => {
    expect(
      situacaoDoJob(
        { ultimoSucesso: antes(120), ultimaFalha: null, falhandoDesde: null },
        60,
        AGORA,
      ).estado,
    ).toBe('operacional');
    expect(
      situacaoDoJob(
        { ultimoSucesso: antes(12 * 60), ultimaFalha: null, falhandoDesde: null },
        60,
        AGORA,
      ).estado,
    ).toBe('parado');
  });
});

describe('JOBS_DO_STATUS', () => {
  it('os intervalos batem com o vercel.json', () => {
    const vercel = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'vercel.json'), 'utf8'),
    ) as { crons: { path: string; schedule: string }[] };

    const intervaloDoCron = (agenda: string): number => {
      const [minuto, hora] = agenda.split(' ');
      if (minuto === '*') return 1;
      if (minuto?.startsWith('*/') === true) return Number(minuto.slice(2));
      if (hora === '*') return 60;
      return 24 * 60;
    };

    for (const job of JOBS_DO_STATUS) {
      const cron = vercel.crons.find((c) => c.path === `/api/jobs/${job.job}`);
      expect(cron, job.job).toBeDefined();
      expect(intervaloDoCron(cron?.schedule ?? ''), job.job).toBe(job.intervaloMin);
    }
    // E nenhum cron fica de fora da página.
    expect(vercel.crons).toHaveLength(JOBS_DO_STATUS.length);
  });
});

describe('resumoDoStatus', () => {
  it('o pior componente decide a frase do topo', () => {
    expect(resumoDoStatus(['operacional', 'parado', 'instavel']).estado).toBe('parado');
    expect(resumoDoStatus(['operacional', 'instavel']).estado).toBe('instavel');
    expect(resumoDoStatus(['operacional', 'aguardando']).estado).toBe('operacional');
    expect(resumoDoStatus(['aguardando', 'aguardando']).estado).toBe('aguardando');
    expect(resumoDoStatus(['operacional']).frase).toBe('Tudo funcionando.');
  });
});
