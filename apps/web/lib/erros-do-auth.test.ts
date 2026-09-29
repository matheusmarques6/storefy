import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALHA_GENERICA } from '@/lib/erros';
import { traduzirErroAuth } from '@/lib/erros-do-auth';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('traduzirErroAuth', () => {
  it('credencial errada não diz se o e-mail existe', () => {
    expect(traduzirErroAuth('invalid_credentials', 'Invalid login credentials')).toBe(
      'E-mail ou senha incorretos.',
    );
  });

  /*
   * O login do admin respondia "E-mail ou senha incorretos." para tudo. Com o
   * limite de tentativas estourado, a pessoa conferia uma senha que estava
   * certa e tentava de novo — piorando o bloqueio.
   */
  it('limite de tentativas é dito como limite, e não como senha errada', () => {
    for (const codigo of ['over_request_rate_limit', 'over_email_send_rate_limit']) {
      expect(traduzirErroAuth(codigo, 'rate limit')).toContain('Muitas tentativas');
    }
  });

  it('o que não conhecemos vira a reserva, e o original vai para o log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(traduzirErroAuth('unexpected_failure', 'fetch failed')).toBe(FALHA_GENERICA);
    const linha = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, string>;
    expect(linha).toMatchObject({
      evento: 'auth.falha-do-banco',
      codigo: 'unexpected_failure',
      texto: 'fetch failed',
    });
  });
});
