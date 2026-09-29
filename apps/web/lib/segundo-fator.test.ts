import { describe, expect, it } from 'vitest';
import {
  codigoDigitado,
  mensagemDoSegundoFator,
  qrComoImagem,
  segredoEmGrupos,
  situacaoDoSegundoFator,
} from '@/lib/segundo-fator';

const APP_CONFIRMADO = { factor_type: 'totp', status: 'verified' };
const APP_COMECADO = { factor_type: 'totp', status: 'unverified' };

describe('situacaoDoSegundoFator', () => {
  it('sem app cadastrado, a pessoa cadastra — qualquer que seja a sessão', () => {
    expect(situacaoDoSegundoFator('aal1', [])).toBe('falta-ativar');
    expect(situacaoDoSegundoFator('aal1', undefined)).toBe('falta-ativar');
    expect(situacaoDoSegundoFator(null, null)).toBe('falta-ativar');
  });

  it('cadastro começado e não confirmado não conta como app', () => {
    expect(situacaoDoSegundoFator('aal1', [APP_COMECADO])).toBe('falta-ativar');
  });

  it('com o app e a sessão só da senha, falta digitar o código', () => {
    expect(situacaoDoSegundoFator('aal1', [APP_CONFIRMADO])).toBe('falta-verificar');
    expect(situacaoDoSegundoFator(undefined, [APP_COMECADO, APP_CONFIRMADO])).toBe(
      'falta-verificar',
    );
  });

  it('com o app e a sessão confirmada, entra', () => {
    expect(situacaoDoSegundoFator('aal2', [APP_CONFIRMADO])).toBe('verificado');
  });

  it('sessão confirmada de quem teve o app redefinido não vale: cadastra de novo', () => {
    expect(situacaoDoSegundoFator('aal2', [])).toBe('falta-ativar');
  });

  it('outro tipo de fator não substitui o app autenticador', () => {
    expect(situacaoDoSegundoFator('aal2', [{ factor_type: 'phone', status: 'verified' }])).toBe(
      'falta-ativar',
    );
  });
});

describe('codigoDigitado', () => {
  it('aceita os seis dígitos, com espaço ou traço no meio', () => {
    expect(codigoDigitado('123456')).toBe('123456');
    expect(codigoDigitado(' 123 456 ')).toBe('123456');
    expect(codigoDigitado('123-456')).toBe('123456');
  });

  it('recusa o que não são seis dígitos', () => {
    expect(codigoDigitado('')).toBeNull();
    expect(codigoDigitado('12345')).toBeNull();
    expect(codigoDigitado('1234567')).toBeNull();
    expect(codigoDigitado('12a456')).toBeNull();
  });
});

describe('segredoEmGrupos', () => {
  it('quebra o segredo de quatro em quatro', () => {
    expect(segredoEmGrupos('ABCDEFGHIJKLMNOPQR')).toBe('ABCD EFGH IJKL MNOP QR');
    expect(segredoEmGrupos('')).toBe('');
  });
});

describe('qrComoImagem', () => {
  it('recodifica o SVG cru que o Auth devolve, para o # de uma cor não cortar a imagem', () => {
    const cru = 'data:image/svg+xml;utf-8,<svg fill="#000"><path d="M0 0"/></svg>';
    const endereco = qrComoImagem(cru);
    expect(endereco.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(endereco).not.toContain('#');
    expect(decodeURIComponent(endereco.split(',')[1] ?? '')).toBe(
      '<svg fill="#000"><path d="M0 0"/></svg>',
    );
  });

  it('o que já vem em base64 ou não é SVG passa como veio', () => {
    expect(qrComoImagem('data:image/svg+xml;base64,PHN2Zz4=')).toBe(
      'data:image/svg+xml;base64,PHN2Zz4=',
    );
    expect(qrComoImagem('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});

describe('mensagemDoSegundoFator', () => {
  it('código errado diz o que fazer', () => {
    expect(mensagemDoSegundoFator('mfa_verification_failed')).toContain('Código incorreto');
  });

  it('muitas tentativas pedem para esperar', () => {
    expect(mensagemDoSegundoFator('over_request_rate_limit')).toContain('Espere um minuto');
  });

  it('TOTP desligado no projeto aponta onde ligar', () => {
    expect(mensagemDoSegundoFator('mfa_totp_verify_not_enabled')).toContain('Authentication > MFA');
  });

  it('sessão que acabou manda entrar de novo', () => {
    expect(mensagemDoSegundoFator('session_not_found')).toContain('Entre de novo');
  });

  it('o resto tem uma resposta genérica, nunca vazia', () => {
    expect(mensagemDoSegundoFator(undefined)).toContain('Tente de novo');
    expect(mensagemDoSegundoFator('qualquer_outro')).toContain('Tente de novo');
  });
});
