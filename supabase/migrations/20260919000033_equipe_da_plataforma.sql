/*
 * A11 — a equipe interna da Storefy, com e-mail.
 *
 * `security definer` AQUI SIM, e a razão é diferente da do `resumo_do_admin`:
 * o e-mail mora em `auth.users`, que não é nossa e não tem policy para o
 * `authenticated`. Não há RLS a respeitar — há um schema inteiro fora de
 * alcance —, então invoker simplesmente não conseguiria ler. A guarda no topo
 * é o que substitui a policy, e é a mesma de `admin_email_do_usuario`, que já
 * faz isso para um usuário por vez.
 *
 * O QUE ELA EVITA: a tela precisa de e-mail, papel e data de cada admin. Sem
 * esta função seria uma chamada de `admin_email_do_usuario` POR LINHA — cinco
 * admins, cinco idas ao banco para desenhar uma tabela de cinco linhas.
 */
create or replace function public.admin_equipe()
returns table (
  user_id uuid,
  email text,
  role public.platform_admin_role,
  created_at timestamptz
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
  select pa.user_id, u.email::text, pa.role, pa.created_at
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
   -- Superadmin antes de support, e depois por antiguidade: a ordem de
   -- declaração do enum é ('superadmin', 'support'), então ascendente já põe
   -- quem manda em cima.
   order by pa.role asc, pa.created_at asc;
end
$$;

comment on function public.admin_equipe is
  'A11: quem é da equipe Storefy, com e-mail. Só platform_admin.';

revoke all on function public.admin_equipe() from public, anon;
grant execute on function public.admin_equipe() to authenticated;

/*
 * Quantos superadmins existem além deste.
 *
 * É a trava contra o tiro no pé mais caro do produto: remover ou rebaixar o
 * último superadmin deixa a plataforma sem ninguém que possa mexer na equipe,
 * e a volta é rodar o script de bootstrap direto no banco de produção.
 *
 * Fica no BANCO, e não só na tela, porque entre a tela carregar e o clique
 * chegar outro superadmin pode ter saído — e duas abas abertas conseguem
 * remover um ao outro se a conta for feita só no JavaScript.
 */
create or replace function public.outros_superadmins(p_exceto uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.platform_admins
   where role = 'superadmin'
     and user_id is distinct from p_exceto;
$$;

comment on function public.outros_superadmins is
  'Quantos superadmins existem fora o informado. Trava contra remover o último.';

revoke all on function public.outros_superadmins(uuid) from public, anon, authenticated;
grant execute on function public.outros_superadmins(uuid) to service_role;

/*
 * O id de um usuário a partir do e-mail.
 *
 * Existe porque convidar alguém para a equipe começa por um e-mail digitado, e
 * `auth.users` está fora do alcance do `authenticated` — não há policy a
 * escrever, é outro schema. O supabase-js também não oferece busca por e-mail
 * na API de admin, só por id.
 *
 * Devolve NULL quando não existe, e não uma exceção: "essa pessoa ainda não
 * tem conta na Storefy" é uma resposta legítima da tela, não um erro. Quem
 * chama transforma isso na frase que o admin lê.
 *
 * Só service_role: é a borda entre "digitei um e-mail" e "descobri um id de
 * usuário", e ela não precisa existir para a sessão do navegador.
 */
create or replace function public.admin_usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

comment on function public.admin_usuario_por_email is
  'Id do usuário com este e-mail, ou NULL. Só service role.';

revoke all on function public.admin_usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.admin_usuario_por_email(text) to service_role;
