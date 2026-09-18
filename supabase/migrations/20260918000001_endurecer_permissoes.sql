-- Endurecimento das permissões de função, apontado pelo linter do Supabase.
--
-- O PostgreSQL concede EXECUTE a PUBLIC em toda função nova. No Supabase, isso
-- significa que qualquer função do schema `public` vira um endpoint em
-- `/rest/v1/rpc/<nome>` — inclusive as que só existem para rodar como trigger.
-- Nenhuma delas deveria ser chamável de fora.
--
-- Verificado no Postgres local antes de aplicar: revogar EXECUTE de uma função
-- de trigger NÃO impede o trigger de disparar. O privilégio é checado na
-- criação do trigger, não a cada execução. Cadastro, criação de app,
-- auditoria e leitura com RLS seguiram funcionando com tudo revogado.

-- ----------------------------------------------------------------- morta

-- `current_org_ids()` foi escrita para ser usada em cláusulas IN, mas as
-- policies acabaram usando `is_org_member()`. Nenhuma policy nem linha de
-- código a chama. Função `security definer` sem uso é superfície de ataque de
-- graça, então sai.
drop function if exists public.current_org_ids();

-- ------------------------------------------------- funções só de trigger

-- Estas rodam como trigger e nada mais. Ninguém precisa poder chamá-las.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_new_store() from public, anon, authenticated;
revoke all on function public.handle_audit() from public, anon, authenticated;
revoke all on function public.protect_last_owner() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- Chamada apenas por handle_new_user. Exposta, deixaria qualquer um enumerar
-- os slugs existentes pelo sufixo que a função devolve.
revoke all on function public.generate_org_slug(text) from public, anon, authenticated;

-- Auxiliar puro do trigger de auditoria.
revoke all on function public.audit_diff(jsonb, jsonb) from public, anon, authenticated;

-- ------------------------------------------------- auxiliares das policies

-- Precisam continuar disponíveis para `authenticated`: a policy é avaliada com
-- o papel de quem consulta, então sem EXECUTE toda query falharia.
--
-- Para `anon`, não: todas as policies são `to authenticated`, então nunca são
-- avaliadas em request anônima. Mantê-las abertas só daria a um visitante um
-- endpoint para sondar ids de organização e de loja.
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, public.membership_role[]) from public, anon;
revoke all on function public.is_store_member(uuid) from public, anon;
revoke all on function public.has_store_role(uuid, public.membership_role[]) from public, anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.membership_role[]) to authenticated;
grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.has_store_role(uuid, public.membership_role[]) to authenticated;

-- As funções `admin_*` continuam abertas para `authenticated`, e isso é
-- intencional: é assim que o painel admin as chama. A autorização está dentro
-- delas, que levantam `insufficient_privilege` para quem não está em
-- platform_admins — com teste de RLS provando.

-- ---------------------------------------------------------------- índice

-- `app_configs.published_by` referencia auth.users sem índice de cobertura.
-- Sem ele, excluir um usuário faz varredura sequencial em app_configs para
-- validar a FK, o que piora conforme a tabela cresce.
create index if not exists app_configs_published_by_idx
  on public.app_configs (published_by)
  where published_by is not null;
