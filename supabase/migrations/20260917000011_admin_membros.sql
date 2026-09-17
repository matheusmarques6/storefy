-- Membros de uma organização, com e-mail, para o painel admin.
--
-- POR QUE UMA FUNÇÃO: `auth.users` não é exposta pela API do PostgREST, e com
-- razão — ela guarda hashes de senha e tokens. Esta função devolve só o que a
-- tela A04 precisa (e-mail, papel, datas) e checa `is_platform_admin()` antes
-- de devolver qualquer linha.
--
-- Isso evita usar a service role para uma leitura: a service role ignora toda a
-- RLS, e um bug de rota exporia o banco inteiro. Aqui, o pior caso é vazar
-- e-mail de membro para quem já é admin da plataforma.
create or replace function public.admin_membros_da_org(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role public.membership_role,
  created_at timestamptz,
  ultimo_acesso timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    m.role,
    m.created_at,
    u.last_sign_in_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    m.created_at;
end;
$$;

comment on function public.admin_membros_da_org is
  'Membros da organização com e-mail. Só responde para quem está em platform_admins.';

revoke all on function public.admin_membros_da_org(uuid) from public, anon;
grant execute on function public.admin_membros_da_org(uuid) to authenticated;

-- Autor de uma linha de auditoria, para a tela A12 mostrar quem fez o quê.
create or replace function public.admin_email_do_usuario(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  return v_email;
end;
$$;

comment on function public.admin_email_do_usuario is
  'E-mail de um usuário. Só responde para quem está em platform_admins.';

revoke all on function public.admin_email_do_usuario(uuid) from public, anon;
grant execute on function public.admin_email_do_usuario(uuid) to authenticated;
