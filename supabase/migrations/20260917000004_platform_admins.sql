-- Equipe interna da Storefy. Quem está aqui acessa o painel admin; ninguém mais.
-- Esta tabela nunca é escrita pelo painel do cliente: só pelo script
-- `pnpm bootstrap:admin` e por Server Actions que já validaram um superadmin.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_admin_role not null default 'support',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'Funcionários da Storefy com acesso ao painel admin (admin.* / /admin).';

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function public.set_updated_at();
