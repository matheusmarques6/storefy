-- Enums do domínio. Concentrados aqui para que uma mudança de valor seja uma
-- migration isolada e fácil de revisar.

-- Papel do usuário dentro de uma organização.
--   owner  : controle total, inclusive excluir a org e a loja, e gerir membros
--   admin  : cria e edita lojas, edita dados da org, convida members
--   member : somente leitura
create type public.membership_role as enum ('owner', 'admin', 'member');

-- Papel do funcionário da Storefy no painel admin.
create type public.platform_admin_role as enum ('superadmin', 'support');

-- Ciclo de vida da organização (assinatura).
create type public.org_status as enum ('trialing', 'active', 'past_due', 'canceled');

-- Ciclo de vida da loja, do rascunho até o app publicado.
create type public.store_status as enum ('draft', 'building', 'in_review', 'live', 'paused');

-- Plataforma de e-commerce da loja.
create type public.store_platform as enum ('shopify', 'other');

-- Estado de uma versão de configuração do app.
create type public.app_config_status as enum ('draft', 'published');

-- Operação registrada em audit_logs.
create type public.audit_action as enum ('create', 'update', 'delete');
