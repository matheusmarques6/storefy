-- A12 — "quem fez o quê": o autor de cada linha da auditoria.
--
-- O DEFEITO. A trilha guardava `actor_id` desde a Fase 0, e a tela da A12
-- nunca o mostrava: era "o quê" sem "quem". O e-mail mora em `auth.users`,
-- que o painel não lê — daí esta função, no molde das outras `admin_*`: só a
-- equipe da plataforma recebe resposta, e só dos ids pedidos.
--
-- `equipe` diz se o autor é da equipe da Storefy (uma ação do suporte num
-- cliente precisa aparecer como tal, e não como se o cliente tivesse feito).
create or replace function public.admin_autores_da_auditoria(p_ids uuid[])
returns table (
  user_id uuid,
  email text,
  nome text,
  equipe boolean
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
    u.id,
    u.email::text,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    exists (select 1 from public.platform_admins p where p.user_id = u.id)
  from auth.users u
  where u.id = any (coalesce(p_ids, '{}'::uuid[]))
  limit 200;
end;
$$;

comment on function public.admin_autores_da_auditoria(uuid[]) is
  'E-mail, nome e se é da equipe, para os autores de linhas da auditoria. Só a equipe da plataforma.';

revoke all on function public.admin_autores_da_auditoria(uuid[]) from public, anon;
grant execute on function public.admin_autores_da_auditoria(uuid[]) to authenticated;
