-- A01: a equipe da plataforma entra com dois fatores.
--
-- Quem é da equipe enxerga TODOS os clientes. Uma senha vazada não pode virar
-- esse acesso: a tela (lib/contexto.ts) manda quem entrou só com a senha para
-- /admin/verificar — ou para /admin/ativar-2fa, se ainda não cadastrou o app
-- autenticador —, e esta migration põe a MESMA trava no banco.
--
-- Por que no banco também: a chave anônima está no navegador de todo mundo,
-- e a sessão de quem entrou só com a senha é um JWT válido. Sem a trava aqui,
-- essa sessão chamaria a API do Supabase direto, e cada policy que termina em
-- `or is_platform_admin()` abriria os dados de todos os clientes — a tela
-- guardada não serviria de nada. O nível da sessão vem no próprio JWT
-- (`aal`), assinado pelo Auth: `aal2` só existe depois do segundo fator.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.platform_admins pa
       where pa.user_id = (select auth.uid())
     );
$$;

comment on function public.is_platform_admin is
  'True se o usuário autenticado pertence a platform_admins E confirmou o segundo fator (sessão aal2).';

/*
 * A11 mostra quem da equipe já tem o segundo fator. É o que diz ao superadmin
 * se a pessoa que perdeu o celular tem o que redefinir, e quem ainda vai
 * cadastrar o app no próximo acesso.
 */
drop function public.admin_equipe();

create function public.admin_equipe()
returns table (
  user_id uuid,
  email text,
  role public.platform_admin_role,
  created_at timestamptz,
  segundo_fator boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select pa.user_id, u.email::text, pa.role, pa.created_at,
         exists (
           select 1 from auth.mfa_factors f
            where f.user_id = pa.user_id and f.status = 'verified'
         )
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
   -- Superadmin antes de support, e depois por antiguidade: a ordem de
   -- declaração do enum é ('superadmin', 'support'), então ascendente já põe
   -- quem manda em cima.
   order by pa.role asc, pa.created_at asc;
end
$$;

comment on function public.admin_equipe is
  'A11: quem é da equipe Storefy, com e-mail e se já tem o segundo fator. Só platform_admin.';

revoke all on function public.admin_equipe() from public, anon;
grant execute on function public.admin_equipe() to authenticated;

/*
 * Redefinir o segundo fator de alguém da equipe — o caminho de volta de quem
 * perdeu o celular.
 *
 * Só service_role: quem chama é a ação da A11, que já conferiu a sessão de
 * quem pediu. As regras moram AQUI, e não só na tela: só superadmin redefine,
 * ninguém redefine o próprio (quem está logado com o segundo fator não perdeu
 * nada; quem perdeu não chega até aqui), e só quem é da equipe e tem o que
 * redefinir.
 *
 * Apaga os fatores E encerra as sessões da pessoa, numa transação só. Os
 * fatores sozinhos deixariam aberta a sessão de quem estiver com o celular
 * perdido na mão; as sessões sozinhas não adiantam, porque o fator continuaria
 * valendo. A auditoria vai junto, com quem fez.
 */
create or replace function public.admin_redefinir_segundo_fator(p_ator uuid, p_alvo uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel public.platform_admin_role;
  v_fatores integer;
  v_sessoes integer;
begin
  select pa.role into v_papel from public.platform_admins pa where pa.user_id = p_ator;
  if v_papel is distinct from 'superadmin' then
    raise exception 'Só um superadmin redefine a verificação em duas etapas de alguém.'
      using errcode = 'P0001';
  end if;

  if p_ator = p_alvo then
    raise exception 'Você não pode redefinir a sua própria verificação. Peça a outro superadmin.'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.platform_admins pa where pa.user_id = p_alvo) then
    raise exception 'Essa pessoa não está mais na equipe.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = p_alvo and f.status = 'verified'
  ) then
    raise exception 'Essa pessoa ainda não ativou a verificação em duas etapas.'
      using errcode = 'P0001';
  end if;

  delete from auth.mfa_factors f where f.user_id = p_alvo;
  get diagnostics v_fatores = row_count;

  delete from auth.sessions s where s.user_id = p_alvo;
  get diagnostics v_sessoes = row_count;

  -- `org_id` nulo, como toda mudança na equipe: não pertence a cliente nenhum.
  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    p_ator, null, 'update', 'platform_admins', p_alvo,
    jsonb_build_object(
      'segundo_fator', 'redefinido',
      'fatores_removidos', v_fatores,
      'sessoes_encerradas', v_sessoes
    )
  );

  return v_fatores;
end;
$$;

comment on function public.admin_redefinir_segundo_fator(uuid, uuid) is
  'A11: apaga os fatores e encerra as sessões de alguém da equipe, com auditoria. Só service_role.';

revoke all on function public.admin_redefinir_segundo_fator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_redefinir_segundo_fator(uuid, uuid) to service_role;
