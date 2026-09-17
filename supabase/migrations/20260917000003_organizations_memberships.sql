-- Núcleo multi-tenant: toda linha do produto pendura, direta ou indiretamente,
-- em uma organização (regra 2 do CLAUDE.md).

-- Mantém updated_at coerente sem depender da aplicação.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger BEFORE UPDATE: carimba updated_at no servidor.';

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  -- Identificador legível e único, derivado do nome. Usado em URLs e suporte.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  plan text not null default 'trial',
  status public.org_status not null default 'trialing',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Cliente da Storefy. Uma organização tem várias lojas e vários usuários.';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table public.memberships is
  'Liga um usuário a uma organização com um papel. Base de toda a RLS.';

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

-- Busca "minhas organizações" (roda em toda request do painel).
create index memberships_user_id_idx on public.memberships (user_id);

-- Toda organização precisa de pelo menos um owner. O índice parcial torna a
-- verificação barata na hora de rebaixar ou remover um membro.
create index memberships_org_owner_idx
  on public.memberships (org_id)
  where role = 'owner';
