-- RLS das tabelas da Fase 3, e o fechamento das colunas de segredo.
--
-- A divisão de quem escreve o quê:
--   devices, cart_events, automation_runs → só a service role, pelos endpoints
--     públicos e pelos jobs. Nenhuma policy de `authenticated` os cobre, e é
--     proposital: o app não tem sessão do painel, e o painel não tem por que
--     inventar um aparelho.
--   push_campaigns, push_automations, developer_accounts → o lojista, pelo
--     painel, com as mesmas regras de papel do resto do produto.

alter table public.devices enable row level security;
alter table public.push_campaigns enable row level security;
alter table public.push_automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.cart_events enable row level security;
alter table public.developer_accounts enable row level security;

-- ------------------------------------------------------------------ devices

create policy "membros leem os aparelhos dos apps da organização"
  on public.devices for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

-- Excluir aparelho é o que atende um pedido de exclusão de dados (LGPD).
create policy "owner e admin excluem aparelhos"
  on public.devices for delete to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

-- -------------------------------------------------------------- campanhas

create policy "membros leem as campanhas dos apps da organização"
  on public.push_campaigns for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

create policy "owner e admin criam campanhas"
  on public.push_campaigns for insert to authenticated
  with check (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

/*
 * Campanha que já saiu não volta atrás.
 *
 * Deixar editar título ou destino depois do envio faria o painel mostrar uma
 * coisa e o celular do cliente outra — e as estatísticas ficariam penduradas
 * num texto que nunca foi enviado. Quem muda `sending` para `sent` é o job,
 * pela service role, que não passa por policy.
 */
create policy "owner e admin editam campanhas não enviadas"
  on public.push_campaigns for update to authenticated
  using (
    status in ('draft', 'scheduled', 'canceled')
    and exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  )
  with check (
    status in ('draft', 'scheduled', 'canceled')
    and exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

-- Excluir o histórico do que já foi enviado apagaria a prova do que o cliente
-- recebeu. Só rascunho e cancelada saem.
create policy "owner e admin excluem campanhas não enviadas"
  on public.push_campaigns for delete to authenticated
  using (
    status in ('draft', 'canceled')
    and exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

-- -------------------------------------------------------------- automações

create policy "membros leem as automações dos apps da organização"
  on public.push_automations for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

create policy "owner e admin criam automações"
  on public.push_automations for insert to authenticated
  with check (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

create policy "owner e admin editam automações"
  on public.push_automations for update to authenticated
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

create policy "somente owner exclui automações"
  on public.push_automations for delete to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner']::public.membership_role[])
    )
  );

-- ---------------------------------------------------------- execuções

create policy "membros leem as execuções das automações da organização"
  on public.automation_runs for select to authenticated
  using (
    exists (
      select 1
      from public.push_automations p
      join public.apps a on a.id = p.app_id
      where p.id = automation_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

-- ---------------------------------------------------- eventos de carrinho

create policy "membros leem os eventos dos apps da organização"
  on public.cart_events for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

-- ------------------------------------------------ contas de desenvolvedor

create policy "owner e admin leem as contas de desenvolvedor da organização"
  on public.developer_accounts for select to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[])
    or public.is_platform_admin()
  );

create policy "owner e admin criam contas de desenvolvedor"
  on public.developer_accounts for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]));

create policy "owner e admin editam contas de desenvolvedor"
  on public.developer_accounts for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[]));

create policy "somente owner exclui contas de desenvolvedor"
  on public.developer_accounts for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.membership_role[]));

-- ============================================== colunas que nunca saem daqui
--
-- A RLS é por LINHA; segredo é problema de COLUNA. Um `select *` do painel
-- traria o texto criptografado até o navegador — e a regra 3 do CLAUDE.md diz
-- que segredo nunca chega ao client, não que ele chega embaralhado.
--
-- `revoke` na tabela e `grant` coluna a coluna é o que o Postgres oferece para
-- isso. O efeito colateral é bom: um `select *` passa a FALHAR em vez de vazar
-- em silêncio, e quem escrever a query é obrigado a listar o que precisa.

revoke select on public.stores from authenticated, anon;
grant select (
  id, org_id, name, shop_domain, primary_url, platform, shopify_scopes,
  status, created_at, updated_at
) on public.stores to authenticated;

revoke select on public.apps from authenticated, anon;
grant select (
  id, store_id, display_name, bundle_id_ios, package_android, expo_project_id,
  onesignal_app_id, ios_asc_app_id, apple_team_id, current_config_version,
  icon_path, splash_path, created_at, updated_at
) on public.apps to authenticated;

revoke select on public.developer_accounts from authenticated, anon;
grant select (
  id, org_id, platform, status, apple_team_id, asc_key_id, asc_issuer_id,
  apns_key_id, verified_at, notes, created_at, updated_at
) on public.developer_accounts to authenticated;

-- O painel precisa gravar nessas colunas, e gravar não é ler: quem escreve o
-- segredo é a Server Action que acabou de criptografá-lo.
grant insert, update on public.developer_accounts to authenticated;
