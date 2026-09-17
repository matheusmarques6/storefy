-- Testes de RLS.
--
-- Provam as três garantias exigidas no escopo da Fase 0:
--   1. o usuário da org A não lê nem escreve dados da org B;
--   2. um member não faz ações restritas a owner;
--   3. um usuário comum não acessa o admin.
--
-- Rodam com `set role authenticated`, porque superusuário e dono da tabela
-- ignoram RLS — sem a troca de papel o teste passaria sem provar nada.

\set ON_ERROR_STOP on

truncate tests.resultados restart identity;

-- Cada asserção devolve uma linha vazia; só o relatório final interessa.
\o /dev/null

-- ============================================================ fixture
-- Criado como superusuário (equivale à service role, que ignora RLS).
-- O trigger on_auth_user_created dá a cada usuário a própria organização.

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('a-owner@teste.local',  '{"company_name":"Org A"}'::jsonb,        now()),
  ('b-owner@teste.local',  '{"company_name":"Org B"}'::jsonb,        now()),
  ('a-admin@teste.local',  '{"company_name":"Pessoal Admin"}'::jsonb, now()),
  ('a-member@teste.local', '{"company_name":"Pessoal Member"}'::jsonb, now()),
  ('equipe@teste.local',   '{"company_name":"Equipe Storefy"}'::jsonb, now()),
  ('forasteiro@teste.local', '{"company_name":"Forasteiro"}'::jsonb,  now());

drop table if exists tests.ids;
create table tests.ids as
select
  (select id from auth.users where email = 'a-owner@teste.local')  as u_a_owner,
  (select id from auth.users where email = 'b-owner@teste.local')  as u_b_owner,
  (select id from auth.users where email = 'a-admin@teste.local')  as u_a_admin,
  (select id from auth.users where email = 'a-member@teste.local') as u_a_member,
  (select id from auth.users where email = 'equipe@teste.local')   as u_equipe,
  (select m.org_id from public.memberships m
     where m.user_id = (select id from auth.users where email = 'a-owner@teste.local')) as org_a,
  (select m.org_id from public.memberships m
     where m.user_id = (select id from auth.users where email = 'b-owner@teste.local')) as org_b;

-- Admin e member entram na organização A.
insert into public.memberships (org_id, user_id, role)
select org_a, u_a_admin, 'admin' from tests.ids;
insert into public.memberships (org_id, user_id, role)
select org_a, u_a_member, 'member' from tests.ids;

-- Um funcionário da Storefy.
insert into public.platform_admins (user_id, role)
select u_equipe, 'superadmin' from tests.ids;

-- Uma loja em cada organização (o trigger cria o app de cada uma).
insert into public.stores (org_id, name, primary_url)
select org_a, 'Loja da A', 'https://loja-a.com.br' from tests.ids;
insert into public.stores (org_id, name, primary_url)
select org_b, 'Loja da B', 'https://loja-b.com.br' from tests.ids;

drop table if exists tests.lojas;
create table tests.lojas as
select
  (select id from public.stores where name = 'Loja da A') as loja_a,
  (select id from public.stores where name = 'Loja da B') as loja_b;

grant select on tests.ids, tests.lojas to anon, authenticated, service_role;

-- ============================================ grupo 1: isolamento entre orgs

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.organizations') = 1,
  'A enxerga exatamente uma organização (a própria)');

select tests.ok('isolamento',
  tests.contar(format('select count(*) from public.organizations where id = %L',
    (select org_b from tests.ids))) = 0,
  'A não enxerga a organização de B');

select tests.ok('isolamento',
  tests.contar('select count(*) from public.stores') = 1,
  'A enxerga exatamente uma loja (a própria)');

select tests.ok('isolamento',
  tests.contar(format('select count(*) from public.stores where id = %L',
    (select loja_b from tests.lojas))) = 0,
  'A não enxerga a loja de B');

select tests.ok('isolamento',
  tests.bloqueado(format(
    'update public.stores set name = ''Invadida'' where id = %L', (select loja_b from tests.lojas))),
  'A não consegue editar a loja de B');

select tests.ok('isolamento',
  tests.bloqueado(format(
    'delete from public.stores where id = %L', (select loja_b from tests.lojas))),
  'A não consegue excluir a loja de B');

select tests.ok('isolamento',
  tests.bloqueado(format(
    'insert into public.stores (org_id, name, primary_url) values (%L, ''Intrusa'', ''https://intrusa.com'')',
    (select org_b from tests.ids))),
  'A não consegue criar loja dentro da organização de B');

select tests.ok('isolamento',
  tests.bloqueado(format(
    'update public.organizations set name = ''Sequestrada'' where id = %L', (select org_b from tests.ids))),
  'A não consegue renomear a organização de B');

select tests.ok('isolamento',
  tests.contar(format('select count(*) from public.memberships where org_id = %L',
    (select org_b from tests.ids))) = 0,
  'A não enxerga os membros da organização de B');

select tests.ok('isolamento',
  tests.contar('select count(*) from public.apps') = 1,
  'A enxerga apenas o app da própria loja');

select tests.ok('isolamento',
  tests.contar(format(
    'select count(*) from public.audit_logs where org_id = %L', (select org_b from tests.ids))) = 0,
  'A não enxerga a auditoria da organização de B');

select tests.ok('isolamento',
  tests.bloqueado(format(
    'insert into public.memberships (org_id, user_id, role) values (%L, %L, ''owner'')',
    (select org_b from tests.ids), (select u_a_owner from tests.ids))),
  'A não consegue se adicionar à organização de B');

reset role;

-- ================================================ grupo 2: papéis na org A

-- member: somente leitura
select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('papéis',
  tests.contar(format('select count(*) from public.stores where id = %L',
    (select loja_a from tests.lojas))) = 1,
  'member lê a loja da organização');

select tests.ok('papéis',
  tests.bloqueado(format(
    'insert into public.stores (org_id, name, primary_url) values (%L, ''Nova'', ''https://nova.com'')',
    (select org_a from tests.ids))),
  'member NÃO cria loja');

select tests.ok('papéis',
  tests.bloqueado(format(
    'update public.stores set name = ''Renomeada'' where id = %L', (select loja_a from tests.lojas))),
  'member NÃO edita loja');

select tests.ok('papéis',
  tests.bloqueado(format(
    'delete from public.stores where id = %L', (select loja_a from tests.lojas))),
  'member NÃO exclui loja');

select tests.ok('papéis',
  tests.bloqueado(format(
    'update public.organizations set name = ''Outra'' where id = %L', (select org_a from tests.ids))),
  'member NÃO edita a organização');

select tests.ok('papéis',
  tests.bloqueado(format(
    'update public.memberships set role = ''owner'' where org_id = %L and user_id = %L',
    (select org_a from tests.ids), (select u_a_member from tests.ids))),
  'member NÃO se promove a owner');

select tests.ok('papéis',
  tests.bloqueado(format(
    'delete from public.organizations where id = %L', (select org_a from tests.ids))),
  'member NÃO exclui a organização');

reset role;

-- admin: cria e edita, mas não exclui nem mexe em membros
select tests.login('a-admin@teste.local');
set role authenticated;

select tests.ok('papéis',
  tests.permitido(format(
    'insert into public.stores (org_id, name, primary_url) values (%L, ''Loja do Admin'', ''https://admin-loja.com.br'')',
    (select org_a from tests.ids))),
  'admin CRIA loja');

select tests.ok('papéis',
  tests.permitido(format(
    'update public.stores set name = ''Loja da A editada'' where id = %L', (select loja_a from tests.lojas))),
  'admin EDITA loja');

select tests.ok('papéis',
  tests.permitido(format(
    'update public.organizations set name = ''Org A editada'' where id = %L', (select org_a from tests.ids))),
  'admin EDITA a organização');

select tests.ok('papéis',
  tests.bloqueado(format(
    'delete from public.stores where id = %L', (select loja_a from tests.lojas))),
  'admin NÃO exclui loja (só owner)');

select tests.ok('papéis',
  tests.bloqueado(format(
    'update public.memberships set role = ''member'' where org_id = %L and user_id = %L',
    (select org_a from tests.ids), (select u_a_owner from tests.ids))),
  'admin NÃO altera papéis (só owner)');

select tests.ok('papéis',
  tests.bloqueado(format(
    'delete from public.organizations where id = %L', (select org_a from tests.ids))),
  'admin NÃO exclui a organização (só owner)');

reset role;

-- owner: pode excluir
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('papéis',
  tests.permitido(
    'delete from public.stores where name = ''Loja do Admin'''),
  'owner EXCLUI loja');

select tests.ok('papéis',
  tests.permitido(format(
    'update public.memberships set role = ''member'' where org_id = %L and user_id = %L',
    (select org_a from tests.ids), (select u_a_admin from tests.ids))),
  'owner ALTERA papel de outro membro');

reset role;

-- ================================================== grupo 3: acesso ao admin

select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.contar('select count(*) from public.platform_admins') = 0,
  'usuário comum NÃO enxerga a lista de platform_admins');

select tests.ok('admin',
  tests.bloqueado(format(
    'insert into public.platform_admins (user_id, role) values (%L, ''superadmin'')',
    (select u_a_owner from tests.ids))),
  'usuário comum NÃO se cadastra como platform_admin');

select tests.ok('admin',
  tests.contar('select count(*) from public.organizations') = 1,
  'usuário comum enxerga apenas a própria organização, não todas');

select tests.ok('admin',
  tests.contar('select count(*) from public.stores') = 0,
  'usuário comum sem loja não enxerga loja nenhuma');

select tests.ok('admin',
  (select public.is_platform_admin()) = false,
  'is_platform_admin() é falso para usuário comum');

reset role;

select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  (select public.is_platform_admin()) = true,
  'is_platform_admin() é verdadeiro para a equipe Storefy');

select tests.ok('admin',
  tests.contar('select count(*) from public.organizations') >= 6,
  'platform admin enxerga todas as organizações');

select tests.ok('admin',
  tests.contar('select count(*) from public.stores') = 2,
  'platform admin enxerga as lojas de todas as organizações');

select tests.ok('admin',
  tests.bloqueado(format(
    'delete from public.stores where id = %L', (select loja_b from tests.lojas))),
  'platform admin NÃO escreve pelo painel do cliente (leitura por RLS; escrita exige service role auditada)');

select tests.ok('admin',
  tests.contar(format(
    'select count(*) from public.admin_membros_da_org(%L)', (select org_a from tests.ids))) = 3,
  'platform admin lista os membros de uma organização com e-mail');

reset role;

-- As funções admin_* precisam recusar quem não é da equipe.
select tests.login('a-owner@teste.local');
set role authenticated;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform * from public.admin_membros_da_org((select org_a from tests.ids));
  exception when insufficient_privilege then
    v_barrado := true;
  end;
  perform tests.ok('admin', v_barrado,
    'admin_membros_da_org recusa usuário comum');
end
$$;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.admin_email_do_usuario((select u_b_owner from tests.ids));
  exception when insufficient_privilege then
    v_barrado := true;
  end;
  perform tests.ok('admin', v_barrado,
    'admin_email_do_usuario recusa usuário comum');
end
$$;

reset role;

-- ============================================ grupo 4: auditoria é somente-anexar

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('auditoria',
  tests.bloqueado(format(
    'insert into public.audit_logs (actor_id, org_id, action, entity) values (%L, %L, ''create'', ''forjado'')',
    (select u_a_owner from tests.ids), (select org_a from tests.ids))),
  'ninguém insere em audit_logs diretamente');

select tests.ok('auditoria',
  tests.bloqueado(format(
    'update public.audit_logs set action = ''delete'' where org_id = %L', (select org_a from tests.ids))),
  'ninguém edita audit_logs');

select tests.ok('auditoria',
  tests.bloqueado(format(
    'delete from public.audit_logs where org_id = %L', (select org_a from tests.ids))),
  'ninguém apaga audit_logs');

select tests.ok('auditoria',
  tests.contar(format(
    'select count(*) from public.audit_logs where org_id = %L and entity = ''stores''',
    (select org_a from tests.ids))) >= 1,
  'a criação da loja ficou registrada na auditoria');

reset role;

-- ==================================================== grupo 5: triggers

select tests.ok('triggers',
  (select count(*) from public.memberships m join tests.ids on m.org_id = ids.org_a
     where m.user_id = ids.u_a_owner and m.role = 'owner') = 1,
  'o cadastro criou a organização com o usuário como owner');

select tests.ok('triggers',
  (select count(*) from public.apps a join tests.lojas on a.store_id = lojas.loja_a) = 1,
  'criar a loja criou o registro de app');

select tests.ok('triggers',
  (select o.slug from public.organizations o join tests.ids on o.id = ids.org_a) = 'org-a',
  'o slug da organização foi gerado a partir do nome');

-- Último owner protegido.
do $$
declare
  v_org uuid;
  v_user uuid;
  v_protegido boolean := false;
begin
  select org_b, u_b_owner into v_org, v_user from tests.ids;
  begin
    delete from public.memberships where org_id = v_org and user_id = v_user;
  exception when check_violation then
    v_protegido := true;
  end;
  perform tests.ok('triggers', v_protegido,
    'não é possível remover o último owner da organização');
end
$$;

-- A auditoria registra o diff da edição, sem campos ruidosos.
do $$
declare
  v_loja uuid;
  v_diff jsonb;
begin
  select loja_a into v_loja from tests.lojas;
  update public.stores set name = 'Nome Auditado' where id = v_loja;
  select diff into v_diff from public.audit_logs
    where entity = 'stores' and entity_id = v_loja and action = 'update'
    order by created_at desc limit 1;
  perform tests.ok('triggers', v_diff ? 'name',
    'o diff da auditoria contém o campo alterado');
  perform tests.ok('triggers', not (v_diff ? 'updated_at'),
    'o diff da auditoria ignora updated_at');
end
$$;

-- ======================================================== relatório

\o

\echo ''
\echo '================ RESULTADO DOS TESTES DE RLS ================'
select grupo,
       count(*) filter (where passou) as passou,
       count(*) filter (where not passou) as falhou
from tests.resultados group by grupo order by grupo;

\echo ''
\echo 'Falhas:'
select grupo, descricao from tests.resultados where not passou order by id;

-- Sai com erro se qualquer asserção falhou, para o CI reprovar o build.
do $$
declare
  v_falhas integer;
  v_total integer;
begin
  select count(*) filter (where not passou), count(*) into v_falhas, v_total
  from tests.resultados;
  raise notice '% de % asserções passaram', v_total - v_falhas, v_total;
  if v_falhas > 0 then
    raise exception '% asserção(ões) de RLS falharam', v_falhas;
  end if;
end
$$;
