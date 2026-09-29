-- C16 — convites: entrar numa empresa, criar conta com o cadastro fechado e
-- entrar na equipe da Storefy.
--
-- O QUE FALTAVA
--
-- 1. A organização "pode ter vários usuários com papéis diferentes" (regra 2
--    do CLAUDE.md), e a C16 prevê "equipe (convites e papéis)" — mas não havia
--    como pôr uma segunda pessoa numa empresa. Ninguém conseguia.
--
-- 2. Com o cadastro fechado (A13), ninguém novo entrava: nem o lojista piloto
--    que a Storefy escolheu, nem um colega da equipe interna (a A11 exige que
--    a pessoa já tenha conta). E a tela de cadastro fechado mandava "entrar com
--    o e-mail do convite" sem convite existir.
--
-- 3. O cadastro fechado só valia no painel. O Auth do Supabase aceita
--    cadastro direto pela chave pública — que está no navegador de todo mundo
--    —, e o Google cria conta sem passar pela nossa ação. Fechar era sugestão.
--
-- 4. FALHA DE SEGURANÇA: a policy "owner e admin adicionam membros" deixava um
--    ADMIN inserir um vínculo com papel OWNER para qualquer conta — uma
--    segunda conta dele, por exemplo — e virar dono da empresa (excluir lojas,
--    remover o verdadeiro dono). O cabeçalho da própria migration dizia que
--    admin "não mexe em membros". Vínculo novo agora só nasce de convite.
--
-- COMO FICOU
--
-- Um convite é um link com um segredo de 256 bits. O banco guarda só o HASH:
-- quem lê a tabela (o dono, a equipe, um backup) não consegue aceitar por
-- ninguém. O link vai por e-mail quando a Resend está configurada; sem ela, o
-- painel mostra o link para copiar — nunca finge que mandou.
--
-- Três tipos:
--   `organizacao` — entrar numa empresa com um papel (admin ou membro). Quem
--                   cria é o proprietário. Dono não se convida: vira-se dono
--                   por promoção explícita, depois de entrar. Um link vazado
--                   dá, no máximo, administrador.
--   `conta`       — criar conta (com a própria empresa) mesmo com o cadastro
--                   fechado: o lojista piloto. Quem cria é a equipe.
--   `equipe`      — entrar na equipe da Storefy. Quem cria é superadmin.
--
-- Aceitar exige que o e-mail da conta seja o do convite. O convite é para uma
-- PESSOA, e não para quem estiver com o link na mão.

-- ------------------------------------------------------------------ 1. tipo

create type public.invitation_kind as enum ('organizacao', 'conta', 'equipe');

-- ---------------------------------------------------------------- 2. tabela

create table public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  kind public.invitation_kind not null,
  org_id uuid references public.organizations (id) on delete cascade,
  org_role public.membership_role,
  platform_role public.platform_admin_role,
  -- Sempre minúsculo e sem espaço: é comparado com o e-mail da conta.
  email text not null,
  -- sha256 do segredo do link, em hexadecimal. O segredo nunca é gravado.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invitations_email_normalizado check (
    email = lower(btrim(email))
    and char_length(email) <= 254
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint invitations_hash_do_segredo check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint invitations_forma_do_tipo check (
    (kind = 'organizacao' and org_id is not null and org_role is not null
       and org_role <> 'owner' and platform_role is null)
    or (kind = 'conta' and org_id is null and org_role is null and platform_role is null)
    or (kind = 'equipe' and org_id is null and org_role is null and platform_role is not null)
  ),
  constraint invitations_um_desfecho check (not (accepted_at is not null and revoked_at is not null)),
  constraint invitations_aceite_com_autor check ((accepted_at is null) = (accepted_by is null))
);

comment on table public.invitations is
  'C16/A03/A11: convites por link. Guarda o hash do segredo, nunca o segredo.';

-- Um convite em aberto por pessoa e destino. Convidar de novo é reenviar: o
-- mesmo convite ganha outro segredo e outro prazo (e o link antigo morre).
create unique index invitations_um_em_aberto
  on public.invitations (
    kind,
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    email
  )
  where accepted_at is null and revoked_at is null;

create index invitations_org_idx on public.invitations (org_id) where org_id is not null;
create index invitations_email_idx on public.invitations (email)
  where accepted_at is null and revoked_at is null;

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------- 3. superadmin

create or replace function public.is_platform_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
     where pa.user_id = (select auth.uid()) and pa.role = 'superadmin'
  );
$$;

comment on function public.is_platform_superadmin is
  'Quem pede é superadmin da plataforma? Base das policies que só superadmin passa.';

revoke all on function public.is_platform_superadmin() from public, anon;
grant execute on function public.is_platform_superadmin() to authenticated, service_role;

-- O cadastro está aberto? Mesma leitura tolerante do painel
-- (`lib/configuracoes-da-plataforma.ts`): chave ausente ou de tipo errado
-- vale o padrão, que é aberto.
create or replace function public.cadastro_aberto()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(s.valor) = 'boolean' then s.valor = 'true'::jsonb else true end
       from public.platform_settings s
      where s.chave = 'cadastro_aberto'),
    true
  );
$$;

revoke all on function public.cadastro_aberto() from public, anon, authenticated;

-- ------------------------------------------------------------------- 4. RLS

alter table public.invitations enable row level security;

-- A equipe da empresa vê quem foi convidado, como vê quem já está nela.
create policy "membros veem os convites da organização"
  on public.invitations for select to authenticated
  using (
    (kind = 'organizacao' and public.is_org_member(org_id))
    or public.is_platform_admin()
  );

-- Só o PROPRIETÁRIO convida, só para a própria empresa, em nome próprio e com
-- prazo curto. O papel `owner` já está fora pela restrição da tabela.
create policy "o proprietário convida para a empresa"
  on public.invitations for insert to authenticated
  with check (
    kind = 'organizacao'
    and public.has_org_role(org_id, array['owner']::public.membership_role[])
    and invited_by = (select auth.uid())
    and accepted_at is null
    and revoked_at is null
    and expires_at <= now() + interval '8 days'
  );

-- A equipe da Storefy convida lojistas; colegas, só superadmin.
create policy "a equipe convida lojistas e colegas"
  on public.invitations for insert to authenticated
  with check (
    (
      (kind = 'conta' and public.is_platform_admin())
      or (kind = 'equipe' and public.is_platform_superadmin())
    )
    and invited_by = (select auth.uid())
    and accepted_at is null
    and revoked_at is null
    and expires_at <= now() + interval '8 days'
  );

-- Reenviar (segredo e prazo novos) e cancelar: quem pode convidar, enquanto o
-- convite está em aberto. Aceitar NÃO passa por aqui: é `aceitar_convite`.
create policy "o proprietário reenvia e cancela"
  on public.invitations for update to authenticated
  using (
    kind = 'organizacao'
    and public.has_org_role(org_id, array['owner']::public.membership_role[])
    and accepted_at is null
    and revoked_at is null
  )
  with check (
    kind = 'organizacao'
    and public.has_org_role(org_id, array['owner']::public.membership_role[])
    and accepted_at is null
    and expires_at <= now() + interval '8 days'
  );

create policy "a equipe reenvia e cancela os da plataforma"
  on public.invitations for update to authenticated
  using (
    (
      (kind = 'conta' and public.is_platform_admin())
      or (kind = 'equipe' and public.is_platform_superadmin())
    )
    and accepted_at is null
    and revoked_at is null
  )
  with check (
    (
      (kind = 'conta' and public.is_platform_admin())
      or (kind = 'equipe' and public.is_platform_superadmin())
    )
    and accepted_at is null
    and expires_at <= now() + interval '8 days'
  );

-- Sem DELETE: o convite cancelado fica, é o registro de que existiu.
revoke all on public.invitations from anon;
revoke insert, update, delete on public.invitations from authenticated;
grant select, insert on public.invitations to authenticated;
-- Só o que reenviar e cancelar mudam. Aceite, e-mail, tipo e empresa, nunca.
grant update (token_hash, expires_at, revoked_at, org_role, platform_role, invited_by)
  on public.invitations to authenticated;
grant all on public.invitations to service_role;

-- --------------------------------------------------------- 5. auditoria

-- O convite entra na trilha da empresa (ou da plataforma, sem empresa). O
-- hash do segredo NÃO: não aceita nada sozinho, mas a trilha não é lugar de
-- material de credencial.
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

create trigger invitations_audit
  after insert or update on public.invitations
  for each row execute function public.handle_audit();

-- ------------------------------------- 6. vínculo novo só nasce de convite

drop policy "owner e admin adicionam membros" on public.memberships;
revoke insert on public.memberships from authenticated;

-- Mudar de papel continua com o proprietário (policy de UPDATE), mas só o
-- PAPEL: trocar `user_id` ou `org_id` de um vínculo era pôr outra pessoa, ou
-- levar alguém para outra empresa, sem convite nenhum.
revoke update on public.memberships from authenticated;
grant update (role) on public.memberships to authenticated;

-- Sair da empresa é de cada um, qualquer que seja o papel. O último
-- proprietário continua preso pelo `protect_last_owner`: antes de sair, ele
-- passa a propriedade para alguém.
create policy "cada um sai da empresa"
  on public.memberships for delete to authenticated
  using (user_id = (select auth.uid()));

-- --------------------------------------------- 7. o convite, visto de fora

-- O que a tela do convite precisa, para quem tem o link — logado ou não.
-- Quem não tem o link não tem o que perguntar: sem o segredo, não há linha.
create or replace function public.ver_convite(p_token text)
returns table (
  situacao text,
  tipo public.invitation_kind,
  email text,
  organizacao text,
  papel public.membership_role,
  papel_na_plataforma public.platform_admin_role,
  expira_em timestamptz,
  convidado_por text,
  ja_tem_conta boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_convite public.invitations%rowtype;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then
    return query select 'inexistente'::text, null::public.invitation_kind, null::text, null::text,
      null::public.membership_role, null::public.platform_admin_role, null::timestamptz,
      null::text, null::boolean;
    return;
  end if;

  select i.* into v_convite
    from public.invitations i
   where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not found then
    return query select 'inexistente'::text, null::public.invitation_kind, null::text, null::text,
      null::public.membership_role, null::public.platform_admin_role, null::timestamptz,
      null::text, null::boolean;
    return;
  end if;

  return query select
    case
      when v_convite.revoked_at is not null then 'cancelado'
      when v_convite.accepted_at is not null then 'usado'
      when v_convite.expires_at <= now() then 'expirado'
      else 'pendente'
    end,
    v_convite.kind,
    v_convite.email,
    (select o.name from public.organizations o where o.id = v_convite.org_id),
    v_convite.org_role,
    v_convite.platform_role,
    v_convite.expires_at,
    (select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email::text)
       from auth.users u where u.id = v_convite.invited_by),
    exists (select 1 from auth.users u where lower(u.email) = v_convite.email);
end;
$$;

comment on function public.ver_convite is
  'O convite do link: situação, empresa, papel e e-mail. Sem o segredo, nada.';

revoke all on function public.ver_convite(text) from public;
grant execute on function public.ver_convite(text) to anon, authenticated;

-- -------------------------------------------------------- 8. aceitar

-- O miolo do aceite, para o link e para a lista "convites para você". Quem
-- chama já conferiu que o convite existe; aqui se confere todo o resto, com o
-- convite travado para dois cliques não aceitarem duas vezes.
create or replace function public.consumir_convite(p_id uuid, p_uid uuid)
returns table (resultado text, tipo public.invitation_kind, organizacao uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_convite public.invitations%rowtype;
  v_email text;
  v_confirmado timestamptz;
  v_inseridos integer := 0;
begin
  select lower(u.email::text), u.email_confirmed_at into v_email, v_confirmado
    from auth.users u where u.id = p_uid;

  select i.* into v_convite from public.invitations i where i.id = p_id for update;
  if not found then
    return query select 'inexistente'::text, null::public.invitation_kind, null::uuid;
    return;
  end if;

  if v_convite.revoked_at is not null then
    return query select 'cancelado'::text, v_convite.kind, v_convite.org_id;
    return;
  end if;
  if v_convite.accepted_at is not null then
    -- O mesmo aceite duas vezes (clique duplo, voltar e reenviar) é sucesso.
    return query select
      case when v_convite.accepted_by = p_uid then 'aceito' else 'usado' end,
      v_convite.kind, v_convite.org_id;
    return;
  end if;
  if v_convite.expires_at <= now() then
    return query select 'expirado'::text, v_convite.kind, v_convite.org_id;
    return;
  end if;
  if v_email is distinct from v_convite.email then
    return query select 'outro_email'::text, v_convite.kind, v_convite.org_id;
    return;
  end if;
  if v_confirmado is null then
    return query select 'email_nao_confirmado'::text, v_convite.kind, v_convite.org_id;
    return;
  end if;

  if v_convite.kind = 'organizacao' then
    insert into public.memberships (org_id, user_id, role)
    values (v_convite.org_id, p_uid, v_convite.org_role)
    on conflict (org_id, user_id) do nothing;
    get diagnostics v_inseridos = row_count;
  elsif v_convite.kind = 'equipe' then
    insert into public.platform_admins (user_id, role)
    values (p_uid, v_convite.platform_role)
    on conflict (user_id) do nothing;
    get diagnostics v_inseridos = row_count;
    -- `platform_admins` não tem trigger de auditoria (ver A11): a linha vai à mão.
    if v_inseridos > 0 then
      insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
      values (
        p_uid, null, 'create', 'platform_admins', p_uid,
        jsonb_build_object(
          'email', v_email,
          'role', v_convite.platform_role,
          'convite', v_convite.id,
          'convidado_por', v_convite.invited_by
        )
      );
    end if;
  end if;

  update public.invitations
     set accepted_at = now(), accepted_by = p_uid
   where id = v_convite.id;

  return query select
    case when v_convite.kind = 'organizacao' and v_inseridos = 0 then 'ja_era_membro' else 'aceito' end,
    v_convite.kind,
    v_convite.org_id;
end;
$$;

revoke all on function public.consumir_convite(uuid, uuid) from public, anon, authenticated;

-- Aceitar pelo link.
create or replace function public.aceitar_convite(p_token text)
returns table (resultado text, tipo public.invitation_kind, organizacao uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'aceitar_convite: sem sessão' using errcode = 'insufficient_privilege';
  end if;

  select i.id into v_id
    from public.invitations i
   where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_id is null then
    return query select 'inexistente'::text, null::public.invitation_kind, null::uuid;
    return;
  end if;

  return query select * from public.consumir_convite(v_id, v_uid);
end;
$$;

revoke all on function public.aceitar_convite(text) from public, anon;
grant execute on function public.aceitar_convite(text) to authenticated;

-- Os convites de empresa em aberto para o e-mail de quem pergunta. É o que
-- deixa aceitar sem o link: o convite foi feito para ESTE e-mail, e a conta
-- confirmou que é dona dele.
create or replace function public.meus_convites()
returns table (
  id uuid,
  organizacao text,
  papel public.membership_role,
  convidado_por text,
  expira_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    o.name,
    i.org_role,
    (select coalesce(nullif(btrim(q.raw_user_meta_data ->> 'full_name'), ''), q.email::text)
       from auth.users q where q.id = i.invited_by),
    i.expires_at
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  join auth.users u on u.id = (select auth.uid())
  where i.kind = 'organizacao'
    and i.email = lower(u.email::text)
    and u.email_confirmed_at is not null
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc;
$$;

revoke all on function public.meus_convites() from public, anon;
grant execute on function public.meus_convites() to authenticated;

create or replace function public.aceitar_convite_por_id(p_id uuid)
returns table (resultado text, tipo public.invitation_kind, organizacao uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'aceitar_convite_por_id: sem sessão' using errcode = 'insufficient_privilege';
  end if;
  -- Só convite de EMPRESA: os da plataforma exigem o link, que é o que prova
  -- que a equipe mandou aquele convite àquela pessoa naquele momento.
  if not exists (select 1 from public.invitations i where i.id = p_id and i.kind = 'organizacao') then
    return query select 'inexistente'::text, null::public.invitation_kind, null::uuid;
    return;
  end if;
  return query select * from public.consumir_convite(p_id, v_uid);
end;
$$;

revoke all on function public.aceitar_convite_por_id(uuid) from public, anon;
grant execute on function public.aceitar_convite_por_id(uuid) to authenticated;

-- ---------------------------------------------------- 9. quem está na empresa

-- Membros com e-mail e nome, para a C16. `auth.users` não é exposta pela API
-- (guarda hash de senha e tokens); esta função devolve só o que a tela mostra,
-- e só para quem é da empresa.
create or replace function public.membros_da_organizacao(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  nome text,
  role public.membership_role,
  created_at timestamptz,
  ultimo_acesso timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_org_member(p_org_id) or public.is_platform_admin()) then
    raise exception 'Acesso restrito aos membros da empresa.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    m.user_id,
    u.email::text,
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    m.role,
    m.created_at,
    u.last_sign_in_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    m.created_at;
end;
$$;

revoke all on function public.membros_da_organizacao(uuid) from public, anon;
grant execute on function public.membros_da_organizacao(uuid) to authenticated;

-- ------------------------------------------- 10. conta sem empresa nenhuma

-- Quem saiu (ou foi tirado) da única empresa em que estava fica sem empresa.
-- Antes, o painel caía com "fale com o suporte". Agora a pessoa pode aceitar
-- um convite em aberto ou criar a própria empresa — esta, só se não tiver
-- nenhuma e o cadastro estiver aberto: com ele fechado, a Storefy escolhe
-- quem usa o produto, e uma conta antiga não fura isso.
create or replace function public.criar_minha_organizacao(p_nome text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_nome text := left(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), 120);
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'criar_minha_organizacao: sem sessão' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'Sua conta já faz parte de uma empresa.' using errcode = 'P0001';
  end if;
  if not public.cadastro_aberto() then
    raise exception 'Os cadastros estão fechados por enquanto. Peça um convite a uma empresa que já usa a Storefy.'
      using errcode = 'P0001';
  end if;
  if char_length(v_nome) < 2 then
    raise exception 'Digite o nome da empresa, com pelo menos 2 letras.' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug, status, trial_ends_at)
  values (v_nome, public.generate_org_slug(v_nome), 'trialing', now() + interval '14 days')
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role) values (v_org_id, v_uid, 'owner');

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    v_uid, v_org_id, 'create', 'organizations', v_org_id,
    jsonb_build_object('name', jsonb_build_object('de', null, 'para', v_nome))
  );

  return v_org_id;
end;
$$;

revoke all on function public.criar_minha_organizacao(text) from public, anon;
grant execute on function public.criar_minha_organizacao(text) to authenticated;

-- ------------------------------------------------ 11. a conta que nasce

-- Toda conta nova passa por aqui (e-mail, Google, API direta, painel).
--
-- Com convite (`convite` nos metadados do cadastro):
--   o convite precisa estar em aberto e ser para ESTE e-mail — senão a conta
--   não nasce. Um convite que expirou entre abrir a tela e enviar não pode
--   virar, calado, uma conta solta com empresa própria;
--   `organizacao` entra na empresa convidada e NÃO ganha empresa própria;
--   `conta` e `equipe` ganham a própria, como no cadastro normal (e `equipe`
--   entra na equipe da Storefy).
--
-- O cadastro fechado NÃO é conferido aqui, e sim no fim da transação (item
-- 12): a API admin do Auth grava o `app_metadata` numa segunda instrução,
-- depois deste gatilho, e só no COMMIT a marca da equipe já está na linha.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_org_id uuid;
  v_token text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'convite', '')), '');
  v_convite public.invitations%rowtype;
begin
  if v_token is not null then
    select i.* into v_convite
      from public.invitations i
     where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
     for update;

    if not found
       or v_convite.revoked_at is not null
       or v_convite.accepted_at is not null
       or v_convite.expires_at <= now()
       or v_convite.email is distinct from lower(new.email::text) then
      raise exception 'Este convite não vale mais, ou é para outro e-mail.'
        using errcode = 'P0001';
    end if;
  end if;

  if v_convite.id is not null and v_convite.kind = 'organizacao' then
    insert into public.memberships (org_id, user_id, role)
    values (v_convite.org_id, new.id, v_convite.org_role);

    update public.invitations
       set accepted_at = now(), accepted_by = new.id
     where id = v_convite.id;

    -- O segredo cumpriu o papel; não fica nos metadados da conta.
    update auth.users
       set raw_user_meta_data = raw_user_meta_data - 'convite'
     where id = new.id;

    return new;
  end if;

  -- O formulário de cadastro envia company_name. Sem ele, usa o nome da pessoa
  -- ou a parte local do e-mail, que é melhor do que um nome vazio e o usuário
  -- renomeia depois.
  v_nome := nullif(trim(coalesce(new.raw_user_meta_data ->> 'company_name', '')), '');
  if v_nome is null then
    v_nome := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  end if;
  if v_nome is null then
    v_nome := split_part(coalesce(new.email, 'minha-loja'), '@', 1);
  end if;
  -- O check da tabela exige 2 caracteres.
  if char_length(v_nome) < 2 then
    v_nome := v_nome || ' (minha empresa)';
  end if;
  v_nome := left(v_nome, 120);

  insert into public.organizations (name, slug, status, trial_ends_at)
  values (
    v_nome,
    public.generate_org_slug(v_nome),
    'trialing',
    now() + interval '14 days'
  )
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role)
  values (v_org_id, new.id, 'owner');

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    new.id,
    v_org_id,
    'create',
    'organizations',
    v_org_id,
    jsonb_build_object('name', jsonb_build_object('de', null, 'para', v_nome))
  );

  if v_convite.id is not null then
    if v_convite.kind = 'equipe' then
      insert into public.platform_admins (user_id, role)
      values (new.id, v_convite.platform_role)
      on conflict (user_id) do nothing;

      insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
      values (
        new.id, null, 'create', 'platform_admins', new.id,
        jsonb_build_object(
          'email', lower(new.email::text),
          'role', v_convite.platform_role,
          'convite', v_convite.id,
          'convidado_por', v_convite.invited_by
        )
      );
    end if;

    update public.invitations
       set accepted_at = now(), accepted_by = new.id
     where id = v_convite.id;

    update auth.users
       set raw_user_meta_data = raw_user_meta_data - 'convite'
     where id = new.id;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Conta nova: entra na empresa do convite, ou ganha a própria. Com o cadastro fechado, só por convite ou pela equipe.';

-- ----------------------------------------- 12. o cadastro fechado, no banco

-- Conferido no FIM da transação que cria a conta (gatilho de restrição
-- adiado), relendo a linha — e não no INSERT. O Auth cria a conta em mais de
-- uma instrução: a API admin grava o `app_metadata` depois do INSERT, e o
-- "convidar" do próprio Auth marca `invited_at` depois também. Conferir no
-- INSERT barrava a conta criada pela equipe (o `pnpm bootstrap:admin` caiu
-- exatamente assim no teste contra o Auth de verdade).
--
-- Com o cadastro fechado, a conta só nasce:
--   por convite da Storefy ou de uma empresa (aceito pelo `handle_new_user`);
--   criada pela equipe pela service role, com `criado_pela_equipe` nos
--     metadados da APLICAÇÃO — que o cadastro público não consegue escrever;
--   pelo "convidar usuário" do Auth (`invited_at`), que também é só da
--     service role e do painel do Supabase.
-- O resto — cadastro por e-mail, Google, chamada direta à API do Auth com a
-- chave pública — não nasce: a transação inteira é desfeita.
create or replace function public.conferir_cadastro_aberto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app jsonb;
  v_convidado timestamptz;
begin
  if public.cadastro_aberto() then
    return null;
  end if;

  -- A linha como está AGORA, no fim da transação — `new` é a do INSERT.
  select u.raw_app_meta_data, u.invited_at into v_app, v_convidado
    from auth.users u where u.id = new.id;
  if not found then
    return null;
  end if;

  if coalesce(v_app ->> 'criado_pela_equipe', '') = 'true'
     or v_convidado is not null
     or exists (select 1 from public.invitations i where i.accepted_by = new.id) then
    return null;
  end if;

  raise exception 'Os cadastros estão fechados por enquanto.' using errcode = 'P0001';
end;
$$;

comment on function public.conferir_cadastro_aberto is
  'Fim da transação da conta nova: com o cadastro fechado, só passa convite ou conta criada pela equipe.';

revoke all on function public.conferir_cadastro_aberto() from public, anon, authenticated;

create constraint trigger conferir_cadastro_aberto
  after insert on auth.users
  deferrable initially deferred
  for each row execute function public.conferir_cadastro_aberto();
