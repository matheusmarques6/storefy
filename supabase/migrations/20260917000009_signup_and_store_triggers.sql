-- Automatismos do cadastro e da criação de loja.

-- Transforma um nome livre em slug único: "Convertfy Ltda." -> "convertfy-ltda".
-- Em colisão, acrescenta sufixo numérico ("convertfy-ltda-2").
create or replace function public.generate_org_slug(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 1;
begin
  v_base := lower(extensions.unaccent(coalesce(p_name, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := left(v_base, 40);
  v_base := trim(both '-' from v_base);

  -- Nome só de símbolos, ou vazio: cai para um slug aleatório em vez de falhar.
  if v_base = '' then
    v_base := 'org-' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8);
  end if;

  v_slug := v_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;

  return v_slug;
end;
$$;

comment on function public.generate_org_slug is
  'Slug único a partir de um nome livre, com sufixo numérico em caso de colisão.';

-- Todo usuário novo ganha a própria organização e entra nela como owner.
-- É o que garante que o painel nunca encontre um usuário sem tenant (regra 2).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_org_id uuid;
begin
  -- O formulário de cadastro envia company_name. Sem ele, usa a parte local do
  -- e-mail, que é melhor do que um nome vazio e o usuário renomeia depois.
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

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Cria a organização do usuário recém-cadastrado e o registra como owner.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Toda loja nasce com o registro de app correspondente (1:1 nesta fase), para
-- que a Fase 2 encontre tudo pronto e o painel nunca lide com loja sem app.
create or replace function public.handle_new_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.apps (store_id, display_name)
  values (new.id, new.name);
  return new;
end;
$$;

comment on function public.handle_new_store is
  'Cria o registro em apps assim que uma loja é criada.';

create trigger on_store_created
  after insert on public.stores
  for each row execute function public.handle_new_store();

-- Uma organização sem owner fica órfã: ninguém mais consegue excluí-la nem
-- gerir membros. Bloqueia a remoção ou o rebaixamento do último owner.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owners integer;
begin
  -- Só interessa quando a linha afetada era de um owner e deixa de ser.
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  select count(*) into v_owners
  from public.memberships m
  where m.org_id = old.org_id and m.role = 'owner';

  if v_owners <= 1 then
    raise exception 'A organização precisa de pelo menos um owner.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.protect_last_owner is
  'Impede remover ou rebaixar o último owner de uma organização.';

create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function public.protect_last_owner();
