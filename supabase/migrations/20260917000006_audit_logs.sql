-- Trilha de auditoria: quem fez o quê, quando e o que mudou.
-- Regra 9 do CLAUDE.md e regra 3 das inegociáveis.

create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Null quando a ação partiu de um job do servidor sem usuário associado.
  actor_id uuid references auth.users (id) on delete set null,
  org_id uuid references public.organizations (id) on delete cascade,
  action public.audit_action not null,
  -- Nome da tabela afetada, ex.: 'stores'.
  entity text not null,
  entity_id uuid,
  -- Só os campos que mudaram: { campo: { de: ..., para: ... } }.
  diff jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Somente-anexar. Ninguém edita nem apaga: a trilha perde o valor se for mutável.';

create index audit_logs_org_id_created_at_idx
  on public.audit_logs (org_id, created_at desc);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
