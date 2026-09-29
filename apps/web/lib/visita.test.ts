/**
 * O token da visita ao painel do cliente.
 *
 * Ele é o que separa "alguém da equipe está lendo o painel deste cliente" de
 * "qualquer um lê o painel de qualquer cliente". Cada teste abaixo é um jeito
 * de tentar a segunda coisa.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DURACAO_DA_VISITA_MS,
  DURACAO_DO_CONVITE_MS,
  MOTIVO_MAXIMO,
  assinarToken,
  conferirMotivo,
  lerToken,
  type DadosDaVisita,
} from '@/lib/visita';
import { donoDoToken } from '@/lib/visita-nomes';

const CHAVE = randomBytes(32);
const AGORA = Date.parse('2026-09-29T15:00:00Z');
const VISITA: DadosDaVisita = {
  orgId: '0f8b1a3e-3f65-4d7c-9a1f-2b6f5a1e9c01',
  adminId: '7c2d9e4b-8a1f-4c3d-b2e1-9f0a6d5c4b32',
  expiraEm: AGORA + DURACAO_DA_VISITA_MS,
};

describe('lerToken', () => {
  it('lê o que foi assinado com a mesma chave', () => {
    expect(lerToken(assinarToken('visita', VISITA, CHAVE), 'visita', CHAVE, AGORA)).toEqual(VISITA);
  });

  it('recusa com outra chave', () => {
    const token = assinarToken('visita', VISITA, CHAVE);
    expect(lerToken(token, 'visita', randomBytes(32), AGORA)).toBeNull();
  });

  /*
   * A tentativa óbvia: pegar o próprio token e trocar a organização por a de
   * outro cliente. A assinatura cobre a carga inteira.
   */
  it('recusa a carga trocada, mesmo com a assinatura original', () => {
    const [versao, , assinatura] = assinarToken('visita', VISITA, CHAVE).split('.');
    const outraCarga = Buffer.from(
      JSON.stringify({
        t: 'visita',
        org: '11111111-1111-4111-8111-111111111111',
        admin: VISITA.adminId,
        exp: VISITA.expiraEm,
      }),
    ).toString('base64url');

    expect(lerToken(`${versao}.${outraCarga}.${assinatura}`, 'visita', CHAVE, AGORA)).toBeNull();
  });

  it('recusa depois do prazo', () => {
    const token = assinarToken('visita', VISITA, CHAVE);
    expect(lerToken(token, 'visita', CHAVE, VISITA.expiraEm)).toBeNull();
    expect(lerToken(token, 'visita', CHAVE, VISITA.expiraEm - 1)).toEqual(VISITA);
  });

  /*
   * O convite é o link que sai do admin; a visita é o cookie. Um convite que
   * valesse como visita pularia a conferência que a rota de entrada faz.
   */
  it('convite não serve como visita, e visita não serve como convite', () => {
    const convite = assinarToken(
      'convite',
      { ...VISITA, expiraEm: AGORA + DURACAO_DO_CONVITE_MS },
      CHAVE,
    );
    expect(lerToken(convite, 'visita', CHAVE, AGORA)).toBeNull();
    expect(lerToken(assinarToken('visita', VISITA, CHAVE), 'convite', CHAVE, AGORA)).toBeNull();
    expect(lerToken(convite, 'convite', CHAVE, AGORA)).not.toBeNull();
  });

  it('recusa prazo longo demais: um token de um ano não foi feito aqui', () => {
    const eterno = assinarToken('visita', { ...VISITA, expiraEm: AGORA + 365 * 86_400_000 }, CHAVE);
    expect(lerToken(eterno, 'visita', CHAVE, AGORA)).toBeNull();
  });

  it('recusa id que não é uuid', () => {
    const token = assinarToken('visita', { ...VISITA, orgId: "x' or '1'='1" }, CHAVE);
    expect(lerToken(token, 'visita', CHAVE, AGORA)).toBeNull();
  });

  it('recusa lixo, vazio e formato de outra versão', () => {
    for (const ruim of [undefined, null, '', 'abc', 'v1.abc', 'v2.a.b', 'v1..']) {
      expect(lerToken(ruim, 'visita', CHAVE, AGORA), String(ruim)).toBeNull();
    }
  });
});

describe('conferirMotivo', () => {
  it('exige um motivo que diga alguma coisa', () => {
    expect(conferirMotivo('').ok).toBe(false);
    expect(conferirMotivo('   ajuda  ').ok).toBe(false);
  });

  it('aceita e arruma os espaços', () => {
    expect(conferirMotivo('  Cliente não acha   o botão de publicar ')).toEqual({
      ok: true,
      motivo: 'Cliente não acha o botão de publicar',
    });
  });

  it('recusa motivo longo demais', () => {
    expect(conferirMotivo('a'.repeat(MOTIVO_MAXIMO + 1)).ok).toBe(false);
    expect(conferirMotivo('a'.repeat(MOTIVO_MAXIMO)).ok).toBe(true);
  });
});

describe('donoDoToken', () => {
  it('lê de quem é o token, para o proxy saber se o cookie é de quem está aqui', () => {
    expect(donoDoToken(assinarToken('visita', VISITA, CHAVE))).toBe(VISITA.adminId);
  });

  it('lixo não tem dono', () => {
    for (const ruim of [undefined, '', 'abc', 'v1.%%%.x', 'v1.e30.x']) {
      expect(donoDoToken(ruim), String(ruim)).toBeNull();
    }
  });
});
