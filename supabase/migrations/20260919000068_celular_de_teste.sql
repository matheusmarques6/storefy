-- =============================================================================
-- C08 — o envio de teste vai só para os celulares de teste do lojista
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. O envio de teste listava os dez
-- aparelhos vistos por último — clientes inclusive. Depois do lançamento, o
-- lojista não sabe qual é o dele, e "testar" mandava uma notificação ainda
-- sem revisão para o celular de um cliente.
--
-- Agora o celular de teste é PAREADO. O painel gera um código de uso único,
-- que vale 10 minutos, e o mostra num QR code: um link para o app daquela
-- loja. O lojista lê com a câmera do próprio celular, o app abre e se
-- apresenta à Storefy com o código. Só esses aparelhos aparecem no envio de
-- teste, e o lojista os remove quando quiser.
-- =============================================================================

-- ------------------------------------------------ os celulares de teste

create table public.test_devices (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  -- Como o lojista chamou o celular ("Celular da Ana"): é assim que ele se acha na lista.
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A última vez que o celular foi pareado: é por ela que o painel vê o QR dar certo.
  paired_at timestamptz not null default now(),
  unique (app_id, device_id)
);

comment on table public.test_devices is
  'Celulares que o lojista pareou para receber o envio de teste (C08). Nascem só pelo pareamento.';

create index test_devices_app_idx on public.test_devices (app_id);

alter table public.test_devices enable row level security;

create policy "membros veem os celulares de teste"
  on public.test_devices for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

create policy "owner e admin removem celulares de teste"
  on public.test_devices for delete to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

-- Nasce só pelo pareamento, que confere o código: a sessão não cria nem muda.
revoke insert, update on public.test_devices from anon, authenticated;

-- ------------------------------------------------ os códigos de pareamento

create table public.test_device_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  -- Só o hash: o código em claro existe na tela de quem o gerou, e em nenhum outro lugar.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table public.test_device_codes is
  'Códigos de uso único do pareamento do celular de teste. Sem policy: só as funções abaixo mexem aqui.';

alter table public.test_device_codes enable row level security;
revoke all on public.test_device_codes from anon, authenticated;

/*
 * O código que o painel mostra, de uso único e com 10 minutos de vida.
 *
 * Oito caracteres de um alfabeto sem os que se confundem (0 e O, 1 e I): o
 * lojista pode ter de digitá-lo, se a câmera não ler o QR. Só o proprietário e
 * o administrador geram — são eles que mandam campanha.
 */
create function public.criar_codigo_de_teste(p_app_id uuid, p_nome text)
returns table (codigo text, expira_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_codigo text := '';
  v_expira timestamptz := now() + interval '10 minutes';
  i integer;
begin
  if not exists (
    select 1 from public.apps a
     where a.id = p_app_id
       and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
  ) then
    raise exception 'Só o proprietário ou um administrador da loja adiciona celulares de teste.'
      using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_nome, ''))) not between 1 and 60 then
    raise exception 'Dê um nome ao celular, com até 60 letras.' using errcode = '22023';
  end if;
  if not public.consumir_limite('codigo-de-teste:' || p_app_id::text, 20, 600) then
    raise exception 'Muitos códigos em pouco tempo. Espere alguns minutos e tente de novo.'
      using errcode = 'P0001';
  end if;

  -- Os vencidos desta loja saem aqui, como as sessões de prévia: sem isto a tabela só cresce.
  delete from public.test_device_codes
   where app_id = p_app_id and expires_at < now();

  for i in 0..7 loop
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  insert into public.test_device_codes (app_id, code_hash, nome, created_by, expires_at)
  values (
    p_app_id,
    encode(extensions.digest(v_codigo, 'sha256'), 'hex'),
    btrim(p_nome),
    (select auth.uid()),
    v_expira
  );

  return query select v_codigo, v_expira;
end;
$$;

revoke all on function public.criar_codigo_de_teste(uuid, text) from public, anon;
grant execute on function public.criar_codigo_de_teste(uuid, text) to authenticated;

/*
 * O app, aberto pelo QR, se apresenta com o código.
 *
 * Só a service role chama — depois de a rota pública conferir a assinatura
 * do app. O aparelho precisa já existir (o app se registra ao abrir): o
 * código prova quem pediu, o aparelho prova qual celular é.
 *
 * Devolve: `pareado`, `codigo_invalido` (errado, usado ou vencido — o app não
 * precisa saber qual), `aparelho_desconhecido` ou `limitado`.
 */
create function public.parear_celular_de_teste(
  p_app_id uuid,
  p_codigo text,
  p_install_id uuid default null,
  p_subscription text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo public.test_device_codes%rowtype;
  v_aparelho uuid;
  v_org uuid;
  v_teste uuid;
  v_nome_antigo text;
begin
  -- 30 tentativas por minuto por app: o bastante para errar a digitação, pouco para adivinhar.
  if not public.consumir_limite('pareamento:' || p_app_id::text, 30, 60) then
    return 'limitado';
  end if;

  select * into v_codigo
    from public.test_device_codes c
   where c.app_id = p_app_id
     and c.code_hash = encode(extensions.digest(upper(btrim(coalesce(p_codigo, ''))), 'sha256'), 'hex')
     and c.used_at is null
     and c.expires_at > now()
   for update;
  if v_codigo.id is null then
    return 'codigo_invalido';
  end if;

  if p_subscription is not null then
    select d.id into v_aparelho from public.devices d
     where d.app_id = p_app_id and d.onesignal_subscription_id = p_subscription;
  end if;
  if v_aparelho is null and p_install_id is not null then
    select d.id into v_aparelho from public.devices d
     where d.app_id = p_app_id and d.install_id = p_install_id;
  end if;
  if v_aparelho is null then
    return 'aparelho_desconhecido';
  end if;

  update public.test_device_codes set used_at = now() where id = v_codigo.id;

  -- Parear de novo um celular que já é de teste só troca o nome dele.
  select t.nome into v_nome_antigo
    from public.test_devices t
   where t.app_id = p_app_id and t.device_id = v_aparelho;

  insert into public.test_devices (app_id, device_id, nome, created_by)
  values (p_app_id, v_aparelho, v_codigo.nome, v_codigo.created_by)
  on conflict (app_id, device_id) do update set nome = excluded.nome, paired_at = now()
  returning id into v_teste;

  /*
   * Na trilha com o nome de quem GEROU o código: quem chama aqui é o app, sem
   * sessão, e o gatilho gravaria "o sistema". O alvo é a linha do celular de
   * teste — o mesmo que a remoção grava —, para a trilha contar a história
   * inteira de um celular.
   */
  select s.org_id into v_org
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = p_app_id;
  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    v_codigo.created_by,
    v_org,
    case when v_nome_antigo is null then 'create' else 'update' end::public.audit_action,
    'test_devices',
    v_teste,
    public.audit_diff(
      case when v_nome_antigo is null then null
           else jsonb_build_object('nome', v_nome_antigo, 'device_id', v_aparelho) end,
      jsonb_build_object('nome', v_codigo.nome, 'device_id', v_aparelho)
    )
  );

  return 'pareado';
end;
$$;

revoke all on function public.parear_celular_de_teste(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.parear_celular_de_teste(uuid, text, uuid, text) to service_role;

-- Remover (pela sessão) vai para a trilha pelo gatilho de sempre.
create trigger test_devices_audit
  after delete on public.test_devices
  for each row execute function public.handle_audit();

-- ------------------------------------------------ a trilha conhece a tabela

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
    (select auth.uid()),
    v_org_id,
    v_action,
    tg_table_name,
    v_entity_id,
    public.audit_diff(v_old, v_new)
  );

  return v_linha;
end;
$function$;
