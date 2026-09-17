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

export type MembershipRole = Enum<'membership_role'>;
export type PlatformAdminRole = Enum<'platform_admin_role'>;
export type OrgStatus = Enum<'org_status'>;
export type StoreStatus = Enum<'store_status'>;
export type StorePlatform = Enum<'store_platform'>;
export type AppConfigStatus = Enum<'app_config_status'>;
export type AuditAction = Enum<'audit_action'>;

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

export const ROTULO_ACAO_AUDITORIA: Record<AuditAction, string> = {
  create: 'Criou',
  update: 'Editou',
  delete: 'Excluiu',
};
