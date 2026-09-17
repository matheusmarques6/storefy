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
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- Identidade do usuário da request. Igual à definição do Supabase.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
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

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- As migrations criam as extensões com `with schema extensions`.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- O Supabase concede isso automaticamente para tabelas novas do schema public.
-- A RLS é que decide o acesso de fato; sem o grant, tudo seria negado antes de
-- a policy ser avaliada, e o teste não provaria nada.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
