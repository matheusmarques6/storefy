import { describe, expect, it } from 'vitest';
import { lerAcaoManual, temBuildEmAndamento, type BuildNaLista } from '@/lib/publicacao-servidor';

const build = (status: BuildNaLista['status']): BuildNaLista => ({
  id: status,
  platform: 'ios',
  status,
  version: null,
  buildNumber: null,
  error: null,
  logsUrl: null,
  artifactUrl: null,
  acaoManual: null,
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

/*
 * `manual_action` é texto com `check` no banco, e não enum. Um valor que o
 * banco aceite mas a tela não conheça viraria um card em branco — pior do que
 * o erro normal, porque some sem dizer nada.
 */
describe('lerAcaoManual', () => {
  it('reconhece os passos manuais que a tela sabe mostrar', () => {
    expect(lerAcaoManual('play_primeiro_envio')).toBe('play_primeiro_envio');
    expect(lerAcaoManual('envio_manual')).toBe('envio_manual');
  });

  it('o que a tela não conhece vira null, e não um card vazio', () => {
    for (const valor of [null, '', 'qualquer', 'PLAY_PRIMEIRO_ENVIO', 'envio manual']) {
      expect(lerAcaoManual(valor)).toBeNull();
    }
  });
});
