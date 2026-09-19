import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autorizarJob, destinoDaFalha, faltaConfiguracao } from '@/lib/jobs';

const CHAVE = Buffer.alloc(32, 11).toString('base64');
let original: string | undefined;

beforeEach(() => {
  original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

describe('autorizarJob', () => {
  it('aceita o cabeçalho do nosso cron', () => {
    expect(autorizarJob('Bearer segredo-do-cron', 'segredo-do-cron')).toEqual({ ok: true });
  });

  it('tolera espaço em volta, que proxy costuma acrescentar', () => {
    expect(autorizarJob('  Bearer segredo-do-cron  ', 'segredo-do-cron').ok).toBe(true);
  });

  it('recusa segredo errado, faltando ou com formato torto', () => {
    for (const cabecalho of [
      null,
      '',
      'Bearer outro',
      'segredo-do-cron',
      'bearer segredo-do-cron',
      'Basic segredo-do-cron',
    ]) {
      const r = autorizarJob(cabecalho, 'segredo-do-cron');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
  });

  /*
   * Um job que roda sem segredo é um endpoint público que dispara notificação
   * para a base de TODOS os clientes. "Ainda não configurei" não pode ser a
   * porta de entrada disso.
   */
  it('sem CRON_SECRET configurado, recusa tudo', () => {
    for (const segredo of [undefined, '']) {
      const r = autorizarJob('Bearer qualquer', segredo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(503);
    }
  });

  it('não aceita prefixo do segredo certo', () => {
    // Uma comparação que pare na primeira diferença deixaria descobrir o
    // segredo caractere a caractere.
    expect(autorizarJob('Bearer segredo-do-cro', 'segredo-do-cron').ok).toBe(false);
    expect(autorizarJob('Bearer segredo-do-cronX', 'segredo-do-cron').ok).toBe(false);
  });
});

describe('destinoDaFalha', () => {
  it('falha permanente é marcada; passageira volta para a fila', () => {
    expect(destinoDaFalha(true)).toBe('falhar');
    expect(destinoDaFalha(false)).toBe('devolver');
  });
});

describe('faltaConfiguracao', () => {
  it('sem app na OneSignal, diz o que falta em pt-BR', () => {
    const motivo = faltaConfiguracao(null, 'chave-cifrada');
    expect(motivo).toContain('notificações');
    expect(motivo).not.toMatch(/onesignal|null|undefined/i);
  });

  it('sem chave, diz que falta a chave', () => {
    expect(faltaConfiguracao('os-1', null)).toContain('chave');
    expect(faltaConfiguracao('os-1', '')).toContain('chave');
  });

  it('com os dois, não falta nada', () => {
    expect(faltaConfiguracao('os-1', 'cifrada')).toBeNull();
  });
});
