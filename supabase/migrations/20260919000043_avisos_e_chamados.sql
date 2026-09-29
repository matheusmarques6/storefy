-- C16 — avisos por e-mail, por pessoa. C17 — falar com o suporte.
--
-- AVISOS POR E-MAIL
--
-- Hoje o único e-mail que o lojista recebe é o resultado da revisão da Apple
-- e do Google, e ele ia para TODO proprietário e administrador, sem escolha.
-- Numa empresa com agência, sócio e desenvolvedor, isso é ruído — e ruído vira
-- filtro de spam, que depois engole o aviso que importava. Cada pessoa escolhe,
-- em cada empresa. A tabela guarda só quem mudou o padrão (que é receber).
--
-- CHAMADOS
--
-- A C17 prevê "contato com o suporte". Um formulário que só manda e-mail seria
-- um botão morto enquanto o e-mail não estiver configurado — e, configurado,
-- a conversa ficaria espalhada em caixas de entrada que ninguém da equipe vê
-- junto. O chamado mora no banco: o lojista abre e acompanha no painel, a
-- equipe responde na tela Chamados do admin, e o e-mail é só o aviso de que
-- há resposta.

-- ------------------------------------------------------ avisos por e-mail

create table public.email_preferences (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Resultado da revisão da Apple e do Google (aprovado ou recusado).
  revisao_do_app boolean not null default true,
  -- Resposta da equipe da Storefy num chamado que a pessoa abriu.
  resposta_do_suporte boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table public.email_preferences is
  'C16: que avisos por e-mail cada pessoa quer receber, em cada empresa. Sem linha, recebe tudo.';

alter table public.email_preferences enable row level security;

-- Cada um lê e muda só a própria escolha, e só numa empresa de que faz parte.
create policy "cada um vê os próprios avisos"
  on public.email_preferences for select to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "cada um escolhe os próprios avisos"
  on public.email_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

create policy "cada um muda os próprios avisos"
  on public.email_preferences for update to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

revoke all on public.email_preferences from anon;
revoke insert, update, delete on public.email_preferences from authenticated;
grant select, insert on public.email_preferences to authenticated;
grant update (revisao_do_app, resposta_do_suporte) on public.email_preferences to authenticated;
grant all on public.email_preferences to service_role;

create trigger email_preferences_set_updated_at
  before update on public.email_preferences
  for each row execute function public.set_updated_at();

-- O aviso da revisão respeita a escolha de cada um.
create or replace function public.emails_do_build(p_id uuid)
returns table (email text, nome_da_loja text)
language sql
security definer
set search_path = ''
as $$
  select u.email::text, s.name
    from public.builds b
    join public.apps a on a.id = b.app_id
    join public.stores s on s.id = a.store_id
    join public.memberships m on m.org_id = s.org_id and m.role in ('owner', 'admin')
    join auth.users u on u.id = m.user_id
   where b.id = p_id
     and u.email is not null
     and u.email_confirmed_at is not null
     and coalesce(
       (select p.revisao_do_app from public.email_preferences p
         where p.org_id = s.org_id and p.user_id = m.user_id),
       true
     );
$$;

-- ---------------------------------------------------------------- chamados

create type public.ticket_status as enum ('aberto', 'respondido', 'fechado');
create type public.ticket_topic as enum (
  'publicacao', 'notificacoes', 'shopify', 'app', 'cobranca', 'outro'
);

create table public.support_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- A loja de que se trata, quando é de uma. Sai do chamado se a loja sair.
  store_id uuid references public.stores (id) on delete set null,
  author_id uuid references auth.users (id) on delete set null,
  assunto public.ticket_topic not null,
  titulo text not null check (char_length(btrim(titulo)) between 3 and 120),
  status public.ticket_status not null default 'aberto',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_tickets is
  'C17: chamados do lojista para a equipe da Storefy. A conversa está em support_messages.';

create index support_tickets_org_idx on public.support_tickets (org_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, updated_at desc);

create table public.support_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  -- Quem fala: a equipe da Storefy ou alguém da empresa. Gravado, e não
  -- deduzido do autor: a pessoa pode sair da equipe e a conversa não muda.
  da_equipe boolean not null,
  texto text not null check (char_length(btrim(texto)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

-- Ler: a empresa lê os próprios chamados; a equipe, todos.
create policy "a empresa e a equipe leem os chamados"
  on public.support_tickets for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

-- Abrir: qualquer pessoa da empresa, em nome próprio, e sempre "aberto".
-- A loja, se houver, tem de ser desta empresa.
create policy "a empresa abre chamados"
  on public.support_tickets for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and author_id = (select auth.uid())
    and status = 'aberto'
    and (store_id is null or exists (
      select 1 from public.stores s where s.id = store_id and s.org_id = support_tickets.org_id
    ))
  );

-- Mudar a situação: a empresa só FECHA (resolveu sozinha); a equipe, qualquer uma.
create policy "a empresa fecha o próprio chamado"
  on public.support_tickets for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id) and status = 'fechado');

create policy "a equipe muda a situação dos chamados"
  on public.support_tickets for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.support_tickets from anon;
revoke insert, update, delete on public.support_tickets from authenticated;
grant select, insert on public.support_tickets to authenticated;
grant update (status) on public.support_tickets to authenticated;
grant all on public.support_tickets to service_role;

-- As mensagens seguem o chamado.
create policy "a empresa e a equipe leem as mensagens"
  on public.support_messages for select to authenticated
  using (exists (
    select 1 from public.support_tickets t
     where t.id = ticket_id
       and (public.is_org_member(t.org_id) or public.is_platform_admin())
  ));

-- Escrever: a empresa escreve como empresa, a equipe como equipe — e ninguém
-- escreve em nome de outro.
create policy "cada lado escreve como si mesmo"
  on public.support_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.support_tickets t
       where t.id = ticket_id
         and (
           (da_equipe = false and public.is_org_member(t.org_id))
           or (da_equipe = true and public.is_platform_admin())
         )
    )
  );

revoke all on public.support_messages from anon;
revoke insert, update, delete on public.support_messages from authenticated;
grant select, insert on public.support_messages to authenticated;
grant all on public.support_messages to service_role;

-- A situação acompanha a conversa: a empresa escreveu, o chamado está com a
-- equipe ("aberto"); a equipe respondeu, está com a empresa ("respondido").
-- Escrever num chamado fechado o reabre.
create or replace function public.situacao_pela_mensagem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só quando muda: a primeira mensagem de um chamado recém-aberto não é
  -- mudança de situação, e não deve aparecer como tal na trilha.
  update public.support_tickets
     set status = case when new.da_equipe then 'respondido' else 'aberto' end::public.ticket_status
   where id = new.ticket_id
     and status <> case when new.da_equipe then 'respondido' else 'aberto' end::public.ticket_status;
  return new;
end;
$$;

revoke all on function public.situacao_pela_mensagem() from public, anon, authenticated;

create trigger support_messages_situacao
  after insert on public.support_messages
  for each row execute function public.situacao_pela_mensagem();

-- Abrir o chamado com a primeira mensagem, numa transação só: um chamado sem
-- mensagem seria uma linha que ninguém entende. SECURITY INVOKER — as duas
-- inserções passam pela RLS de quem abre.
create or replace function public.abrir_chamado(
  p_org_id uuid,
  p_assunto public.ticket_topic,
  p_titulo text,
  p_texto text,
  -- A loja de que se trata; nula quando o chamado não é de uma loja.
  p_store_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.support_tickets (org_id, store_id, author_id, assunto, titulo)
  values (p_org_id, p_store_id, (select auth.uid()), p_assunto, btrim(p_titulo))
  returning id into v_id;

  insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
  values (v_id, (select auth.uid()), false, btrim(p_texto));

  return v_id;
end;
$$;

revoke all on function public.abrir_chamado(uuid, public.ticket_topic, text, text, uuid)
  from public, anon;
grant execute on function public.abrir_chamado(uuid, public.ticket_topic, text, text, uuid)
  to authenticated;

-- Quem escreveu cada mensagem, para as duas telas. `auth.users` não é exposta;
-- esta função devolve o nome (ou e-mail) só para quem pode ler o chamado.
create or replace function public.mensagens_do_chamado(p_ticket_id uuid)
returns table (
  id uuid,
  da_equipe boolean,
  texto text,
  autor text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.support_tickets t
     where t.id = p_ticket_id
       and (public.is_org_member(t.org_id) or public.is_platform_admin())
  ) then
    raise exception 'Chamado não encontrado.' using errcode = 'P0001';
  end if;

  return query
  select
    m.id,
    m.da_equipe,
    m.texto,
    case
      -- Para o lojista, quem responde é "a equipe da Storefy", e não o
      -- e-mail pessoal de quem atendeu.
      when m.da_equipe and not public.is_platform_admin() then 'Equipe Storefy'
      else coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        u.email::text,
        'Conta excluída'
      )
    end,
    m.created_at
  from public.support_messages m
  left join auth.users u on u.id = m.author_id
  where m.ticket_id = p_ticket_id
  order by m.created_at;
end;
$$;

revoke all on function public.mensagens_do_chamado(uuid) from public, anon;
grant execute on function public.mensagens_do_chamado(uuid) to authenticated;

-- Para o aviso por e-mail: quem abriu o chamado, se ainda quer ser avisado.
-- Só service role — é quem manda o e-mail.
create or replace function public.email_do_autor_do_chamado(p_ticket_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
    from public.support_tickets t
    join auth.users u on u.id = t.author_id
   where t.id = p_ticket_id
     and u.email_confirmed_at is not null
     -- Quem saiu da empresa não recebe mais a conversa dela.
     and exists (select 1 from public.memberships m where m.org_id = t.org_id and m.user_id = u.id)
     and coalesce(
       (select p.resposta_do_suporte from public.email_preferences p
         where p.org_id = t.org_id and p.user_id = u.id),
       true
     );
$$;

revoke all on function public.email_do_autor_do_chamado(uuid) from public, anon, authenticated;
grant execute on function public.email_do_autor_do_chamado(uuid) to service_role;

-- --------------------------------------------------------------- auditoria

-- A equipe mudando a situação de um chamado é ação do admin (regra 9). O
-- TEXTO das mensagens não vai para a trilha: a conversa já é o registro.
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

create trigger support_tickets_audit
  after insert or update of status on public.support_tickets
  for each row execute function public.handle_audit();

-- ------------------------------------------------------------------- A02

-- Chamado esperando resposta é pendência da equipe: entra no "precisa de
-- você" da visão geral. O tipo de retorno mudou, e o Postgres só troca o tipo
-- de uma função apagando-a antes.
drop function public.resumo_do_admin();

create or replace function public.resumo_do_admin()
returns table (
  orgs_ativas integer,
  orgs_em_trial integer,
  trials_vencendo_7d integer,
  orgs_inadimplentes integer,
  lojas_live integer,
  lojas_em_revisao integer,
  builds_na_fila integer,
  builds_com_erro_7d integer,
  builds_rejeitados_7d integer,
  contas_dev_com_erro integer,
  chamados_esperando integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só o admin da plataforma lê o resumo.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.organizations where status = 'active')::integer,
    (select count(*) from public.organizations where status = 'trialing')::integer,
    /*
     * Trial JÁ VENCIDO não entra: ele não é mais um prazo a acompanhar, é uma
     * cobrança que falhou ou uma conta que virou `canceled`, e os dois têm
     * cartão próprio. Misturar faria "vencendo" crescer para sempre sem
     * ninguém poder fazer nada a respeito — e um número que só sobe deixa de
     * ser lido.
     */
    (select count(*) from public.organizations
      where status = 'trialing'
        and trial_ends_at is not null
        and trial_ends_at between now() and now() + interval '7 days')::integer,
    (select count(*) from public.organizations where status = 'past_due')::integer,
    (select count(*) from public.stores where status = 'live')::integer,
    (select count(*) from public.stores where status = 'in_review')::integer,
    (select count(*) from public.builds where status in ('queued', 'building'))::integer,
    (select count(*) from public.builds
      where status = 'errored' and created_at > now() - interval '7 days')::integer,
    /*
     * Rejeitado conta por `updated_at`, e não por `created_at`: o build pode
     * ter nascido há três semanas e ter sido rejeitado ontem. Por `created_at`
     * a rejeição de ontem sumiria da conta — justamente a que precisa de
     * alguém hoje.
     */
    (select count(*) from public.builds
      where status = 'rejected' and updated_at > now() - interval '7 days')::integer,
    (select count(*) from public.developer_accounts where status = 'error')::integer,
    -- Chamado com a última palavra do cliente: a vez é da equipe.
    (select count(*) from public.support_tickets where status = 'aberto')::integer;
end
$$;

comment on function public.resumo_do_admin is
  'Os números da A02. Só platform_admin; a RLS continua sendo a fronteira.';

revoke all on function public.resumo_do_admin() from public, anon;
grant execute on function public.resumo_do_admin() to authenticated;
