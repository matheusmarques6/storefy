-- RLS em todas as tabelas (regra 2 das inegociáveis).
--
-- Matriz de papéis usada abaixo:
--   owner  : tudo, inclusive excluir a organização e a loja e mexer em membros
--   admin  : cria e edita lojas e dados da organização; não exclui nem mexe em membros
--   member : somente leitura
--
-- O painel admin da Storefy entra por `public.is_platform_admin()`, que só é
-- verdadeiro para quem está em platform_admins.
--
-- Nenhuma policy confia em filtro vindo do front (regra 2).

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.stores enable row level security;
alter table public.apps enable row level security;
alter table public.app_configs enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------- organizations

create policy "membros leem a própria organização"
  on public.organizations for select to authenticated
  using (public.is_org_member(id) or public.is_platform_admin());

-- Organização nasce pelo trigger de cadastro (handle_new_user), que roda como
-- security definer. Não há caminho de INSERT direto pelo painel nesta fase.

create policy "owner e admin editam a organização"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.membership_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.membership_role[]));

create policy "somente owner exclui a organização"
  on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']::public.membership_role[]));

-- ------------------------------------------------------------------ memberships

create policy "membros veem quem mais está na organização"
  on public.memberships for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

create policy "owner e admin adicionam membros"
  on public.memberships for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]));

create policy "somente owner altera papéis"
  on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.membership_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.membership_role[]));

create policy "somente owner remove membros"
  on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.membership_role[]));

-- -------------------------------------------------------------- platform_admins

-- O usuário enxerga apenas a própria linha: é o que o painel precisa para saber
-- se deve oferecer o admin. A lista completa é privilégio de quem já é admin.
create policy "usuário vê o próprio registro de admin"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or public.is_platform_admin());

-- Sem INSERT, UPDATE ou DELETE por RLS: platform_admins só é escrita pelo
-- script `pnpm bootstrap:admin` e por Server Actions com service role que já
-- validaram um superadmin.

-- ----------------------------------------------------------------------- stores

create policy "membros leem as lojas da organização"
  on public.stores for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

create policy "owner e admin criam lojas"
  on public.stores for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]));

create policy "owner e admin editam lojas"
  on public.stores for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]));

create policy "somente owner exclui lojas"
  on public.stores for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.membership_role[]));

-- ------------------------------------------------------------------------- apps

create policy "membros leem os apps das lojas da organização"
  on public.apps for select to authenticated
  using (public.is_store_member(store_id) or public.is_platform_admin());

create policy "owner e admin criam apps"
  on public.apps for insert to authenticated
  with check (public.has_store_role(store_id, array['owner', 'admin']::public.membership_role[]));

create policy "owner e admin editam apps"
  on public.apps for update to authenticated
  using (public.has_store_role(store_id, array['owner', 'admin']::public.membership_role[]))
  with check (public.has_store_role(store_id, array['owner', 'admin']::public.membership_role[]));

create policy "somente owner exclui apps"
  on public.apps for delete to authenticated
  using (public.has_store_role(store_id, array['owner']::public.membership_role[]));

-- ------------------------------------------------------------------ app_configs

create policy "membros leem as configs dos apps da organização"
  on public.app_configs for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

create policy "owner e admin criam configs"
  on public.app_configs for insert to authenticated
  with check (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

create policy "owner e admin editam configs"
  on public.app_configs for update to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  )
  with check (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

create policy "somente owner exclui configs"
  on public.app_configs for delete to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner']::public.membership_role[])
    )
  );

-- ------------------------------------------------------------------ audit_logs

create policy "membros leem a auditoria da própria organização"
  on public.audit_logs for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

-- Somente-anexar: a escrita vem dos triggers de auditoria, que rodam como
-- security definer. Não existe policy de INSERT, UPDATE ou DELETE — nem para
-- owner, nem para platform admin. Uma trilha que pode ser editada não serve
-- como trilha.
