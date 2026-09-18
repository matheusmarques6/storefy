-- Correção: exclusão de conta e de organização estavam bloqueadas.
--
-- O QUE QUEBRAVA
--
-- `protect_last_owner` existe para impedir que alguém remova o último owner de
-- uma organização e a deixe órfã. Mas ele não distinguia essa remoção
-- deliberada de uma exclusão em cascata, e as duas chegam ao mesmo trigger:
--
--   delete from auth.users      -> cascade em memberships -> trigger dispara
--   delete from organizations   -> cascade em memberships -> trigger dispara
--
-- Resultado: ninguém conseguia excluir a própria conta (o que a LGPD exige que
-- seja possível), nem excluir uma organização. A limpeza dos testes E2E, que
-- remove os usuários criados, também falhava.
--
-- A CORREÇÃO
--
-- Numa cascata, a linha-pai já foi removida quando o trigger roda. Então basta
-- perguntar se o usuário ou a organização ainda existem: se não existem, é
-- cascata e deve passar; se existem, é remoção deliberada e a regra vale.

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

  if tg_op = 'DELETE' then
    -- Cascata a partir de auth.users: a conta está sendo excluída.
    if not exists (select 1 from auth.users u where u.id = old.user_id) then
      return old;
    end if;
    -- Cascata a partir de organizations: a organização inteira está saindo.
    if not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;
    end if;
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
  'Impede remover ou rebaixar o último owner. Deixa passar exclusão em cascata de conta ou de organização.';

-- Quando a conta do último owner é excluída, a organização não pode ficar sem
-- dono. Se ainda houver gente nela, o membro mais antigo assume (admin antes de
-- member). Se não houver mais ninguém, a organização sai junto — deixá-la
-- vazia e inacessível só acumularia lixo.
create or replace function public.reassign_or_drop_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restantes integer;
  v_owners integer;
  v_sucessor uuid;
begin
  -- Organização já removida (cascata dela própria): nada a fazer.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;

  select count(*) into v_restantes
  from public.memberships m where m.org_id = old.org_id;

  if v_restantes = 0 then
    delete from public.organizations where id = old.org_id;
    return old;
  end if;

  select count(*) into v_owners
  from public.memberships m where m.org_id = old.org_id and m.role = 'owner';

  if v_owners = 0 then
    select m.user_id into v_sucessor
    from public.memberships m
    where m.org_id = old.org_id
    order by case m.role when 'admin' then 0 else 1 end, m.created_at
    limit 1;

    update public.memberships
    set role = 'owner'
    where org_id = old.org_id and user_id = v_sucessor;
  end if;

  return old;
end;
$$;

comment on function public.reassign_or_drop_org is
  'Após sair um membro: promove um sucessor se a organização ficou sem owner, ou a remove se ficou vazia.';

create trigger memberships_reassign_or_drop_org
  after delete on public.memberships
  for each row execute function public.reassign_or_drop_org();

revoke all on function public.reassign_or_drop_org() from public, anon, authenticated;

-- ------------------------------------------------------------------------
-- A trilha de auditoria precisa sobreviver ao que ela audita.
--
-- `audit_logs.org_id` tinha `on delete cascade` para `organizations`. Duas
-- consequências, ambas ruins:
--
--   1. Excluir uma organização apagava toda a trilha dela. Justamente o
--      registro que alguém iria querer consultar depois.
--   2. O trigger AFTER DELETE tentava gravar "organização excluída" referindo
--      uma linha que já não existia, e a FK recusava. Na prática, nenhuma
--      organização podia ser excluída.
--
-- A coluna continua, indexada, mas sem chave estrangeira: aqui ela é um
-- registro histórico, não um vínculo vivo. O nome da organização fica no
-- `diff` da linha de exclusão, então a trilha continua legível depois que a
-- organização some.
--
-- Quem enxerga o quê não muda: a policy usa `is_org_member(org_id)`, que é
-- falso para organização inexistente, e `is_platform_admin()`. Ou seja, linha
-- de organização excluída fica visível só para a equipe da Storefy — que é
-- exatamente quem precisa investigar depois.

alter table public.audit_logs
  drop constraint if exists audit_logs_org_id_fkey;

comment on column public.audit_logs.org_id is
  'Organização à qual a ação pertence. Sem FK de propósito: a trilha sobrevive à exclusão da organização.';
