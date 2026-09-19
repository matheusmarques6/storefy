import 'server-only';

/**
 * As contas Apple e Google de cada organização (assistente C13 do plano).
 *
 * O app do cliente é publicado NA CONTA DELE, e não na nossa — é o que a
 * diretriz 4.2.6 da Apple exige de quem faz app a partir de um modelo. Então
 * estas credenciais são dele, guardadas por nós para automatizar o build.
 *
 * Tudo que entra aqui é criptografado antes de chegar ao banco, e as colunas
 * `_enc` são invisíveis para o painel por `grant` coluna a coluna. Nem o dono
 * da organização consegue ler de volta o que enviou — e é assim de propósito:
 * o painel não precisa mostrar uma chave privada nunca mais.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criptografar } from '@/lib/cripto';

type Client = SupabaseClient<Database>;

export type Plataforma = 'apple' | 'google';

export interface ContaNaTela {
  plataforma: Plataforma;
  status: Database['public']['Enums']['developer_account_status'];
  verificadaEm: string | null;
  /** O que o lojista reconhece, sem nada secreto. */
  identificacao: string | null;
  /** O último motivo de falha, quando houve. */
  observacao: string | null;
}

/**
 * O estado das duas contas, sem segredo nenhum.
 *
 * Lido com o client da SESSÃO: as colunas `_enc` nem são pedidas, e a RLS já
 * limita à organização do usuário.
 */
export async function contasDaOrganizacao(
  supabase: Client,
  orgId: string,
): Promise<Record<Plataforma, ContaNaTela | null>> {
  const { data } = await supabase
    .from('developer_accounts')
    .select('platform, status, verified_at, apple_team_id, asc_key_id, notes')
    .eq('org_id', orgId);

  const porPlataforma: Record<Plataforma, ContaNaTela | null> = { apple: null, google: null };

  for (const linha of data ?? []) {
    porPlataforma[linha.platform] = {
      plataforma: linha.platform,
      status: linha.status,
      verificadaEm: linha.verified_at,
      /*
       * Do lado da Apple, o Team ID é o que o lojista reconhece como "a minha
       * conta". Do lado do Google, o e-mail da conta de serviço fica em
       * `notes` quando a validação dá certo — ele não é segredo, e ver qual
       * conta está ligada evita o clássico "achei que tinha conectado a
       * outra".
       */
      identificacao: linha.platform === 'apple' ? linha.apple_team_id : null,
      observacao: linha.notes,
    };
  }

  return porPlataforma;
}

/** Guarda a chave da App Store Connect já validada. */
export async function guardarChaveDaApple(
  servico: Client,
  orgId: string,
  dados: {
    p8: string;
    keyId: string;
    issuerId: string;
    teamId: string;
    apnsP8: string;
    apnsKeyId: string;
  },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { error } = await servico.from('developer_accounts').upsert(
    {
      org_id: orgId,
      platform: 'apple',
      status: 'verified',
      verified_at: new Date().toISOString(),
      apple_team_id: dados.teamId,
      asc_key_id: dados.keyId,
      asc_issuer_id: dados.issuerId,
      asc_key_enc: criptografar(dados.p8),
      apns_key_id: dados.apnsKeyId,
      apns_key_enc: criptografar(dados.apnsP8),
      notes: null,
    },
    { onConflict: 'org_id,platform' },
  );

  return error == null ? { ok: true } : { ok: false, motivo: error.message };
}

/** Guarda a conta de serviço do Google já validada. */
export async function guardarContaDoGoogle(
  servico: Client,
  orgId: string,
  dados: { arquivo: string; email: string },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { error } = await servico.from('developer_accounts').upsert(
    {
      org_id: orgId,
      platform: 'google',
      status: 'verified',
      verified_at: new Date().toISOString(),
      google_service_account_enc: criptografar(dados.arquivo),
      // O e-mail não é segredo, e ver qual conta está ligada evita o clássico
      // "achei que tinha conectado a outra".
      notes: dados.email,
    },
    { onConflict: 'org_id,platform' },
  );

  return error == null ? { ok: true } : { ok: false, motivo: error.message };
}

/**
 * Registra que a validação falhou.
 *
 * Guardar o erro é o que permite ao suporte ajudar sem pedir para o lojista
 * repetir tudo. NENHUMA credencial é gravada quando a validação falha: um
 * arquivo que não funciona não tem por que ficar no nosso banco.
 */
export async function registrarFalha(
  servico: Client,
  orgId: string,
  plataforma: Plataforma,
  motivo: string,
): Promise<void> {
  await servico.from('developer_accounts').upsert(
    {
      org_id: orgId,
      platform: plataforma,
      status: 'error',
      notes: motivo,
      verified_at: null,
    },
    { onConflict: 'org_id,platform' },
  );
}

/** Desconecta uma conta, apagando as credenciais guardadas. */
export async function desconectar(
  servico: Client,
  orgId: string,
  plataforma: Plataforma,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  /*
   * Apaga as credenciais e volta o status para `pending`, em vez de remover a
   * linha: o histórico de auditoria aponta para este id, e apagar a linha
   * deixaria a trilha apontando para o vazio.
   */
  const { error } = await servico
    .from('developer_accounts')
    .update({
      status: 'pending',
      verified_at: null,
      asc_key_enc: null,
      apns_key_enc: null,
      google_service_account_enc: null,
      notes: null,
    })
    .eq('org_id', orgId)
    .eq('platform', plataforma);

  return error == null ? { ok: true } : { ok: false, motivo: error.message };
}
