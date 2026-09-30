import { describe, expect, it } from 'vitest';
import type { BuildNaLista } from '@/lib/publicacao-servidor';
import { MOTIVO_DO_PARADO } from '@/lib/builds-admin';
import { explicacaoDoBuild } from './historico';

const AGORA = Date.parse('2026-09-30T15:00:00.000Z');
const antes = (minutos: number) => new Date(AGORA - minutos * 60_000).toISOString();
const CONTEXTO = { iosAscAppId: null };

const build = (mudancas: Partial<BuildNaLista>): BuildNaLista => ({
  id: 'b1',
  platform: 'android',
  status: 'queued',
  version: null,
  buildNumber: null,
  error: null,
  logsUrl: null,
  artifactUrl: null,
  acaoManual: null,
  storeState: null,
  createdAt: antes(5),
  startedAt: null,
  finishedAt: null,
  ...mudancas,
});

describe('explicacaoDoBuild — o build parado no meio', () => {
  it('na fila há poucos minutos, diz que costuma começar logo', () => {
    expect(explicacaoDoBuild(build({}), CONTEXTO, AGORA)).toBe(
      'Esperando a vez. Costuma começar em poucos minutos.',
    );
  });

  /* O defeito: "esperando a vez" dito de um build na fila há horas. */
  it('na fila há horas, manda falar com o suporte em vez de esperar', () => {
    const explicacao = explicacaoDoBuild(build({ createdAt: antes(120) }), CONTEXTO, AGORA);
    expect(explicacao).toContain('Está demorando mais que o normal');
    expect(explicacao).toContain('Fale com o suporte pela Ajuda');
  });

  it('gerando conta desde que saiu da fila, e não desde que foi criado', () => {
    const recente = build({ status: 'building', createdAt: antes(300), startedAt: antes(20) });
    expect(explicacaoDoBuild(recente, CONTEXTO, AGORA)).toBe(
      'Gerando o binário. Leva de 15 a 30 minutos.',
    );

    const parado = build({ status: 'building', createdAt: antes(300), startedAt: antes(200) });
    expect(explicacaoDoBuild(parado, CONTEXTO, AGORA)).toContain('pode ter parado');
  });

  it('depois que a equipe encerra, é um build que falhou: nada de "pode ter parado"', () => {
    const encerrado = build({
      status: 'errored',
      createdAt: antes(300),
      error: MOTIVO_DO_PARADO,
      finishedAt: antes(1),
    });
    expect(explicacaoDoBuild(encerrado, CONTEXTO, AGORA)).not.toContain('pode ter parado');
  });
});
