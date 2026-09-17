-- Funções de apoio da RLS.
--
-- POR QUE `security definer`: uma policy em `memberships` que consulte
-- `memberships` reentra na própria policy e o Postgres aborta com recursão
-- infinita. Estas funções rodam com o dono da função, fora da RLS, quebrando o
-- ciclo. São o único lugar do schema autorizado a fazer isso.
--
-- POR QUE `set search_path = ''`: sem isso, um schema malicioso no search_path
-- do chamador poderia sequestrar os nomes de tabela dentro de uma função
-- `security definer` e escalar privilégio. Todos os nomes abaixo são
-- qualificados.
--
-- POR QUE `stable`: o resultado não muda dentro da mesma query, então o
-- planejador chama uma vez por linha avaliada em vez de recalcular sempre.

-- O usuário atual é da equipe Storefy?
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

comment on function public.is_platform_admin is
  'True se o usuário autenticado pertence a platform_admins.';

-- O usuário atual participa desta organização, com qualquer papel?
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function public.is_org_member is
  'True se o usuário autenticado é membro da organização informada.';

-- O usuário atual tem um dos papéis informados nesta organização?
create or replace function public.has_org_role(
  p_org_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

comment on function public.has_org_role is
  'True se o usuário autenticado tem um dos papéis informados na organização.';

-- Todas as organizações do usuário atual. Usado em cláusulas IN.
create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m
  where m.user_id = (select auth.uid());
$$;

comment on function public.current_org_ids is
  'Organizações às quais o usuário autenticado pertence.';

-- A loja informada pertence a uma organização do usuário atual?
create or replace function public.is_store_member(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.memberships m on m.org_id = s.org_id
    where s.id = p_store_id
      and m.user_id = (select auth.uid())
  );
$$;

comment on function public.is_store_member is
  'True se o usuário autenticado é membro da organização dona da loja.';

-- O usuário atual tem um dos papéis na organização dona desta loja?
create or replace function public.has_store_role(
  p_store_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.memberships m on m.org_id = s.org_id
    where s.id = p_store_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

comment on function public.has_store_role is
  'True se o usuário tem um dos papéis na organização dona da loja.';

-- Estas funções são chamadas de dentro das policies, então precisam estar
-- disponíveis para os papéis autenticado e anônimo.
grant execute on function public.is_platform_admin() to authenticated, anon;
grant execute on function public.is_org_member(uuid) to authenticated, anon;
grant execute on function public.has_org_role(uuid, public.membership_role[]) to authenticated, anon;
grant execute on function public.current_org_ids() to authenticated, anon;
grant execute on function public.is_store_member(uuid) to authenticated, anon;
grant execute on function public.has_store_role(uuid, public.membership_role[]) to authenticated, anon;
