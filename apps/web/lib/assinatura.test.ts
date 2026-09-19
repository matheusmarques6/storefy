import { describe, expect, it } from 'vitest';
import { assinar, conferirAssinatura, TOLERANCIA_MS } from '@/lib/assinatura';

const SEGREDO = 'segredo-do-app-da-loja';
const CORPO = JSON.stringify({ appId: 'app_1', subscriptionId: 'sub_1' });
const AGORA = 1_800_000_000_000;

describe('assinar', () => {
  it('produz o formato que o app manda', () => {
    expect(assinar(SEGREDO, AGORA, CORPO)).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('corpo diferente, assinatura diferente', () => {
    expect(assinar(SEGREDO, AGORA, CORPO)).not.toBe(assinar(SEGREDO, AGORA, `${CORPO} `));
  });

  it('segredo diferente, assinatura diferente', () => {
    expect(assinar(SEGREDO, AGORA, CORPO)).not.toBe(assinar('outro', AGORA, CORPO));
  });
});

describe('conferirAssinatura', () => {
  it('aceita a assinatura que ela mesma gerou', () => {
    expect(conferirAssinatura(assinar(SEGREDO, AGORA, CORPO), SEGREDO, CORPO, AGORA)).toEqual({
      ok: true,
    });
  });

  it('aceita relógio adiantado e atrasado dentro da janela', () => {
    // Celular com relógio adiantado é tão comum quanto atrasado; recusar só o
    // futuro deixaria parte dos aparelhos sem conseguir registrar nada.
    for (const desvio of [-TOLERANCIA_MS + 1000, -60_000, 0, 60_000, TOLERANCIA_MS - 1000]) {
      const cabecalho = assinar(SEGREDO, AGORA + desvio, CORPO);
      expect(conferirAssinatura(cabecalho, SEGREDO, CORPO, AGORA).ok, String(desvio)).toBe(true);
    }
  });

  it('RECUSA assinatura velha, que é uma repetição', () => {
    const cabecalho = assinar(SEGREDO, AGORA - TOLERANCIA_MS - 1000, CORPO);
    expect(conferirAssinatura(cabecalho, SEGREDO, CORPO, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura fora da janela de tempo',
    });
  });

  it('RECUSA corpo trocado com a mesma assinatura', () => {
    // É o ataque óbvio: pegar uma requisição válida e mudar o `appId` para o
    // de outra loja.
    const cabecalho = assinar(SEGREDO, AGORA, CORPO);
    const outroCorpo = JSON.stringify({ appId: 'app_de_outro', subscriptionId: 'sub_1' });
    expect(conferirAssinatura(cabecalho, SEGREDO, outroCorpo, AGORA).ok).toBe(false);
  });

  it('RECUSA assinatura de outro segredo', () => {
    const cabecalho = assinar('segredo-de-outra-loja', AGORA, CORPO);
    expect(conferirAssinatura(cabecalho, SEGREDO, CORPO, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura não confere',
    });
  });

  it('recusa cabeçalho ausente ou malformado', () => {
    for (const cabecalho of [null, '', '   ', 'abc', 't=,v1=', 'v1=abc', `t=${String(AGORA)}`]) {
      expect(conferirAssinatura(cabecalho, SEGREDO, CORPO, AGORA).ok, String(cabecalho)).toBe(
        false,
      );
    }
  });

  it('recusa quando o app não tem segredo configurado', () => {
    // Segredo vazio casaria com HMAC de segredo vazio; melhor recusar antes.
    expect(conferirAssinatura(assinar('', AGORA, CORPO), '', CORPO, AGORA)).toEqual({
      ok: false,
      motivo: 'app sem segredo configurado',
    });
  });

  it('tolera espaço e ordem trocada nos campos', () => {
    const t = Math.floor(AGORA / 1000);
    const original = assinar(SEGREDO, AGORA, CORPO);
    const v1 = /v1=([0-9a-f]+)/.exec(original)?.[1] ?? '';
    expect(conferirAssinatura(` v1=${v1} , t=${String(t)} `, SEGREDO, CORPO, AGORA).ok).toBe(true);
  });

  it('o motivo nunca conta o que o servidor esperava', () => {
    // Dizer "a assinatura certa seria X" ou "o horário certo é Y" entrega
    // meio caminho de uma repetição.
    for (const cabecalho of [null, 'abc', assinar('outro', AGORA, CORPO)]) {
      const resultado = conferirAssinatura(cabecalho, SEGREDO, CORPO, AGORA);
      if (resultado.ok) throw new Error('deveria recusar');
      expect(resultado.motivo).not.toMatch(/[0-9a-f]{16}/);
      expect(resultado.motivo).not.toContain(SEGREDO);
    }
  });
});
