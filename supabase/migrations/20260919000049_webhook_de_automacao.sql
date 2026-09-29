-- O webhook de automação (C09 e C14): Klaviyo, Omnisend, n8n, Zapier.
--
-- A loja já tem os fluxos de e-mail dela montados em outra ferramenta. O
-- webhook deixa esses fluxos mandarem também um push pelo app: a ferramenta
-- chama um endereço da Storefy com uma chave, dizendo QUEM (o id do cliente
-- na Shopify, ou o e-mail) e, se quiser, o texto; a Storefy acha os aparelhos
-- desse cliente e agenda o envio pela automação `custom_webhook`, que já
-- existia no enum desde a migration 4 — sem ninguém que a chamasse.
--
-- A CHAVE: gerada no servidor, mostrada uma vez, guardada só como sha256 numa
-- tabela à parte — ninguém do painel lê o hash, nem quem pode ver o resto.
-- Trocar a chave desfaz a anterior na hora.

-- ------------------------------------------------------------ a chave

create table public.automation_webhooks (
  automation_id uuid primary key references public.push_automations (id) on delete cascade,
  app_id uuid not null references public.apps (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Os últimos caracteres da chave: é o que deixa o lojista saber QUAL está
  -- valendo sem ela aparecer de novo.
  token_hint text not null check (char_length(token_hint) = 4),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_received_at timestamptz,
  received_count integer not null default 0 check (received_count >= 0)
);

comment on table public.automation_webhooks is
  'A chave do webhook de automação de cada app (só o hash). Só o servidor grava.';

alter table public.automation_webhooks enable row level security;

create policy "membros veem a chave do webhook dos apps da organização"
  on public.automation_webhooks for select to authenticated
  using (
    exists (
      select 1 from public.apps a
       where a.id = automation_webhooks.app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

-- Só as colunas que a tela mostra. O hash não sai do servidor.
revoke all on public.automation_webhooks from anon, authenticated;
grant select (automation_id, app_id, token_hint, created_by, created_at, last_received_at, received_count)
  on public.automation_webhooks to authenticated;

-- ----------------------------------------- o texto de cada envio, opcional

-- O webhook pode mandar o próprio título e texto (o do fluxo do Klaviyo); sem
-- eles, vale o da automação. Os mesmos limites de uma campanha.
alter table public.automation_runs
  add column title text check (title is null or char_length(title) between 1 and 120),
  add column body text check (body is null or char_length(body) between 1 and 400);

-- O id do evento da ferramenta (`webhook:<id>`) vale uma vez por aparelho. O
-- Klaviyo reenvia quando a resposta demora, e a segunda entrega pode chegar
-- antes de a primeira terminar: só o índice único segura as duas.
create unique index automation_runs_webhook_uma_vez
  on public.automation_runs (automation_id, device_id, trigger_ref)
  where trigger_ref like 'webhook:%';

-- --------------------------------------------------- auditoria da chave

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
$$;

-- Criar, trocar e desativar a chave ficam na trilha; cada aviso recebido
-- (`last_received_at`) não — seriam centenas de linhas por dia sem história.
create trigger automation_webhooks_audit
  after insert or delete or update of token_hash on public.automation_webhooks
  for each row execute function public.handle_audit();

-- --------------------------------------------- gerar e desativar a chave

/*
 * Chamadas pelo servidor, com a service role, DEPOIS de a ação conferir que
 * quem pediu é proprietário ou administrador da loja. `p_ator` credita a
 * pessoa na trilha: sem ele, a auditoria diria que ninguém trocou a chave.
 */
create or replace function public.definir_chave_do_webhook(
  p_automacao uuid,
  p_ator uuid,
  p_hash text,
  p_dica text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
begin
  select pa.app_id into v_app
    from public.push_automations pa
   where pa.id = p_automacao and pa.type = 'custom_webhook';
  if v_app is null then
    raise exception 'automação de webhook não encontrada' using errcode = 'P0002';
  end if;

  perform set_config('request.jwt.claim.sub', p_ator::text, true);

  insert into public.automation_webhooks as w (
    automation_id, app_id, token_hash, token_hint, created_by
  )
  values (p_automacao, v_app, p_hash, p_dica, p_ator)
  on conflict (automation_id) do update
     set token_hash = excluded.token_hash,
         token_hint = excluded.token_hint,
         created_by = excluded.created_by,
         created_at = now(),
         -- Chave nova, contagem nova: o "último recebido" era da anterior.
         last_received_at = null,
         received_count = 0;
end;
$$;

create or replace function public.remover_chave_do_webhook(p_automacao uuid, p_ator uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removidas integer;
begin
  perform set_config('request.jwt.claim.sub', p_ator::text, true);
  delete from public.automation_webhooks where automation_id = p_automacao;
  get diagnostics v_removidas = row_count;
  return v_removidas > 0;
end;
$$;

-- ------------------------------------------------------ receber e agendar

/** A automação da chave, para a rota decidir (e achar a loja, pelo e-mail). */
create or replace function public.ler_webhook_de_automacao(p_token_hash text)
returns table (automacao uuid, app_id uuid, store_id uuid, primary_url text, ligada boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select w.automation_id, w.app_id, a.store_id, s.primary_url, pa.enabled
    from public.automation_webhooks w
    join public.push_automations pa on pa.id = w.automation_id
    join public.apps a on a.id = w.app_id
    join public.stores s on s.id = a.store_id
   where w.token_hash = p_token_hash
     and pa.type = 'custom_webhook';
$$;

/*
 * Agenda o envio para os aparelhos dos clientes. Devolve quantos agendou.
 *
 * Sempre anota a chegada (é o "último aviso recebido" da tela), mesmo com a
 * automação desligada — é assim que o lojista descobre que a ferramenta está
 * chamando e a automação é que está parada.
 *
 * `p_ref` é o id do evento na ferramenta: a mesma entrega repetida (o Klaviyo
 * reenvia quando não recebe resposta a tempo) não vira dois pushes.
 */
create or replace function public.agendar_pelo_webhook(
  p_automacao uuid,
  p_clientes text[],
  p_titulo text default null,
  p_corpo text default null,
  p_link text default null,
  p_ref text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pa public.push_automations%rowtype;
  v_fuso text;
  v_ref text := case
    when p_ref is null or btrim(p_ref) = '' then 'webhook'
    else 'webhook:' || left(btrim(p_ref), 100)
  end;
  v_quantos integer := 0;
begin
  select * into v_pa
    from public.push_automations
   where id = p_automacao and type = 'custom_webhook';
  if v_pa.id is null then
    return 0;
  end if;

  update public.automation_webhooks
     set last_received_at = now(), received_count = received_count + 1
   where automation_id = p_automacao;

  if not v_pa.enabled then
    return 0;
  end if;

  select coalesce(s.timezone, 'America/Sao_Paulo') into v_fuso
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = v_pa.app_id;

  insert into public.automation_runs (
    automation_id, device_id, trigger_ref, scheduled_for, deep_link, title, body
  )
  select v_pa.id,
         aparelho.id,
         v_ref,
         public.fora_do_silencio(now() + make_interval(mins => v_pa.delay_minutes), v_fuso),
         nullif(btrim(coalesce(p_link, '')), ''),
         nullif(btrim(coalesce(p_titulo, '')), ''),
         nullif(btrim(coalesce(p_corpo, '')), '')
    from (
      -- Os aparelhos DESTE app de cada cliente — e poucos POR CLIENTE: um
      -- cliente com vinte celulares é engano, e não motivo para vinte pushes.
      -- O teto é de cada um, e não da chamada: com 50 clientes na mesma
      -- chamada, os últimos não podem ficar sem aviso.
      select por_cliente.id
        from (
          select d.id,
                 row_number() over (
                   partition by d.external_id order by d.last_seen_at desc
                 ) as ordem
            from public.devices d
           where d.app_id = v_pa.app_id
             and d.external_id = any (p_clientes)
        ) por_cliente
       where por_cliente.ordem <= 10
    ) aparelho
  -- Com `p_ref`, a mesma entrega repetida não agenda de novo — nem quando as
  -- duas chegam ao mesmo tempo, porque quem decide é o índice único.
  on conflict (automation_id, device_id, trigger_ref) where trigger_ref like 'webhook:%'
  do nothing;

  get diagnostics v_quantos = row_count;
  return v_quantos;
end;
$$;

revoke all on function public.definir_chave_do_webhook(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.remover_chave_do_webhook(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ler_webhook_de_automacao(text) from public, anon, authenticated;
revoke all on function public.agendar_pelo_webhook(uuid, text[], text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.definir_chave_do_webhook(uuid, uuid, text, text) to service_role;
grant execute on function public.remover_chave_do_webhook(uuid, uuid) to service_role;
grant execute on function public.ler_webhook_de_automacao(text) to service_role;
grant execute on function public.agendar_pelo_webhook(uuid, text[], text, text, text, text)
  to service_role;

-- --------------------------------- o despacho usa o texto do envio, se houver

create or replace function public.reservar_envios_de_automacao(p_limite integer default 100)
returns table (
  id uuid,
  automation_id uuid,
  app_id uuid,
  subscription_id text,
  title text,
  body text,
  deep_link text,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Fora do silêncio antes de reservar: quem cair na madrugada é adiado e nem
  -- entra na leva deste minuto.
  update public.automation_runs r
     set scheduled_for = public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo'))
    from public.push_automations pa
    join public.apps a on a.id = pa.app_id
    join public.stores s on s.id = a.store_id
   where r.automation_id = pa.id
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo')) > now();

  -- Carrinho abandonado para quem já recebeu um nas últimas 24 horas: cancela
  -- em vez de enviar. O cliente não precisa de dois lembretes por dia.
  update public.automation_runs r
     set status = 'canceled', canceled_reason = 'já recebeu um push de carrinho hoje'
    from public.push_automations pa
   where r.automation_id = pa.id
     and pa.type = 'abandoned_cart'
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and exists (
       select 1 from public.automation_runs outro
        where outro.device_id = r.device_id
          and outro.id <> r.id
          and outro.status = 'sent'
          and outro.sent_at > now() - interval '24 hours'
     );

  -- Quem voltou ao app depois de agendado o aviso de inatividade não está
  -- mais inativo: "sentimos sua falta" para quem abriu o app hoje é ruído.
  update public.automation_runs r
     set status = 'canceled', canceled_reason = 'voltou a abrir o app'
    from public.push_automations pa
   where r.automation_id = pa.id
     and pa.type = 'inactive_7d'
     and r.status = 'scheduled'
     and r.trigger_ref like 'inativo:%'
     and exists (
       select 1 from public.device_days dd
        where dd.device_id = r.device_id
          and dd.day > substr(r.trigger_ref, 9)::date
     );

  return query
  with reservados as (
    update public.automation_runs r
       set claimed_at = now()
     where r.id in (
       select r2.id
         from public.automation_runs r2
         join public.push_automations pa on pa.id = r2.automation_id
        where r2.status = 'scheduled'
          and r2.claimed_at is null
          and r2.scheduled_for <= now()
          -- Automação desligada no meio do caminho não dispara o que ficou.
          and pa.enabled
        order by r2.scheduled_for
        limit greatest(coalesce(p_limite, 100), 1)
        for update skip locked
     )
    returning r.id, r.automation_id, r.device_id, r.deep_link, r.title, r.body
  )
  select res.id, res.automation_id, pa.app_id, d.onesignal_subscription_id,
         -- O texto DO ENVIO vence o da automação: é o que o fluxo do Klaviyo
         -- mandou para aquele cliente.
         coalesce(res.title, pa.title),
         coalesce(res.body, pa.body),
         -- O link DO ENVIO vence o da automação: é ele que leva ao produto
         -- que o cliente pediu para acompanhar.
         coalesce(res.deep_link, pa.deep_link),
         a.onesignal_app_id, a.onesignal_api_key_enc
    from reservados res
    join public.push_automations pa on pa.id = res.automation_id
    join public.devices d on d.id = res.device_id
    join public.apps a on a.id = pa.app_id;
end;
$$;

comment on function public.reservar_envios_de_automacao is
  'Reserva os envios vencidos, adiando os da madrugada e cancelando os repetidos e os de quem voltou.';
