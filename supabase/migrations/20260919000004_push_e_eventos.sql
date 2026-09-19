-- Push, devices e eventos de carrinho (seção 6 do plano, Fase 3).
--
-- Três famílias de dado entram aqui:
--   devices e cart_events  — escritos pelo APP, por endpoint público;
--   push_campaigns e push_automations — escritos pelo LOJISTA, no painel;
--   automation_runs        — escritos pelo sistema, nos jobs.
--
-- A RLS reflete isso: o painel nunca insere device nem evento, e o app nunca
-- enxerga campanha. O que o app manda entra pela service role, num endpoint que
-- valida assinatura — nenhuma policy de `authenticated` cobre aquele caminho, e
-- é assim de propósito.

create type public.device_platform as enum ('ios', 'android');

create type public.push_campaign_status as enum (
  'draft', 'scheduled', 'sending', 'sent', 'failed', 'canceled'
);

create type public.push_automation_type as enum (
  'welcome', 'abandoned_cart', 'back_in_stock', 'order_shipped',
  'inactive_7d', 'custom_webhook'
);

create type public.automation_run_status as enum ('scheduled', 'sent', 'canceled', 'failed');

create type public.cart_event_type as enum ('add', 'update', 'checkout_started', 'purchased');

create type public.developer_platform as enum ('apple', 'google');

create type public.developer_account_status as enum ('pending', 'invited', 'verified', 'error');

-- ------------------------------------------------------------------ devices

create table public.devices (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  -- Id da inscrição no OneSignal. É o que identifica o aparelho para enviar.
  onesignal_subscription_id text not null,
  platform public.device_platform not null,
  app_version text,
  -- `customerId` da loja, quando o cliente faz login. Vira externalId no push.
  external_id text,
  -- Hash do e-mail. O e-mail em claro nunca entra aqui (regra 3 do CLAUDE.md).
  customer_email_hash text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.devices is
  'Aparelho com o app instalado. Escrito pelo endpoint público /api/public/devices.';
comment on column public.devices.customer_email_hash is
  'Hash do e-mail, nunca o e-mail. Usado para casar o cliente sem guardar o dado.';

-- O mesmo aparelho reabrindo o app não vira uma linha nova.
create unique index devices_app_subscription_key
  on public.devices (app_id, onesignal_subscription_id);
create index devices_app_id_idx on public.devices (app_id);
create index devices_external_id_idx on public.devices (app_id, external_id)
  where external_id is not null;
create index devices_last_seen_idx on public.devices (app_id, last_seen_at desc);

-- -------------------------------------------------------------- campanhas

create table public.push_campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 400),
  image_path text,
  -- Caminho na loja que o toque abre, ex.: '/products/jaqueta'.
  deep_link text,
  -- Filtros que viram `filters` da API do OneSignal na hora do envio.
  segment jsonb not null default '{}'::jsonb,
  status public.push_campaign_status not null default 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  onesignal_notification_id text,
  -- Entregues, abertos e falhas, preenchidos pelo job de estatísticas.
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Agendada sem horário seria uma campanha que nunca sai, sem ninguém notar.
  constraint push_campaigns_agendada_tem_horario
    check (status <> 'scheduled' or scheduled_at is not null)
);

comment on table public.push_campaigns is
  'Campanha de push criada no painel. O job de dispatch envia as vencidas.';

create trigger push_campaigns_set_updated_at
  before update on public.push_campaigns
  for each row execute function public.set_updated_at();

create index push_campaigns_app_id_idx on public.push_campaigns (app_id, created_at desc);
-- O job de dispatch varre por aqui a cada minuto: índice parcial, só o que interessa.
create index push_campaigns_a_enviar_idx
  on public.push_campaigns (scheduled_at)
  where status = 'scheduled';

-- -------------------------------------------------------------- automações

create table public.push_automations (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  type public.push_automation_type not null,
  enabled boolean not null default false,
  -- Espera entre o gatilho e o envio. 60 minutos é o padrão do carrinho.
  delay_minutes integer not null default 60 check (delay_minutes between 0 and 10080),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 400),
  deep_link text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Duas automações do mesmo tipo disputariam o mesmo gatilho.
  unique (app_id, type)
);

comment on table public.push_automations is
  'Automação de push por tipo de gatilho. Uma por tipo, por app.';

create trigger push_automations_set_updated_at
  before update on public.push_automations
  for each row execute function public.set_updated_at();

create index push_automations_app_id_idx on public.push_automations (app_id);

-- ---------------------------------------------------------- execuções

create table public.automation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  automation_id uuid not null references public.push_automations (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  -- O que disparou: token do carrinho, id do pedido, o que fizer sentido.
  trigger_ref text,
  status public.automation_run_status not null default 'scheduled',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  canceled_reason text,
  created_at timestamptz not null default now()
);

comment on table public.automation_runs is
  'Um envio agendado por uma automação. O job cancela quando o gatilho perde sentido.';

-- O job pega o que venceu; índice parcial pelo mesmo motivo do de campanhas.
create index automation_runs_a_enviar_idx
  on public.automation_runs (scheduled_for)
  where status = 'scheduled';
create index automation_runs_device_idx on public.automation_runs (device_id, created_at desc);
-- Cancelar o carrinho abandonado quando a compra acontece é uma busca por
-- `trigger_ref`; sem índice, ela varreria a tabela inteira a cada pedido.
create index automation_runs_trigger_idx on public.automation_runs (automation_id, trigger_ref)
  where trigger_ref is not null;

-- ---------------------------------------------------- eventos de carrinho

create table public.cart_events (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  cart_token text,
  item_count integer not null check (item_count >= 0),
  value_cents integer check (value_cents >= 0),
  currency text check (currency is null or char_length(currency) = 3),
  event public.cart_event_type not null,
  created_at timestamptz not null default now()
);

comment on table public.cart_events is
  'Histórico de carrinho vindo do app. Alimenta o carrinho abandonado e a atribuição.';

create index cart_events_app_id_idx on public.cart_events (app_id, created_at desc);
create index cart_events_device_idx on public.cart_events (device_id, created_at desc);
create index cart_events_cart_token_idx on public.cart_events (app_id, cart_token)
  where cart_token is not null;

-- ------------------------------------------------ contas de desenvolvedor

create table public.developer_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  platform public.developer_platform not null,
  status public.developer_account_status not null default 'pending',
  apple_team_id text,
  asc_key_id text,
  asc_issuer_id text,
  -- Criptografados na aplicação. As colunas `_enc` são revogadas abaixo.
  asc_key_enc text,
  apns_key_id text,
  apns_key_enc text,
  google_service_account_enc text,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform)
);

comment on table public.developer_accounts is
  'Credenciais Apple e Google da organização. O app é publicado na conta DELA (diretriz 4.2.6).';

create trigger developer_accounts_set_updated_at
  before update on public.developer_accounts
  for each row execute function public.set_updated_at();

create index developer_accounts_org_id_idx on public.developer_accounts (org_id);
