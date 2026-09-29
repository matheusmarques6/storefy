-- A13 — as chaves de funcionamento da plataforma.
--
-- Duas, e as duas com uso de verdade desde o primeiro dia:
--
--   `cadastro_aberto` — fecha o cadastro por e-mail. Na fase das lojas piloto,
--   a Storefy precisa escolher quem entra; sem isto, qualquer um que achasse o
--   endereço criava conta e ocupava o suporte.
--
--   `aviso_no_painel` — uma frase no topo do painel de TODOS os lojistas.
--   Manutenção programada, instabilidade da Apple, mudança de preço: hoje não
--   há como avisar ninguém a não ser por e-mail, um a um.
--
-- A tabela guarda só o que foi MUDADO. Chave ausente vale o padrão
-- (`lib/configuracoes-da-plataforma.ts`), e é por isso que não há seed: o
-- padrão mora no código, com teste, e não numa linha que alguém pode apagar.
--
-- Leitura só para a equipe. Escrita só pela service role, depois de a ação do
-- servidor conferir que quem pede é superadmin — e ela grava a auditoria.
-- Sem policy de escrita de propósito: uma policy seria uma segunda porta.

create table public.platform_settings (
  chave text primary key check (chave in ('cadastro_aberto', 'aviso_no_painel')),
  valor jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.platform_settings is
  'A13: chaves de funcionamento da plataforma. Só o que difere do padrão do código.';

alter table public.platform_settings enable row level security;

create policy "a equipe lê as chaves da plataforma"
  on public.platform_settings for select to authenticated
  using (public.is_platform_admin());

revoke all on public.platform_settings from anon;
revoke insert, update, delete on public.platform_settings from authenticated;
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();
