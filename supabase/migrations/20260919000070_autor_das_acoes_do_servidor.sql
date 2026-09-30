-- =============================================================================
-- A trilha diz quem fez também quando quem grava é o servidor
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. Parte do que o lojista faz é gravado pelo
-- servidor com a service role — a imagem e o nome do app, as contas Apple e
-- Google, a Shopify, a chave do webhook —, porque a sessão não pode escrever
-- ali (é o que impede, por exemplo, uma conta "verificada" forjada). Para a
-- trilha, a service role não tem usuário, e o gatilho gravava "o sistema"
-- no lugar de quem clicou.
--
-- Agora o servidor, que já conferiu quem pediu, declara o autor num cabeçalho
-- da requisição (`x-storefy-ator`), que o PostgREST entrega ao banco. O
-- gatilho só aceita o cabeçalho quando quem chama é a service role: com
-- sessão, vale sempre o usuário dela, e um navegador que mandasse o
-- cabeçalho não muda nada. E só um usuário que existe vira autor.
-- =============================================================================

create function public.ator_declarado()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ator text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
       <> 'service_role' then
    return null;
  end if;

  v_ator := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-storefy-ator';
  if v_ator is null
     or v_ator !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  if not exists (select 1 from auth.users u where u.id = v_ator::uuid) then
    return null;
  end if;
  return v_ator::uuid;
end;
$$;

comment on function public.ator_declarado() is
  'O autor que o servidor declarou (cabeçalho x-storefy-ator), só para a service role. Nulo nos outros casos.';

revoke all on function public.ator_declarado() from public, anon, authenticated;

-- ------------------------------------------------ o gatilho da trilha usa o autor declarado

create or replace function public.handle_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    when 'push_campaigns', 'push_automations', 'test_devices' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'automation_webhooks' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.automation_id;
      -- Nem o hash da chave vai para a trilha: basta saber que ela mudou.
      v_old := v_old - 'token_hash';
      v_new := v_new - 'token_hash';
    when 'developer_accounts' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'builds' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'ota_updates' then
      -- Ação da PLATAFORMA: não há organização a quem atribuí-la.
      v_org_id := null;
      v_entity_id := v_linha.id;
    when 'invitations' then
      -- Nulo nos convites da plataforma (lojista piloto, equipe interna).
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
      v_old := v_old - 'token_hash';
      v_new := v_new - 'token_hash';
    when 'support_tickets' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'plans' then
      -- Ação da PLATAFORMA, como a correção OTA.
      v_org_id := null;
      v_entity_id := v_linha.id;
    else
      -- Tabela nova ligada ao trigger sem tratar o org_id aqui: falhar alto é
      -- melhor do que gravar auditoria órfã, que ninguém consegue consultar.
      raise exception 'handle_audit: org_id não resolvido para a tabela %', tg_table_name;
  end case;

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    -- Quem está na sessão; sem sessão, quem o servidor declarou (`ator_declarado`).
    coalesce((select auth.uid()), public.ator_declarado()),
    v_org_id,
    v_action,
    tg_table_name,
    v_entity_id,
    public.audit_diff(v_old, v_new)
  );

  return v_linha;
end;
$function$;
