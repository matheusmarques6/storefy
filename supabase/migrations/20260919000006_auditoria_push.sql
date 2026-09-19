-- Auditoria das tabelas novas (regra 9 do CLAUDE.md).
--
-- `handle_audit` resolve o `org_id` por tabela e ESTOURA quando encontra uma
-- que não conhece — de propósito, para uma tabela nova ligada ao trigger não
-- gravar auditoria órfã, que ninguém consegue consultar depois. Ligar as
-- tabelas da Fase 3 exige ensiná-la a resolver cada uma.

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
    when 'push_campaigns', 'push_automations' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'developer_accounts' then
      v_org_id := v_linha.org_id;
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

create trigger push_campaigns_audit
  after insert or update or delete on public.push_campaigns
  for each row execute function public.handle_audit();

create trigger push_automations_audit
  after insert or update or delete on public.push_automations
  for each row execute function public.handle_audit();

-- Conta de desenvolvedor guarda as chaves que publicam o app do cliente nas
-- lojas. Toda mudança ali tem que deixar rastro.
create trigger developer_accounts_audit
  after insert or update or delete on public.developer_accounts
  for each row execute function public.handle_audit();

/*
 * `devices`, `cart_events` e `automation_runs` NÃO são auditados.
 *
 * Eles são escritos pelo app, em volume: um app com dez mil clientes gera
 * dezenas de milhares de linhas por dia. Auditar isso encheria `audit_logs` de
 * ruído e esconderia o que ela existe para mostrar — o que uma PESSOA fez.
 */

/*
 * O segredo já está fora do diff.
 *
 * `audit_diff`, da Fase 0, descarta toda chave terminada em `_enc` antes de
 * montar o registro — conferido ao ligar `developer_accounts` aqui, que é a
 * primeira tabela com chave de verdade dentro. Nada a mudar.
 */
