import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { revalidarCredencial, type CredencialGuardada } from '@/lib/revalidar-conta';

const AGORA = 1_800_000_000;

const P8 = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const ARQUIVO_DO_GOOGLE = JSON.stringify({
  type: 'service_account',
  client_email: 'storefy@oakvintage-123.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
});

/** "Cifra" de teste: o pacote é o próprio texto, com um prefixo. */
const abrir = (pacote: string): string => {
  if (!pacote.startsWith('cifrado:')) throw new Error('não abre');
  return pacote.slice('cifrado:'.length);
};

function apple(parcial: Partial<CredencialGuardada> = {}): CredencialGuardada {
  return {
    platform: 'apple',
    asc_key_id: 'ABC123DEFG',
    asc_issuer_id: 'aaaa-bbbb-cccc',
    asc_key_enc: `cifrado:${P8}`,
    google_service_account_enc: null,
    ...parcial,
  };
}

function google(parcial: Partial<CredencialGuardada> = {}): CredencialGuardada {
  return {
    platform: 'google',
    asc_key_id: null,
    asc_issuer_id: null,
    asc_key_enc: null,
    google_service_account_enc: `cifrado:${ARQUIVO_DO_GOOGLE}`,
    ...parcial,
  };
}

const responde = (status: number, corpo: unknown) =>
  vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(corpo), { status })),
  ) as unknown as typeof fetch;

describe('revalidarCredencial', () => {
  it('a Apple aceita: a conta é válida', async () => {
    expect(
      await revalidarCredencial(apple(), {
        abrir,
        agoraS: AGORA,
        buscador: responde(200, { data: [], meta: { paging: { total: 0 } } }),
      }),
    ).toEqual({ resultado: 'valida', observacao: null });
  });

  it('o Google aceita: válida, com o e-mail da conta de serviço à vista', async () => {
    expect(
      await revalidarCredencial(google(), {
        abrir,
        agoraS: AGORA,
        buscador: responde(200, { access_token: 'ya29.x', expires_in: 3599 }),
      }),
    ).toEqual({
      resultado: 'valida',
      observacao: 'storefy@oakvintage-123.iam.gserviceaccount.com',
    });
  });

  it('a Apple recusa a chave: inválida, com o motivo da própria Apple', async () => {
    const resultado = await revalidarCredencial(apple(), {
      abrir,
      agoraS: AGORA,
      buscador: responde(401, { errors: [{ status: '401' }] }),
    });
    expect(resultado.resultado).toBe('invalida');
  });

  /*
   * Rede caída ou a loja fora do ar não dizem nada sobre a chave. Marcar a
   * conta "com erro" faria o cliente refazer uma credencial que está boa.
   */
  it('a loja não responde (rede ou 5xx): indisponível, e nada muda', async () => {
    const semRede = vi.fn(() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    expect(
      (await revalidarCredencial(apple(), { abrir, agoraS: AGORA, buscador: semRede })).resultado,
    ).toBe('indisponivel');
    expect(
      (
        await revalidarCredencial(google(), {
          abrir,
          agoraS: AGORA,
          buscador: responde(503, { error: 'backendError' }),
        })
      ).resultado,
    ).toBe('indisponivel');
  });

  it('o que está guardado não abre, ou não é credencial: inválida, sem chamar a loja', async () => {
    const buscador = vi.fn() as unknown as typeof fetch;

    const naoAbre = await revalidarCredencial(apple({ asc_key_enc: 'lixo' }), {
      abrir,
      buscador,
    });
    expect(naoAbre).toMatchObject({ resultado: 'invalida' });
    if (naoAbre.resultado === 'invalida')
      expect(naoAbre.motivo).toContain('conectar a conta de novo');

    const naoEJson = await revalidarCredencial(
      google({ google_service_account_enc: 'cifrado:{isto não é json' }),
      { abrir, buscador },
    );
    expect(naoEJson.resultado).toBe('invalida');
    expect(buscador).not.toHaveBeenCalled();
  });

  it('sem credencial guardada, não há o que conferir', async () => {
    expect(await revalidarCredencial(apple({ asc_key_enc: null }), { abrir })).toEqual({
      resultado: 'sem_credencial',
    });
    expect(
      await revalidarCredencial(google({ google_service_account_enc: '' }), { abrir }),
    ).toEqual({ resultado: 'sem_credencial' });
  });
});
