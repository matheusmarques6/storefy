-- O batimento de cada rotina automática (Fase 8).
--
-- Os quatro jobs do Vercel Cron — mandar o push, buscar as estatísticas,
-- acompanhar a revisão das lojas de aplicativos e consolidar os números —
-- falham em silêncio: se o cron para, nenhuma tela quebra; as campanhas
-- agendadas simplesmente não saem, e o lojista descobre pelo cliente. Cada
-- execução deixa aqui quando deu certo e quando falhou, e a página de status e
-- a A13 leem daqui.
--
-- Escrita só pelo servidor (o job, com a service role). A equipe lê tudo,
-- inclusive o erro; o público lê só as datas, por uma função que não expõe o
-- texto do erro — que pode citar tabela, loja ou chave.

create table public.job_heartbeats (
  job text primary key
    check (job in ('dispatch-push', 'push-stats', 'review-status', 'analytics')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  -- Desde quando falha sem parar: nulo quando a última execução deu certo. É
  -- o que separa "falhou agora, a próxima tenta" de "falha há horas".
  failing_since timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  last_duration_ms integer check (last_duration_ms is null or last_duration_ms >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.job_heartbeats is
  'Última execução certa e errada de cada job do cron. Só o servidor grava.';

alter table public.job_heartbeats enable row level security;

create policy "a equipe da plataforma lê os batimentos"
  on public.job_heartbeats for select to authenticated
  using (public.is_platform_admin());

revoke insert, update, delete on public.job_heartbeats from anon, authenticated;
-- O anônimo nem chega à política: a página pública usa `batimentos_publicos`.
revoke select on public.job_heartbeats from anon;

create or replace function public.registrar_batimento(
  p_job text,
  p_ok boolean,
  p_duracao_ms integer default null,
  p_erro text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_heartbeats as b (
    job, last_success_at, last_failure_at, failing_since, last_error, last_duration_ms,
    updated_at
  )
  values (
    p_job,
    case when p_ok then now() end,
    case when p_ok then null else now() end,
    case when p_ok then null else now() end,
    case when p_ok then null else left(btrim(coalesce(p_erro, 'Falhou sem detalhe.')), 500) end,
    p_duracao_ms,
    now()
  )
  on conflict (job) do update
     set last_success_at = case when p_ok then now() else b.last_success_at end,
         last_failure_at = case when p_ok then b.last_failure_at else now() end,
         failing_since = case when p_ok then null else coalesce(b.failing_since, now()) end,
         -- O erro fica como registro da última falha, mesmo depois de um
         -- sucesso: quem investiga quer saber o que aconteceu da última vez.
         last_error = case
           when p_ok then b.last_error
           else left(btrim(coalesce(p_erro, 'Falhou sem detalhe.')), 500)
         end,
         last_duration_ms = coalesce(p_duracao_ms, b.last_duration_ms),
         updated_at = now();
end;
$$;

comment on function public.registrar_batimento(text, boolean, integer, text) is
  'Anota uma execução de job do cron. Só service role.';

revoke all on function public.registrar_batimento(text, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.registrar_batimento(text, boolean, integer, text)
  to service_role;

-- Para a página pública de status: só as datas, nunca o texto do erro.
create or replace function public.batimentos_publicos()
returns table (
  job text, ultimo_sucesso timestamptz, ultima_falha timestamptz, falhando_desde timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select job, last_success_at, last_failure_at, failing_since from public.job_heartbeats;
$$;

comment on function public.batimentos_publicos() is
  'As datas de cada job, sem o erro, para a página pública de status.';

revoke all on function public.batimentos_publicos() from public;
grant execute on function public.batimentos_publicos() to anon, authenticated, service_role;
