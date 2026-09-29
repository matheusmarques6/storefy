-- Réplica local do que o Supabase provê por padrão.
--
-- ESTE ARQUIVO NUNCA É APLICADO NO PROJETO SUPABASE. Ele existe só para que
-- `supabase/migrations/` rode contra um Postgres comum e a RLS possa ser
-- testada em CI sem depender de um projeto na nuvem nem de Docker.
--
-- O contrato reproduzido aqui é o mesmo que o Supabase usa em produção:
-- `auth.uid()` lê o claim `sub` de `request.jwt.claims`, que o PostgREST
-- define por request a partir do JWT.

create schema if not exists auth;
create schema if not exists extensions;

-- Papéis do PostgREST.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- service_role ignora RLS, exatamente como no Supabase.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Subconjunto de auth.users usado pelo schema da aplicação.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  -- Escrito só pelo Auth e pela service role; o cadastro público não alcança.
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  -- Marcado pelo "convidar usuário" do Auth, depois do INSERT.
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- Identidade do usuário da request. Igual à definição do Supabase — conferida
-- com `pg_get_functiondef('auth.uid'::regproc)` numa instância real: o
-- `request.jwt.claim.sub` VAZIO não conta, e a identidade cai no
-- `request.jwt.claims`. Vazio é o que sobra na sessão depois de um
-- `set_config(..., true)` terminar a transação.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

-- O JWT inteiro da request — é dele que sai o `aal` (nível de garantia da
-- sessão). Mesma definição do Supabase.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

/*
 * Subconjunto do MFA do Auth: os fatores de cada usuário e as sessões abertas.
 * A equipe da plataforma só vale como equipe com o segundo fator confirmado
 * (A01), e a redefinição dele apaga os fatores e encerra as sessões. Tipos e
 * colunas iguais aos do Supabase, só as que as nossas funções usam.
 */
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'auth' and t.typname = 'factor_type') then
    create type auth.factor_type as enum ('totp', 'webauthn', 'phone', 'recovery_code');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'auth' and t.typname = 'factor_status') then
    create type auth.factor_status as enum ('unverified', 'verified');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'auth' and t.typname = 'aal_level') then
    create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
  end if;
end
$$;

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  factor_id uuid,
  aal auth.aal_level
);

-- As migrations criam as extensões com `with schema extensions`.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

/*
 * Subconjunto do schema `storage` usado pelas migrations.
 *
 * O Supabase cria `storage.buckets`, `storage.objects` e a função
 * `storage.foldername` sozinho. Reproduzi-los aqui é o que permite testar as
 * POLICIES dos arquivos — quem pode enviar o ícone de qual loja — sem subir a
 * pilha inteira. As colunas são só as que as nossas policies leem.
 */
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * Divide o caminho do arquivo em pastas, como no Supabase: para
 * `loja-1/icone.png`, devolve {loja-1}. As policies usam o índice 1 para
 * descobrir de qual loja é o arquivo.
 */
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;


-- O Supabase concede isso automaticamente para tabelas novas do schema public.
-- A RLS é que decide o acesso de fato; sem o grant, tudo seria negado antes de
-- a policy ser avaliada, e o teste não provaria nada.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- E para funções — este é o que engana. O padrão do Postgres já dá EXECUTE ao
-- PUBLIC, então sem esta linha um `revoke ... from public` bastaria para fechar
-- uma função aqui. No Supabase não basta: o grant para anon e authenticated é
-- DIRETO, e sobrevive ao revoke do public. Sem reproduzir isso, uma função que
-- deveria ser só da service role passaria no teste local e ficaria aberta em
-- produção.
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;


/*
 * Publicação do Realtime.
 *
 * O Supabase cria `supabase_realtime` vazia em todo projeto; as migrations
 * acrescentam a ela as tabelas cuja mudança o painel acompanha ao vivo. Sem
 * este stub, a migration que acrescenta `builds` não teria onde acrescentar, e
 * o teste local passaria sem exercitar a linha que importa.
 */
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
