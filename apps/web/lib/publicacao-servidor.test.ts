import { describe, expect, it } from 'vitest';
import { temBuildEmAndamento, type BuildNaLista } from '@/lib/publicacao-servidor';

const build = (status: BuildNaLista['status']): BuildNaLista => ({
  id: status,
  platform: 'ios',
  status,
  version: null,
  buildNumber: null,
  error: null,
  logsUrl: null,
  createdAt: '2026-09-19T12:00:00.000Z',
  finishedAt: null,
});

describe('temBuildEmAndamento', () => {
  it('sem build nenhum, não há o que acompanhar', () => {
    expect(temBuildEmAndamento([])).toBe(false);
  });

  it('build na fila ou gerando mantém a tela acompanhando', () => {
    expect(temBuildEmAndamento([build('queued')])).toBe(true);
    expect(temBuildEmAndamento([build('building')])).toBe(true);
    expect(temBuildEmAndamento([build('approved'), build('building')])).toBe(true);
  });

  /*
   * Os demais status são DESFECHO: o build não muda mais sozinho. Quem o tira
   * de `submitted` é a Apple ou o Google, pelo cron da revisão — outra
   * história e outra cadência. Acompanhar esses aqui deixaria a tela
   * recarregando por dias.
   */
  it('build terminado não mantém a tela recarregando', () => {
    for (const status of [
      'finished',
      'errored',
      'submitted',
      'in_review',
      'approved',
      'rejected',
      'canceled',
    ] as const) {
      expect(temBuildEmAndamento([build(status)])).toBe(false);
    }
  });
});
