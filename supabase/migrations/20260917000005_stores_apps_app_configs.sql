-- Lojas e o app gerado para cada uma.

create table public.stores (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  -- Domínio da loja sem esquema, ex.: 'minha-loja.myshopify.com'.
  shop_domain text,
  -- URL pública que a WebView abre, ex.: 'https://minha-loja.com.br'.
  primary_url text not null check (primary_url ~* '^https?://[^\s/$.?#].[^\s]*$'),
  platform public.store_platform not null default 'shopify',
  -- Criptografado na aplicação (AES-GCM com ENCRYPTION_KEY). Nunca vai ao browser.
  shopify_access_token_enc text,
  shopify_scopes text[],
  status public.store_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stores is
  'Loja de um cliente. Uma organização pode ter várias.';
comment on column public.stores.shopify_access_token_enc is
  'Token criptografado. Só o servidor descriptografa; nunca é exposto ao client.';

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

create index stores_org_id_idx on public.stores (org_id);
create index stores_status_idx on public.stores (status);
-- A busca do admin filtra por nome e domínio.
create index stores_name_trgm_idx on public.stores (lower(name));

-- Uma organização não pode ter duas lojas com a mesma URL.
create unique index stores_org_primary_url_key
  on public.stores (org_id, lower(primary_url));

create table public.apps (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  display_name text not null,
  bundle_id_ios text,
  package_android text,
  expo_project_id text,
  onesignal_app_id text,
  onesignal_api_key_enc text,
  ios_asc_app_id text,
  apple_team_id text,
  -- Versão de app_configs publicada no momento. Null enquanto nada foi publicado.
  current_config_version integer,
  icon_path text,
  splash_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apps is
  'App gerado para uma loja. Relação 1:1 com stores nesta fase.';

create trigger apps_set_updated_at
  before update on public.apps
  for each row execute function public.set_updated_at();

create table public.app_configs (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  version integer not null check (version > 0),
  -- Valida contra AppConfigSchema (packages/config-schema) antes de gravar.
  config jsonb not null,
  status public.app_config_status not null default 'draft',
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, version)
);

comment on table public.app_configs is
  'Histórico versionado da AppConfig. Permite comparar e restaurar (C06f).';

create trigger app_configs_set_updated_at
  before update on public.app_configs
  for each row execute function public.set_updated_at();

create index app_configs_app_id_version_idx
  on public.app_configs (app_id, version desc);

-- Só uma versão publicada por app de cada vez.
create unique index app_configs_one_published_per_app
  on public.app_configs (app_id)
  where status = 'published';
