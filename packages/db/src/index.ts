/**
 * Tipos do banco e atalhos de leitura.
 *
 * `database.types.ts` é gerado por `pnpm db:types` e não deve ser editado.
 * Este arquivo dá nomes curtos ao que o resto do código usa todo dia.
 */
export type { Database, Json } from './database.types';

import type { Database } from './database.types';

type Public = Database['public'];
type Tabelas = Public['Tables'];

/** Linha lida do banco. */
export type Row<T extends keyof Tabelas> = Tabelas[T]['Row'];
/** Payload de inserção (campos com default são opcionais). */
export type Insert<T extends keyof Tabelas> = Tabelas[T]['Insert'];
/** Payload de atualização (todos os campos opcionais). */
export type Update<T extends keyof Tabelas> = Tabelas[T]['Update'];
/** Valor de um enum do banco. */
export type Enum<T extends keyof Public['Enums']> = Public['Enums'][T];

export type Organization = Row<'organizations'>;
export type Membership = Row<'memberships'>;
export type PlatformAdmin = Row<'platform_admins'>;
export type Store = Row<'stores'>;
export type App = Row<'apps'>;
export type AppConfigRow = Row<'app_configs'>;
export type AuditLog = Row<'audit_logs'>;
export type Device = Row<'devices'>;
export type PushCampaign = Row<'push_campaigns'>;
export type PushAutomation = Row<'push_automations'>;
export type AutomationRun = Row<'automation_runs'>;
export type CartEvent = Row<'cart_events'>;
export type DeveloperAccount = Row<'developer_accounts'>;

/**
 * Colunas de segredo, que o navegador nunca vê.
 *
 * O banco revoga a leitura delas para `authenticated` (migration
 * `20260919000005_rls_push.sql`): RLS é por linha, e segredo é problema de
 * coluna. Um `select *` no painel passa a FALHAR em vez de vazar em silêncio,
 * e estes tipos existem para o TypeScript dizer o mesmo antes de a query sair.
 */
export type SemSegredos<T> = Omit<T, `${string}_enc`>;

/** Loja como o painel a enxerga: tudo menos o token da Shopify. */
export type LojaVisivel = SemSegredos<Store>;
/** App como o painel o enxerga: tudo menos a chave do OneSignal. */
export type AppVisivel = SemSegredos<App>;
/** Conta de desenvolvedor sem as chaves Apple e Google. */
export type ContaDeDesenvolvedorVisivel = SemSegredos<DeveloperAccount>;

/**
 * As colunas de `stores` que o painel pode pedir.
 *
 * COLUNA NOVA PRECISA ENTRAR AQUI, senão `LojaVisivel` passa a exigir um campo
 * que a query não traz e o TypeScript reclama na hora — que é exatamente o
 * aviso que se quer. A exceção são as `_enc`: `SemSegredos` as tira do tipo, e
 * o banco as tira do `grant`.
 */
export const COLUNAS_DA_LOJA =
  'id, org_id, name, shop_domain, primary_url, platform, shopify_scopes, shopify_conexao, shopify_client_id, shopify_token_expires_at, status, timezone, support_email, created_at, updated_at' as const;

/** As colunas de `apps` que o painel pode pedir. */
export const COLUNAS_DO_APP =
  'id, store_id, display_name, bundle_id_ios, package_android, expo_project_id, onesignal_app_id, ios_asc_app_id, apple_team_id, current_config_version, icon_path, splash_path, created_at, updated_at' as const;

export type MembershipRole = Enum<'membership_role'>;
export type PlatformAdminRole = Enum<'platform_admin_role'>;
export type OrgStatus = Enum<'org_status'>;
export type StoreStatus = Enum<'store_status'>;
export type StorePlatform = Enum<'store_platform'>;
export type AppConfigStatus = Enum<'app_config_status'>;
export type AuditAction = Enum<'audit_action'>;
export type BuildStatus = Enum<'build_status'>;
export type DevicePlatform = Enum<'device_platform'>;
export type PushCampaignStatus = Enum<'push_campaign_status'>;
export type PushAutomationType = Enum<'push_automation_type'>;
export type AutomationRunStatus = Enum<'automation_run_status'>;
export type CartEventType = Enum<'cart_event_type'>;
export type DeveloperPlatform = Enum<'developer_platform'>;
export type DeveloperAccountStatus = Enum<'developer_account_status'>;

/**
 * Papéis autorizados a criar e editar lojas e dados da organização.
 * Espelha a matriz das policies em `supabase/migrations/*_rls_policies.sql`.
 * Mudou aqui, mude lá — e vice-versa; os testes de RLS cobrem a versão do banco.
 */
export const PAPEIS_DE_ESCRITA: readonly MembershipRole[] = ['owner', 'admin'];

/** Papéis autorizados a excluir loja ou organização e a mexer em membros. */
export const PAPEIS_DE_DONO: readonly MembershipRole[] = ['owner'];

export function podeEscrever(papel: MembershipRole | null | undefined): boolean {
  return papel != null && PAPEIS_DE_ESCRITA.includes(papel);
}

export function podeExcluir(papel: MembershipRole | null | undefined): boolean {
  return papel != null && PAPEIS_DE_DONO.includes(papel);
}

/** Rótulos em pt-BR para exibir na interface. */
export const ROTULO_PAPEL: Record<MembershipRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
};

export const ROTULO_STATUS_LOJA: Record<StoreStatus, string> = {
  draft: 'Rascunho',
  building: 'Gerando app',
  in_review: 'Em revisão',
  live: 'No ar',
  paused: 'Pausada',
};

export const ROTULO_STATUS_ORG: Record<OrgStatus, string> = {
  trialing: 'Em teste',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada',
};

/**
 * O status de um build, em palavras que o lojista entende.
 *
 * Mora aqui, e não na tela, porque duas telas mostram os mesmos nove estados:
 * a publicação do cliente (C12) e a fila do admin (A05). Duas cópias divergem
 * na primeira vez que alguém renomear um estado só de um lado — e aí o suporte
 * e o cliente passam a falar de "Falhou" e "Com erro" achando que são coisas
 * diferentes.
 */
export const ROTULO_STATUS_BUILD: Record<BuildStatus, string> = {
  queued: 'Na fila',
  building: 'Gerando',
  finished: 'Gerado',
  errored: 'Falhou',
  submitted: 'Enviado para a loja',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  canceled: 'Cancelado',
};

export const ROTULO_ACAO_AUDITORIA: Record<AuditAction, string> = {
  create: 'Criou',
  update: 'Editou',
  delete: 'Excluiu',
};
