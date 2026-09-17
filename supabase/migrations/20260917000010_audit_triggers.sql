-- Auditoria automática de criar, editar e excluir.
--
-- POR QUE NO BANCO, E NÃO NA APLICAÇÃO: o trigger pega toda escrita, inclusive
-- as que não passam pelo painel (script de manutenção, correção manual, job).
-- Uma trilha que depende de alguém lembrar de chamá-la deixa buracos.

-- Campos que nunca entram no diff.
--   updated_at : muda em toda linha, só faz ruído
--   *_enc      : segredo criptografado; não vai para a trilha nem cifrado
create or replace function public.audit_diff(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      chave,
      jsonb_build_object('de', p_old -> chave, 'para', p_new -> chave)
    ),
    '{}'::jsonb
  )
  from (
    select chave
    from jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as chave
    where chave not in ('updated_at', 'created_at')
      and chave not like '%\_enc'
      and (p_old -> chave) is distinct from (p_new -> chave)
  ) as alteradas;
$$;

comment on function public.audit_diff is
  'Só as chaves que mudaram, no formato { campo: { de, para } }. Ignora carimbos de tempo e segredos.';

-- Grava uma linha em audit_logs para a operação corrente.
-- O org_id é resolvido por tabela, porque nem toda tabela o carrega direto.
create or replace function public.handle_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_entity_id uuid;
  v_action public.audit_action;
  v_old jsonb;
  v_new jsonb;
  v_linha record;
begin
  v_linha := coalesce(new, old);

  v_action := case tg_op
    when 'INSERT' then 'create'::public.audit_action
    when 'UPDATE' then 'update'::public.audit_action
    else 'delete'::public.audit_action
  end;

  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  case tg_table_name
    when 'organizations' then
      v_org_id := v_linha.id;
      v_entity_id := v_linha.id;
    when 'memberships' then
      v_org_id := v_linha.org_id;
      -- memberships tem chave composta; o alvo auditado é o usuário afetado.
      v_entity_id := v_linha.user_id;
    when 'stores' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'apps' then
      select s.org_id into v_org_id
      from public.stores s where s.id = v_linha.store_id;
      v_entity_id := v_linha.id;
    when 'app_configs' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    else
      -- Tabela nova ligada ao trigger sem tratar o org_id aqui: falhar alto é
      -- melhor do que gravar auditoria órfã, que ninguém consegue consultar.
      raise exception 'handle_audit: org_id não resolvido para a tabela %', tg_table_name;
  end case;

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    (select auth.uid()),
    v_org_id,
    v_action,
    tg_table_name,
    v_entity_id,
    public.audit_diff(v_old, v_new)
  );

  return v_linha;
end;
$$;

comment on function public.handle_audit is
  'Trigger AFTER de auditoria. Resolve o org_id por tabela e grava em audit_logs.';

-- A organização já é auditada na criação pelo handle_new_user; aqui entram as
-- edições e a exclusão.
create trigger organizations_audit
  after update or delete on public.organizations
  for each row execute function public.handle_audit();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function public.handle_audit();

create trigger stores_audit
  after insert or update or delete on public.stores
  for each row execute function public.handle_audit();

create trigger apps_audit
  after insert or update on public.apps
  for each row execute function public.handle_audit();

create trigger app_configs_audit
  after insert or update on public.app_configs
  for each row execute function public.handle_audit();

-- apps e app_configs não auditam DELETE: eles caem por cascade quando a loja é
-- excluída, e a exclusão da loja já fica registrada. Auditar aqui geraria três
-- linhas para um único ato do usuário.
