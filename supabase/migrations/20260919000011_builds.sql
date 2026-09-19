-- Os builds de cada app (seção 7 do plano).
--
-- Uma linha por tentativa de gerar o binário de uma loja para uma plataforma.
-- O que ela guarda é a TRILHA: quem mandou, de qual versão da config, o que o
-- EAS respondeu e onde parou. Sem isso, um build que falha no meio do fim de
-- semana vira um cliente perguntando "cadê meu app" sem ninguém ter o que
-- responder.

create type public.build_status as enum (
  'queued',
  'building',
  'finished',
  'errored',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'canceled'
);

comment on type public.build_status is
  'Do clique em "publicar" até a resposta da loja de aplicativos.';

create type public.build_profile as enum ('development', 'preview', 'production');

create table public.builds (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  platform public.device_platform not null,
  profile public.build_profile not null default 'production',
  status public.build_status not null default 'queued',
  -- Id do build no EAS. Nulo até o workflow conseguir criá-lo.
  eas_build_id text,
  /*
   * Versão e número do build ficam GRAVADOS aqui, e não lidos do app depois.
   * O `app.config.ts` muda com o tempo, e um build de três meses atrás
   * precisa continuar dizendo qual versão ele é — é por esse número que a
   * Apple e o lojista se entendem quando algo dá errado.
   */
  version text,
  build_number integer,
  logs_url text,
  -- Mensagem de erro em texto, para o lojista e para o suporte.
  error text,
  -- Qual versão da config entrou neste binário.
  config_version integer,
  triggered_by uuid references auth.users (id) on delete set null,
  -- Quando cada etapa aconteceu, para medir a fila e mostrar o progresso.
  started_at timestamptz,
  finished_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.builds is
  'Uma tentativa de gerar e publicar o binário de uma loja. Escrita pelos jobs.';

create trigger builds_set_updated_at
  before update on public.builds
  for each row execute function public.set_updated_at();

create index builds_app_id_idx on public.builds (app_id, created_at desc);
-- O webhook do EAS chega com o id dele e precisa achar a linha depressa.
create unique index builds_eas_build_id_key on public.builds (eas_build_id)
  where eas_build_id is not null;
-- A fila do admin (A05) e o cron de status da revisão varrem por status.
create index builds_status_idx on public.builds (status, created_at desc)
  where status in ('queued', 'building', 'submitted', 'in_review');

-- ------------------------------------------------------------------ RLS

alter table public.builds enable row level security;

create policy "membros leem os builds dos apps da organização"
  on public.builds for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
    or public.is_platform_admin()
  );

/*
 * Ninguém insere build pelo painel. Publicar é uma ação que chama uma rota do
 * servidor, que valida o checklist inteiro antes de criar a linha — deixar o
 * navegador inserir direto permitiria pular a validação e mandar para a Apple
 * um app sem ícone.
 *
 * Também não há policy de update nem de delete: o histórico de builds é a
 * trilha do que foi mandado para as lojas de aplicativos, e apagar um build
 * rejeitado é justamente o que ninguém pode fazer.
 */

comment on policy "membros leem os builds dos apps da organização" on public.builds is
  'Só leitura. Criar e atualizar é caminho de servidor, com a service role.';
