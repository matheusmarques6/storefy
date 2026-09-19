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
  (select id from public.stores where name = 'Loja da B') as loja_b,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja da A') as app_a,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja da B') as app_b;

grant select on tests.ids, tests.lojas to anon, authenticated, service_role;

-- Um rascunho de config em cada app, para o grupo 8. O JSON é o mínimo que
-- passa no AppConfigSchema; o que se testa aqui é quem pode mexer nele.
insert into public.app_configs (app_id, version, config, status)
select app_a, 1, jsonb_build_object(
  'version', 1,
  'store', jsonb_build_object('name','Loja da A','url','https://loja-a.com.br',
                              'domains', jsonb_build_array('loja-a.com.br')),
  'theme', jsonb_build_object('primary','#111827','background','#ffffff','text','#111827',
                              'tabBarBg','#ffffff','tabBarActive','#111827',
                              'tabBarInactive','#9ca3af','statusBar','dark'),
  'tabs', jsonb_build_array(
    jsonb_build_object('id','inicio','label','Início','icon','house','type','webview','url','/'),
    jsonb_build_object('id','conta','label','Conta','icon','user','type','account')),
  'webview', jsonb_build_object('hideSelectors', jsonb_build_array()),
  'features', jsonb_build_object('pushPromptTiming','onboarding',
                                 'onboardingSlides', jsonb_build_array(),
                                 'appBanner', jsonb_build_object('enabled',false,'text',''))
), 'draft'
from tests.lojas;

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

-- ================================== grupo 6: permissões de execução

-- O PostgreSQL concede EXECUTE a PUBLIC em toda função nova, e no Supabase isso
-- vira um endpoint em /rest/v1/rpc/<nome>. A migration de endurecimento revoga
-- o que não deve ser chamável. Estes testes impedem a regressão.

select tests.login('a-owner@teste.local');
set role authenticated;

-- Funções de trigger não podem ser chamadas por ninguém.
do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.handle_new_user();
  exception
    when insufficient_privilege then v_barrado := true;
    when others then v_barrado := (sqlstate = '42501');
  end;
  perform tests.ok('permissões', v_barrado,
    'authenticated NÃO executa handle_new_user por RPC');
end
$$;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.generate_org_slug('sondagem');
  exception
    when insufficient_privilege then v_barrado := true;
    when others then v_barrado := (sqlstate = '42501');
  end;
  perform tests.ok('permissões', v_barrado,
    'authenticated NÃO executa generate_org_slug por RPC');
end
$$;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.handle_audit();
  exception
    when insufficient_privilege then v_barrado := true;
    when others then v_barrado := (sqlstate = '42501');
  end;
  perform tests.ok('permissões', v_barrado,
    'authenticated NÃO executa handle_audit por RPC');
end
$$;

-- Os auxiliares de policy precisam continuar funcionando para authenticated,
-- senão toda query com RLS quebraria.
select tests.ok('permissões',
  (select public.is_org_member((select org_a from tests.ids))) = true,
  'authenticated AINDA executa is_org_member (a RLS depende disso)');

reset role;

-- Visitante anônimo não deve alcançar os auxiliares.
select tests.logout();
set role anon;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.is_org_member((select org_a from tests.ids));
  exception
    when insufficient_privilege then v_barrado := true;
    when others then v_barrado := (sqlstate = '42501');
  end;
  perform tests.ok('permissões', v_barrado,
    'anon NÃO executa is_org_member por RPC');
end
$$;

do $$
declare
  v_barrado boolean := false;
begin
  begin
    perform public.is_platform_admin();
  exception
    when insufficient_privilege then v_barrado := true;
    when others then v_barrado := (sqlstate = '42501');
  end;
  perform tests.ok('permissões', v_barrado,
    'anon NÃO executa is_platform_admin por RPC');
end
$$;

reset role;

-- Os auxiliares seguem chamáveis por authenticated, e precisam mesmo: a RLS os
-- avalia com o papel de quem consulta. Isso é seguro porque cada um responde
-- APENAS sobre o próprio auth.uid() — sondar o id de outra organização devolve
-- false, sem revelar se ela existe.
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('permissões',
  (select public.is_org_member((select org_b from tests.ids))) = false,
  'is_org_member sondando outra organização devolve false');

select tests.ok('permissões',
  (select public.has_org_role((select org_b from tests.ids),
     array['owner','admin','member']::public.membership_role[])) = false,
  'has_org_role sondando outra organização devolve false');

select tests.ok('permissões',
  (select public.is_store_member((select loja_b from tests.lojas))) = false,
  'is_store_member sondando a loja de outra organização devolve false');

select tests.ok('permissões',
  (select public.is_org_member(extensions.gen_random_uuid())) = false,
  'is_org_member com id inexistente devolve false, sem revelar existência');

reset role;

-- A função morta foi removida.
select tests.ok('permissões',
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_org_ids') = 0,
  'current_org_ids foi removida (era security definer sem uso)');

-- Os triggers continuam disparando mesmo sem EXECUTE concedido.
select tests.ok('permissões',
  (select count(*) from public.apps a join tests.lojas on a.store_id = tests.lojas.loja_a) = 1,
  'o trigger de criação de app dispara sem EXECUTE concedido');

-- ===================================== grupo 7: exclusão em cascata

-- Estes casos quebravam antes da migration 20260918000002: o protect_last_owner
-- não distinguia remoção deliberada de cascata, e a FK de audit_logs impedia
-- registrar a exclusão de uma organização.

-- Usuários próprios deste grupo, para não mexer no fixture dos anteriores.
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('exclusao-conta@teste.local',   '{"company_name":"Exclusao Conta"}'::jsonb,   now()),
  ('exclusao-org@teste.local',     '{"company_name":"Exclusao Org"}'::jsonb,     now()),
  ('sucessao-dono@teste.local',    '{"company_name":"Sucessao"}'::jsonb,         now()),
  ('sucessao-segundo@teste.local', '{"company_name":"Pessoal Segundo"}'::jsonb,  now());

-- Excluir a própria conta precisa funcionar: a LGPD garante esse direito, e a
-- limpeza dos testes E2E depende disso.
do $$
declare
  v_ok boolean := false;
begin
  begin
    delete from auth.users where email = 'exclusao-conta@teste.local';
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  perform tests.ok('exclusão', v_ok, 'excluir a conta do último owner funciona');
end
$$;

select tests.ok('exclusão',
  (select count(*) from public.organizations where name = 'Exclusao Conta') = 0,
  'a organização sem membros sai junto com a conta');

-- Excluir a organização também precisa funcionar.
do $$
declare
  v_org uuid;
  v_ok boolean := false;
begin
  select m.org_id into v_org from public.memberships m
    join auth.users u on u.id = m.user_id
    where u.email = 'exclusao-org@teste.local';
  begin
    delete from public.organizations where id = v_org;
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  perform tests.ok('exclusão', v_ok, 'excluir a organização funciona');
  perform tests.ok('exclusão',
    exists (select 1 from public.audit_logs
            where entity = 'organizations' and entity_id = v_org and action = 'delete'),
    'a exclusão da organização fica registrada e a trilha sobrevive a ela');
end
$$;

-- Saindo o último owner, quem fica assume.
do $$
declare
  v_org uuid;
  v_dono uuid;
  v_segundo uuid;
  v_papel public.membership_role;
begin
  select m.org_id, m.user_id into v_org, v_dono from public.memberships m
    join auth.users u on u.id = m.user_id where u.email = 'sucessao-dono@teste.local';
  select id into v_segundo from auth.users where email = 'sucessao-segundo@teste.local';

  insert into public.memberships (org_id, user_id, role) values (v_org, v_segundo, 'admin');
  delete from auth.users where id = v_dono;

  select role into v_papel from public.memberships
    where org_id = v_org and user_id = v_segundo;

  perform tests.ok('exclusão', v_papel = 'owner',
    'o membro restante é promovido a owner quando o dono sai');
  perform tests.ok('exclusão',
    exists (select 1 from public.organizations where id = v_org),
    'a organização com membros sobrevive à saída do dono');
end
$$;

-- A regra original continua valendo: remoção deliberada do último owner é
-- bloqueada, porque tanto a conta quanto a organização continuam existindo.
do $$
declare
  v_org uuid;
  v_user uuid;
  v_bloqueado boolean := false;
begin
  select org_b, u_b_owner into v_org, v_user from tests.ids;
  begin
    delete from public.memberships where org_id = v_org and user_id = v_user;
  exception when check_violation then
    v_bloqueado := true;
  end;
  perform tests.ok('exclusão', v_bloqueado,
    'remover o último owner deliberadamente continua bloqueado');
end
$$;

-- ============================== grupo 8: versões da config do app (fase 2)
--
-- Publicar são quatro escritas que só fazem sentido juntas. O que se prova
-- aqui é que a função respeita a RLS — ela é `security invoker` e não ganha
-- privilégio nenhum — e que uma falha de permissão não deixa o app sem
-- config publicada.

-- member: lê, mas não publica nem restaura.
select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('config',
  tests.contar('select count(*) from public.app_configs') = 1,
  'member enxerga a config do app da própria organização');

select tests.ok('config',
  tests.bloqueado(format('select public.publicar_config(%L)', (select app_a from tests.lojas))),
  'member NÃO publica a config');

select tests.ok('config',
  tests.bloqueado(format('select public.restaurar_config(%L, 1)', (select app_a from tests.lojas))),
  'member NÃO restaura uma versão');

select tests.ok('config',
  tests.contar('select count(*) from public.app_configs where status = ''published''') = 0,
  'a tentativa do member não deixou nada publicado pela metade');

/*
 * A MENSAGEM importa, e não só o fato de falhar.
 *
 * Sem a conferência de linhas afetadas dentro da função, a chamada do member
 * ainda assim quebraria — mas lá na frente, no `insert` do próximo rascunho, e
 * com o erro cru de policy do Postgres. O lojista veria "new row violates
 * row-level security policy for table app_configs" em vez de saber que lhe
 * falta permissão. Esta asserção é o que separa as duas coisas.
 */
do $$
declare
  v_mensagem text := '';
begin
  begin
    perform public.publicar_config((select app_a from tests.lojas));
  exception when others then
    v_mensagem := sqlerrm;
  end;
  perform tests.ok('config', v_mensagem like '%Sem permissão para publicar%',
    'a recusa ao member explica o motivo em vez de vazar erro de policy');

  v_mensagem := '';
  begin
    perform public.restaurar_config((select app_a from tests.lojas), 1);
  exception when others then
    v_mensagem := sqlerrm;
  end;
  perform tests.ok('config', v_mensagem like '%Sem permissão para restaurar%',
    'a recusa de restaurar ao member também explica o motivo');
end
$$;

reset role;

-- admin: publica.
--
-- O grupo 2 rebaixou a-admin a member de propósito, ao provar que o owner
-- altera papel de outro membro. Este grupo declara a própria precondição em
-- vez de depender da ordem dos anteriores.
update public.memberships set role = 'admin'
 where org_id = (select org_a from tests.ids)
   and user_id = (select u_a_admin from tests.ids);

select tests.login('a-admin@teste.local');
set role authenticated;

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_versao integer;
begin
  v_versao := public.publicar_config(v_app);
  perform tests.ok('config', v_versao = 1, 'admin publica e recebe a versão publicada');
  perform tests.ok('config',
    (select count(*) from public.app_configs where app_id = v_app and status = 'published') = 1,
    'existe exatamente uma versão publicada');
  perform tests.ok('config',
    (select count(*) from public.app_configs where app_id = v_app and status = 'draft') = 1,
    'publicar abre um rascunho novo para seguir editando');
  perform tests.ok('config',
    (select config->>'version' from public.app_configs
      where app_id = v_app and status = 'published') = '1',
    'o version de dentro do JSON casa com a versão da linha publicada');
  perform tests.ok('config',
    (select config->>'version' from public.app_configs
      where app_id = v_app and status = 'draft') = '2',
    'o rascunho novo já nasce na versão seguinte');
  perform tests.ok('config',
    (select current_config_version from public.apps where id = v_app) = 1,
    'apps.current_config_version aponta para a versão publicada');
  perform tests.ok('config',
    (select published_by from public.app_configs
      where app_id = v_app and status = 'published') = (select u_a_admin from tests.ids),
    'quem publicou fica registrado');
end
$$;

reset role;

-- owner: publica de novo e a anterior vira histórico.
select tests.login('a-owner@teste.local');
set role authenticated;

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_versao integer;
begin
  update public.app_configs
     set config = jsonb_set(config, '{theme,primary}', '"#ff0000"')
   where app_id = v_app and status = 'draft';

  v_versao := public.publicar_config(v_app);
  perform tests.ok('config', v_versao = 2, 'a segunda publicação é a versão 2');
  perform tests.ok('config',
    (select count(*) from public.app_configs where app_id = v_app and status = 'published') = 1,
    'continua existindo uma publicada só');
  perform tests.ok('config',
    (select count(*) from public.app_configs where app_id = v_app and status = 'archived') = 1,
    'a versão anterior virou histórico em vez de sumir');
  perform tests.ok('config',
    (select config->'theme'->>'primary' from public.app_configs
      where app_id = v_app and status = 'published') = '#ff0000',
    'o que foi publicado é o que estava no rascunho');

  -- restaurar carrega no rascunho e NÃO publica
  v_versao := public.restaurar_config(v_app, 1);
  perform tests.ok('config', v_versao = 3, 'restaurar devolve a versão do rascunho que recebeu');
  perform tests.ok('config',
    (select config->'theme'->>'primary' from public.app_configs
      where app_id = v_app and status = 'draft') = '#111827',
    'o rascunho recebeu a config da versão antiga');
  perform tests.ok('config',
    (select config->>'version' from public.app_configs
      where app_id = v_app and status = 'draft') = '3',
    'a config restaurada assume a versão do rascunho, e não a antiga');
  perform tests.ok('config',
    (select config->'theme'->>'primary' from public.app_configs
      where app_id = v_app and status = 'published') = '#ff0000',
    'RESTAURAR NÃO MEXE NO QUE ESTÁ NO AR');
end
$$;

do $$
declare
  v_bloqueado boolean := false;
begin
  begin
    perform public.restaurar_config((select app_a from tests.lojas), 99);
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('config', v_bloqueado, 'restaurar uma versão que não existe falha');
end
$$;

reset role;

-- outra organização não encosta.
select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('config',
  tests.contar(format('select count(*) from public.app_configs where app_id = %L',
    (select app_a from tests.lojas))) = 0,
  'B não enxerga as configs do app de A');

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_bloqueado boolean := false;
begin
  begin
    perform public.publicar_config(v_app);
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('config', v_bloqueado, 'B NÃO publica a config do app de A');

  v_bloqueado := false;
  begin
    perform public.restaurar_config(v_app, 1);
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('config', v_bloqueado, 'B NÃO restaura versão do app de A');
end
$$;

reset role;

-- sem sessão, nem executar.
select tests.logout();
set role anon;

select tests.ok('config',
  tests.bloqueado(format('select public.publicar_config(%L)', (select app_a from tests.lojas))),
  'anon não executa publicar_config');

select tests.ok('config',
  tests.bloqueado(format('select public.restaurar_config(%L, 1)', (select app_a from tests.lojas))),
  'anon não executa restaurar_config');

select tests.ok('config',
  tests.contar('select count(*) from public.app_configs') = 0,
  'anon não lê config nenhuma');

reset role;

-- ============================ grupo 9: sessões de prévia (app Preview)
--
-- O código de prévia dá acesso ao RASCUNHO de uma loja sem login nenhum. O
-- que se prova aqui é que só quem publica consegue criar um, que o valor em
-- claro nunca fica no banco, e que ele não atravessa a fronteira da
-- organização.

select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('prévia',
  tests.bloqueado(format('select public.abrir_previa(%L, 30)', (select app_a from tests.lojas))),
  'member NÃO abre prévia');

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_token text;
  v_expira timestamptz;
begin
  select token, expira_em into v_token, v_expira from public.abrir_previa(v_app, 30);

  perform tests.ok('prévia', v_token ~ '^[0-9a-f]{32}$',
    'o código tem 32 hexadecimais');
  perform tests.ok('prévia', v_expira > now() and v_expira < now() + interval '31 minutes',
    'o código vence em meia hora');

  perform tests.ok('prévia',
    not exists (select 1 from public.preview_sessions where token_hash = v_token),
    'O CÓDIGO EM CLARO NÃO FICA NO BANCO');
  perform tests.ok('prévia',
    exists (
      select 1 from public.preview_sessions
       where app_id = v_app
         and token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
    ),
    'o que fica guardado é o hash dele');

  -- prazo fora da faixa
  declare
    v_bloqueado boolean := false;
  begin
    begin
      perform public.abrir_previa(v_app, 0);
    exception when others then
      v_bloqueado := true;
    end;
    perform tests.ok('prévia', v_bloqueado, 'prazo fora da faixa é recusado');
  end;
end
$$;

reset role;

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('prévia',
  tests.contar('select count(*) from public.preview_sessions') = 0,
  'B não enxerga as prévias de A');

do $$
declare
  v_bloqueado boolean := false;
begin
  begin
    perform public.abrir_previa((select app_a from tests.lojas), 30);
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('prévia', v_bloqueado, 'B NÃO abre prévia do app de A');
end
$$;

reset role;

select tests.logout();
set role anon;

select tests.ok('prévia',
  tests.bloqueado(format('select public.abrir_previa(%L, 30)', (select app_a from tests.lojas))),
  'anon não abre prévia');

select tests.ok('prévia',
  tests.contar('select count(*) from public.preview_sessions') = 0,
  'anon não lê prévia nenhuma');

reset role;

-- ================== grupo 10: push, eventos e colunas de segredo (fase 3)

-- A RLS é por LINHA; segredo é problema de COLUNA. Estas asserções provam que
-- o `revoke ... grant (colunas)` está de pé, porque é o que separa "o token
-- está criptografado" de "o token não chega ao navegador".

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('segredo',
  tests.erro('select shopify_access_token_enc from public.stores limit 1'),
  'owner NÃO lê o token da Shopify');

select tests.ok('segredo',
  tests.erro('select onesignal_api_key_enc from public.apps limit 1'),
  'owner NÃO lê a chave do OneSignal');

select tests.ok('segredo',
  tests.erro('select * from public.stores limit 1'),
  'um select * em stores FALHA em vez de vazar em silêncio');

select tests.ok('segredo',
  tests.contar('select count(*) from public.stores') >= 1,
  'as colunas liberadas continuam legíveis');

select tests.ok('segredo',
  tests.erro('select asc_key_enc from public.developer_accounts limit 1'),
  'owner NÃO lê a chave da App Store Connect');

select tests.ok('segredo',
  tests.erro('select google_service_account_enc from public.developer_accounts limit 1'),
  'owner NÃO lê a conta de serviço do Google');

reset role;

-- As duas asserções abaixo valem para o schema INTEIRO, inclusive para tabelas
-- e colunas que ainda não existem. São elas que impedem o erro que se repete:
-- alguém adiciona uma coluna a uma tabela com grant coluna a coluna e ela nasce
-- invisível para o painel (sem erro, só some da resposta do PostgREST), ou
-- alguém cria uma coluna `_enc` numa tabela sem grant restrito e o segredo
-- nasce legível no navegador.
select tests.ok('segredo',
  not exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and a.attnum > 0 and not a.attisdropped
       and a.attname like '%\_enc'
       and (has_column_privilege('authenticated', c.oid, a.attnum, 'select')
         or has_column_privilege('anon', c.oid, a.attnum, 'select'))
  ),
  'NENHUMA coluna _enc do schema é legível por quem tem sessão');

select tests.ok('segredo',
  not exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('stores', 'apps', 'developer_accounts')
       and a.attnum > 0 and not a.attisdropped
       and a.attname not like '%\_enc'
       and not has_column_privilege('authenticated', c.oid, a.attnum, 'select')
  ),
  'e toda coluna que NÃO é segredo continua legível: nenhuma nasce invisível');

select tests.login('a-owner@teste.local');
set role authenticated;

-- `not tests.erro(...)` e não `tests.contar(...)`: se a coluna estiver fechada,
-- `contar` relança e derruba a suíte inteira antes do relatório. Aqui a
-- asserção falha e as outras continuam rodando, que é o que se quer de um teste.
select tests.ok('segredo',
  not tests.erro('select timezone from public.stores limit 1'),
  'o painel lê o fuso da loja, que é o que ele precisa editar');

reset role;

-- --------------------------------------------------------------- campanhas

select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('push',
  tests.bloqueado(format(
    'insert into public.push_campaigns (app_id, title, body) values (%L, ''Oi'', ''Corpo'')',
    (select app_a from tests.lojas))),
  'member NÃO cria campanha');

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_campanha uuid;
  v_bloqueado boolean;
begin
  insert into public.push_campaigns (app_id, title, body, deep_link)
  values (v_app, 'Novidades', 'Chegou coleção nova', '/collections/novidades')
  returning id into v_campanha;
  perform tests.ok('push', v_campanha is not null, 'owner cria campanha');

  perform tests.ok('push',
    (select count(*) from public.audit_logs
      where entity = 'push_campaigns' and entity_id = v_campanha) = 1,
    'a criação da campanha vai para a auditoria');

  -- agendada sem horário é campanha que nunca sai
  v_bloqueado := false;
  begin
    update public.push_campaigns set status = 'scheduled' where id = v_campanha;
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('push', v_bloqueado, 'agendar sem horário é recusado pelo banco');

  update public.push_campaigns
     set status = 'scheduled', scheduled_at = now() + interval '1 hour'
   where id = v_campanha;
  perform tests.ok('push',
    (select status from public.push_campaigns where id = v_campanha) = 'scheduled',
    'agendar com horário funciona');
end
$$;

-- Campanha enviada não volta atrás: o painel mostraria uma coisa e o celular
-- do cliente outra. Quem marca como enviada é o job, pela service role.
reset role;
update public.push_campaigns set status = 'sent', sent_at = now()
 where app_id = (select app_a from tests.lojas);

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('push',
  tests.bloqueado(
    'update public.push_campaigns set title = ''Trocado'' where status = ''sent'''),
  'owner NÃO edita campanha já enviada');

select tests.ok('push',
  tests.bloqueado('delete from public.push_campaigns where status = ''sent'''),
  'owner NÃO exclui campanha já enviada');

-- ------------------------------------------------------------- automações

do $$
declare
  v_app uuid := (select app_a from tests.lojas);
  v_bloqueado boolean := false;
begin
  insert into public.push_automations (app_id, type, title, body)
  values (v_app, 'abandoned_cart', 'Esqueceu algo?', 'Seu carrinho está esperando');

  begin
    insert into public.push_automations (app_id, type, title, body)
    values (v_app, 'abandoned_cart', 'Outra', 'Outra');
  exception when others then
    v_bloqueado := true;
  end;
  perform tests.ok('push', v_bloqueado,
    'duas automações do mesmo tipo disputariam o mesmo gatilho, e o banco recusa');

  perform tests.ok('push',
    (select delay_minutes from public.push_automations
      where app_id = v_app and type = 'abandoned_cart') = 60,
    'o carrinho abandonado nasce com a espera de 60 minutos do plano');
end
$$;

reset role;

-- -------------------------------------------- o app escreve, o painel não

-- `devices`, `cart_events` e `automation_runs` só entram pela service role.
insert into public.devices (app_id, onesignal_subscription_id, platform)
values ((select app_a from tests.lojas), 'sub-teste-1', 'ios');

insert into public.cart_events (app_id, item_count, event)
values ((select app_a from tests.lojas), 2, 'add');

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('push',
  tests.contar('select count(*) from public.devices') = 1,
  'o lojista enxerga o aparelho que o app registrou');

select tests.ok('push',
  tests.bloqueado(format(
    'insert into public.devices (app_id, onesignal_subscription_id, platform) values (%L, ''forjado'', ''ios'')',
    (select app_a from tests.lojas))),
  'o painel NÃO inventa aparelho');

select tests.ok('push',
  tests.bloqueado(format(
    'insert into public.cart_events (app_id, item_count, event) values (%L, 1, ''add'')',
    (select app_a from tests.lojas))),
  'o painel NÃO inventa evento de carrinho');

select tests.ok('push',
  tests.contar('select count(*) from public.cart_events') = 1,
  'mas enxerga os eventos que o app mandou');

reset role;

-- ------------------------------------------------ a outra organização

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('push',
  tests.contar('select count(*) from public.push_campaigns') = 0,
  'B não enxerga as campanhas de A');

select tests.ok('push',
  tests.contar('select count(*) from public.devices') = 0,
  'B não enxerga os aparelhos de A');

select tests.ok('push',
  tests.contar('select count(*) from public.cart_events') = 0,
  'B não enxerga os eventos de A');

select tests.ok('push',
  tests.contar('select count(*) from public.push_automations') = 0,
  'B não enxerga as automações de A');

reset role;

select tests.logout();
set role anon;

select tests.ok('push',
  tests.contar('select count(*) from public.devices') = 0,
  'anon não lê aparelho nenhum');

select tests.ok('push',
  tests.contar('select count(*) from public.push_campaigns') = 0,
  'anon não lê campanha nenhuma');

select tests.ok('segredo',
  tests.erro('select shopify_access_token_enc from public.stores limit 1'),
  'anon muito menos lê o token da Shopify');

reset role;

-- ====================== grupo 11: o que o app escreve (fase 3, migration 7)
--
-- Estas funções são o único caminho por onde o app grava. Elas decidem se um
-- push de carrinho abandonado sai, e é aí que mora o erro caro: mandar
-- "você esqueceu algo" para quem acabou de comprar, ou mandar cinco pushes
-- porque a pessoa mexeu cinco vezes no carrinho. As asserções abaixo existem
-- para que esses casos quebrem o build, e não a confiança do cliente.

-- ------------------------------------------- quem NÃO pode chamar

-- A pergunta aqui é sobre o GRANT, não sobre a RLS. As duas barram, e é por
-- isso que a asserção precisa ser sobre o privilégio: tentar chamar a função e
-- ver dar erro passaria mesmo com a função aberta, porque a RLS de `devices`
-- barraria o insert logo depois. `has_function_privilege` não tem essa dúvida.
do $$
declare
  v_papel text;
  v_funcao text;
begin
  foreach v_papel in array array['anon', 'authenticated'] loop
    foreach v_funcao in array array[
      'public.consumir_limite(text, integer, integer)',
      'public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)',
      'public.registrar_evento_de_carrinho(uuid, text, public.cart_event_type, integer, text, integer, text)',
      'public.fora_do_silencio(timestamptz, text)'
    ] loop
      perform tests.ok('permissões',
        not has_function_privilege(v_papel, v_funcao, 'execute'),
        format('%s NÃO executa %s', v_papel, split_part(v_funcao, '(', 1)));
    end loop;
  end loop;

  perform tests.ok('permissões',
    has_function_privilege('service_role',
      'public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)', 'execute'),
    'a service role executa: é por ela que o endpoint público entra');
end
$$;

select tests.ok('permissões',
  not has_table_privilege('authenticated', 'public.rate_limits', 'select')
    and not has_table_privilege('anon', 'public.rate_limits', 'select'),
  'ninguém com sessão lê o contador de requisições');

select tests.ok('permissões',
  (select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass),
  'e a tabela tem RLS ligada, porque no PostgREST toda tabela é uma rota');

-- Fim a fim: mesmo que um grant escape, a tentativa tem de morrer.
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('permissões',
  tests.erro($q$select public.registrar_aparelho(
    (select app_a from tests.lojas), 'sub-invasor', 'ios')$q$),
  'na prática, authenticated não consegue registrar aparelho');

select tests.ok('permissões',
  tests.erro($q$select public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-invasor', 'add', 1)$q$),
  'nem registrar evento de carrinho');

reset role;
select tests.logout();
set role anon;

select tests.ok('permissões',
  tests.erro($q$select public.registrar_aparelho(
    (select app_a from tests.lojas), 'sub-anon', 'ios')$q$),
  'anon muito menos');

reset role;

-- ------------------------------------------------------- consumir_limite

set role service_role;

select tests.ok('limite',
  public.consumir_limite('teste:limite', 3),
  'a primeira chamada cabe no limite');

select tests.ok('limite',
  public.consumir_limite('teste:limite', 3) and public.consumir_limite('teste:limite', 3),
  'a segunda e a terceira ainda cabem');

select tests.ok('limite',
  not public.consumir_limite('teste:limite', 3),
  'a quarta estoura');

select tests.ok('limite',
  public.consumir_limite('teste:outra-chave', 3),
  'o estouro de uma chave não afeta a outra');

reset role;

-- Empurrar a janela para trás simula a virada do minuto sem esperar por ela.
update public.rate_limits set janela = janela - interval '1 hour'
 where chave = 'teste:limite';

set role service_role;

select tests.ok('limite',
  public.consumir_limite('teste:limite', 3),
  'na janela seguinte a contagem recomeça');

reset role;

-- ------------------------------------------------------ fora_do_silencio

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 14:00-03'::timestamptz, 'America/Sao_Paulo'
  ) = '2026-03-10 14:00-03'::timestamptz,
  'duas da tarde sai na hora');

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 03:00-03'::timestamptz, 'America/Sao_Paulo'
  ) = '2026-03-10 08:00-03'::timestamptz,
  'três da manhã espera até as oito do mesmo dia');

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 23:30-03'::timestamptz, 'America/Sao_Paulo'
  ) = '2026-03-11 08:00-03'::timestamptz,
  'onze e meia da noite espera até as oito do dia seguinte');

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 22:00-03'::timestamptz, 'America/Sao_Paulo'
  ) = '2026-03-11 08:00-03'::timestamptz,
  'as 22h em ponto já são silêncio');

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 08:00-03'::timestamptz, 'America/Sao_Paulo'
  ) = '2026-03-10 08:00-03'::timestamptz,
  'as 8h em ponto já não são');

-- O mesmo instante, dois fusos: 23h em São Paulo é 02h em Nova York — as duas
-- adiam, mas para horas diferentes. É o que prova que a conta é no fuso da loja.
select tests.ok('silêncio',
  public.fora_do_silencio('2026-03-10 23:30-03'::timestamptz, 'America/Sao_Paulo')
    <> public.fora_do_silencio('2026-03-10 23:30-03'::timestamptz, 'America/New_York'),
  'o fuso da loja muda o resultado');

select tests.ok('silêncio',
  public.fora_do_silencio(
    '2026-03-10 03:00-03'::timestamptz, 'Fuso/Inventado'
  ) = '2026-03-10 03:00-03'::timestamptz,
  'fuso inválido no cadastro não impede o push de existir');

-- ----------------------------------------------------- registrar_aparelho

set role service_role;

drop table if exists tests.aparelho;
create table tests.aparelho as
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-do-cliente', 'ios', '1.0.0', 'cliente-42', 'hash-do-email'
);

select tests.ok('aparelho',
  (select novo and not limitado and device_id is not null from tests.aparelho),
  'a primeira abertura cria o aparelho');

drop table if exists tests.aparelho2;
create table tests.aparelho2 as
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-do-cliente', 'ios', '1.1.0'
);

select tests.ok('aparelho',
  (select not a2.novo and a2.device_id = a.device_id
     from tests.aparelho a, tests.aparelho2 a2),
  'reabrir o app NÃO cria outro aparelho');

select tests.ok('aparelho',
  tests.contar($q$select count(*) from public.devices
    where onesignal_subscription_id = 'sub-do-cliente'$q$) = 1,
  'e continua havendo uma linha só');

select tests.ok('aparelho',
  (select app_version = '1.1.0' from public.devices
    where id = (select device_id from tests.aparelho)),
  'a versão nova do app substitui a antiga');

select tests.ok('aparelho',
  (select external_id = 'cliente-42' and customer_email_hash = 'hash-do-email'
     from public.devices where id = (select device_id from tests.aparelho)),
  'sair da conta (external_id nulo) não apaga quem o aparelho era');

-- A mesma inscrição em OUTRO app é outro aparelho: o índice único é por app.
select tests.ok('aparelho',
  (select novo from public.registrar_aparelho(
    (select app_b from tests.lojas), 'sub-do-cliente', 'ios')),
  'a mesma inscrição em outro app é outro aparelho');

reset role;

-- Estourar o limite de 600/min sem fazer 600 chamadas: a chave é conhecida.
update public.rate_limits set contagem = 10000
 where chave = 'aparelhos:' || (select app_a from tests.lojas)::text;

set role service_role;

select tests.ok('aparelho',
  (select limitado and device_id is null from public.registrar_aparelho(
    (select app_a from tests.lojas), 'sub-da-enxurrada', 'android')),
  'passado o limite, o aparelho não entra');

select tests.ok('aparelho',
  tests.contar($q$select count(*) from public.devices
    where onesignal_subscription_id = 'sub-da-enxurrada'$q$) = 0,
  'e nada foi gravado');

reset role;

delete from public.rate_limits where chave like 'aparelhos:%' or chave like 'eventos:%';

-- --------------------------------------------------- push de boas-vindas

-- Com a automação desligada (nenhuma foi criada ainda), o aparelho novo acima
-- não agendou nada. Agora ligada, o PRÓXIMO aparelho novo agenda.
insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'welcome', true, 10, 'Bem-vindo!', 'Que bom ter você por aqui.'
from tests.lojas
on conflict (app_id, type) do update
  set enabled = true, delay_minutes = 10;

drop table if exists tests.boas_vindas;
create table tests.boas_vindas as
select id from public.push_automations
 where app_id = (select app_a from tests.lojas) and type = 'welcome';

grant select on tests.boas_vindas to service_role;

set role service_role;

drop table if exists tests.recem_chegado;
create table tests.recem_chegado as
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-recem-chegado', 'android'
);

select tests.ok('aparelho',
  (select novo and boas_vindas from tests.recem_chegado),
  'o aparelho novo agenda o push de boas-vindas');

select tests.ok('aparelho',
  tests.contar($q$select count(*) from public.automation_runs
    where automation_id = (select id from tests.boas_vindas) and status = 'scheduled'$q$) = 1,
  'e há exatamente um agendamento de boas-vindas');

select tests.ok('aparelho',
  (select not novo and not boas_vindas from public.registrar_aparelho(
    (select app_a from tests.lojas), 'sub-recem-chegado', 'android', '1.2.0')),
  'reabrir o app NÃO agenda outro: bem-vindo se dá uma vez');

select tests.ok('aparelho',
  tests.contar($q$select count(*) from public.automation_runs
    where automation_id = (select id from tests.boas_vindas)$q$) = 1,
  'e continua um só, mesmo depois de reabrir');

select tests.ok('aparelho',
  (select not boas_vindas from public.registrar_aparelho(
    (select app_b from tests.lojas), 'sub-da-loja-b', 'ios')),
  'a loja B não tem automação de boas-vindas, então nada é agendado lá');

reset role;

-- O horário também respeita o silêncio da loja.
update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from (now() + interval '10 minutes') at time zone name) not between 8 and 21
     and name like 'America/%'
   limit 1
) where id = (select loja_a from tests.lojas);

set role service_role;

select tests.ok('aparelho',
  (select boas_vindas from public.registrar_aparelho(
    (select app_a from tests.lojas), 'sub-da-madrugada', 'ios')),
  'quem instala de madrugada também agenda');

reset role;

select tests.ok('aparelho',
  (select extract(hour from r.scheduled_for at time zone s.timezone) = 8
     from public.automation_runs r
     join public.devices d on d.id = r.device_id,
          public.stores s
    where r.automation_id = (select id from tests.boas_vindas)
      and d.onesignal_subscription_id = 'sub-da-madrugada'
      and s.id = (select loja_a from tests.lojas)),
  'mas recebe às 8h, não às três da manhã');

update public.stores set timezone = 'America/Sao_Paulo'
 where id = (select loja_a from tests.lojas);

-- ------------------------------------------ registrar_evento_de_carrinho

-- Sem automação ligada ainda: o evento entra, mas nada é agendado.
set role service_role;

drop table if exists tests.evento;
create table tests.evento as
select * from public.registrar_evento_de_carrinho(
  (select app_a from tests.lojas), 'sub-do-cliente', 'add', 2, 'token-do-carrinho', 9900, 'BRL'
);

select tests.ok('carrinho',
  (select event_id is not null and not agendou and not limitado from tests.evento),
  'sem automação de abandono, o evento entra e nada é agendado');

select tests.ok('carrinho',
  (select item_count = 2 and value_cents = 9900 and currency = 'BRL'
     from public.cart_events where id = (select event_id from tests.evento)),
  'o evento grava o que o app mandou, sem completar nada');

reset role;

-- Agora com a automação ligada.
-- O grupo 10 já criou esta automação pelo painel; aqui ela só é ligada com um
-- atraso conhecido, porque `unique (app_id, type)` garante uma por app.
insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'abandoned_cart', true, 60,
       'Esqueceu algo?', 'Seu carrinho continua aqui.'
from tests.lojas
on conflict (app_id, type) do update
  set enabled = true, delay_minutes = 60;

drop table if exists tests.automacao;
create table tests.automacao as
select id from public.push_automations
 where app_id = (select app_a from tests.lojas) and type = 'abandoned_cart';

grant select on tests.automacao to service_role;

set role service_role;

select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 2, 'token-do-carrinho')),
  'com a automação ligada, o carrinho agenda o push');

select tests.ok('carrinho',
  tests.contar($q$select count(*) from public.automation_runs
    where automation_id = (select id from tests.automacao) and status = 'scheduled'$q$) = 1,
  'e há exatamente um agendamento');

select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'update', 3, 'token-do-carrinho')),
  'mexer no carrinho de novo continua agendando');

select tests.ok('carrinho',
  tests.contar($q$select count(*) from public.automation_runs
    where automation_id = (select id from tests.automacao) and status = 'scheduled'$q$) = 1,
  'mas REAGENDA: continua um só, não cinco pushes por um carrinho');

reset role;

-- O horário agendado respeita a janela de silêncio DA LOJA. Em vez de esperar
-- a madrugada chegar, o teste escolhe um fuso que já esteja nela agora — a
-- Terra sempre tem um.
update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from (now() + interval '60 minutes') at time zone name) not between 8 and 21
     and name like 'America/%'
   limit 1
) where id = (select loja_a from tests.lojas);

set role service_role;

select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'update', 4, 'token-do-carrinho')),
  'o carrinho da madrugada também agenda');

reset role;

select tests.ok('carrinho',
  (select extract(hour from r.scheduled_for at time zone s.timezone) = 8
     from public.automation_runs r, public.stores s
    where r.automation_id = (select id from tests.automacao)
      and r.status = 'scheduled'
      and s.id = (select loja_a from tests.lojas)),
  'mas para as 8h da manhã do fuso da loja, não para a madrugada');

-- De volta a um fuso em horário comercial: o push sai na hora.
update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from (now() + interval '60 minutes') at time zone name) between 9 and 20
     and name like 'America/%'
   limit 1
) where id = (select loja_a from tests.lojas);

set role service_role;

select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'update', 5, 'token-do-carrinho')),
  'em horário comercial o carrinho também agenda');

reset role;

select tests.ok('carrinho',
  (select r.scheduled_for between now() + interval '55 minutes' and now() + interval '65 minutes'
     from public.automation_runs r
    where r.automation_id = (select id from tests.automacao) and r.status = 'scheduled'),
  'e aí o horário é o do atraso configurado, sem adiamento');

-- ------------------------------------------------------ o que cancela

set role service_role;

drop table if exists tests.compra;
create table tests.compra as
select * from public.registrar_evento_de_carrinho(
  (select app_a from tests.lojas), 'sub-do-cliente', 'purchased', 5, 'token-outro-carrinho'
);

select tests.ok('carrinho',
  (select cancelou = 1 and not agendou from tests.compra),
  'a compra cancela o push de carrinho abandonado');

select tests.ok('carrinho',
  tests.contar($q$select count(*) from public.automation_runs
    where automation_id = (select id from tests.automacao) and status = 'scheduled'$q$) = 0,
  'e não sobra agendamento nenhum');

select tests.ok('carrinho',
  (select canceled_reason = 'compra concluída' from public.automation_runs
    where automation_id = (select id from tests.automacao) and status = 'canceled'
    order by created_at desc limit 1),
  'com o motivo registrado, para o suporte entender depois');

-- Carrinho esvaziado não é abandono.
select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 1, 'token-terceiro')),
  'um carrinho novo agenda de novo');

select tests.ok('carrinho',
  (select cancelou = 1 and not agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'update', 0, 'token-terceiro')),
  'esvaziar o carrinho cancela: carrinho vazio não é carrinho esquecido');

reset role;

-- ----------------------------------------------- o teto de 24 horas

-- Um push de carrinho já enviado há pouco impede o próximo.
insert into public.automation_runs (automation_id, device_id, status, scheduled_for, sent_at)
select (select id from tests.automacao), (select device_id from tests.aparelho),
       'sent', now() - interval '2 hours', now() - interval '2 hours';

set role service_role;

select tests.ok('carrinho',
  (select not agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 2, 'token-quarto')),
  'quem recebeu um push de carrinho hoje não recebe outro');

reset role;

update public.automation_runs set sent_at = now() - interval '30 hours'
 where status = 'sent' and automation_id = (select id from tests.automacao);

set role service_role;

select tests.ok('carrinho',
  (select agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 2, 'token-quinto')),
  'passadas as 24 horas, volta a agendar');

reset role;

-- --------------------------------------- automação desligada e aparelho novo

update public.push_automations set enabled = false
 where id = (select id from tests.automacao);

set role service_role;

select tests.ok('carrinho',
  (select not agendou and event_id is not null from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 1, 'token-sexto')),
  'automação desligada: o evento entra, o push não é agendado');

-- Mesmo desligada, a compra ainda cancela o que ficou agendado de antes.
select tests.ok('carrinho',
  (select cancelou >= 1 from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'purchased', 1, 'token-sexto')),
  'desligar a automação no meio do caminho não deixa push órfão sair');

select tests.ok('carrinho',
  (select event_id is not null and not agendou from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-desconhecido', 'add', 1, 'token-sem-dono')),
  'evento de aparelho desconhecido entra para a análise, sem agendar push');

select tests.ok('carrinho',
  (select device_id is null from public.cart_events
    where cart_token = 'token-sem-dono'),
  'e fica sem aparelho, em vez de grudar no aparelho errado');

reset role;

-- O limite de eventos vale igual.
update public.rate_limits set contagem = 100000
 where chave = 'eventos:' || (select app_a from tests.lojas)::text;

set role service_role;

select tests.ok('carrinho',
  (select limitado and event_id is null from public.registrar_evento_de_carrinho(
    (select app_a from tests.lojas), 'sub-do-cliente', 'add', 1, 'token-da-enxurrada')),
  'passado o limite de eventos, nada entra');

select tests.ok('carrinho',
  tests.contar($q$select count(*) from public.cart_events
    where cart_token = 'token-da-enxurrada'$q$) = 0,
  'e o evento realmente não foi gravado');

reset role;

-- ------------------------------------------------ caixa de avisos (M07)

-- As campanhas saem AGORA, depois de o aparelho já existir. Uma enviada antes
-- da instalação é o caso testado logo abaixo, e ele tem fixture própria.
insert into public.push_campaigns (app_id, title, body, status, sent_at, segment)
select app_a, 'Promoção de inverno', 'Até 40% OFF.', 'sent', now(), '{}'::jsonb
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, sent_at, segment)
select app_a, 'Antes do app', 'Isto é de antes.', 'sent', now() - interval '365 days', '{}'::jsonb
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, sent_at, segment)
select app_a, 'Só para VIPs', 'Preço especial.', 'sent', now(), '{"tag":"vip"}'::jsonb
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, segment)
select app_a, 'Rascunho', 'Ainda não saiu.', 'draft', '{}'::jsonb
from tests.lojas;

/*
 * Uma campanha que FALHOU no envio tem `sent_at` preenchido — a tentativa
 * aconteceu. É o único caso em que só o `status` separa o que o cliente viu do
 * que ele não viu: sem a checagem, a caixa mostraria um aviso que nunca saiu
 * do servidor, e o cliente cobraria o lojista por uma promoção inexistente.
 */
insert into public.push_campaigns (app_id, title, body, status, sent_at, segment)
select app_a, 'Falhou no envio', 'Ninguém recebeu isto.', 'failed', now(), '{}'::jsonb
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, sent_at, segment)
select app_a, 'Cancelada', 'O lojista desistiu.', 'canceled', now(), '{}'::jsonb
from tests.lojas;

set role service_role;

select tests.ok('avisos',
  exists (
    select 1 from public.caixa_de_avisos((select app_a from tests.lojas), 'sub-do-cliente')
     where title = 'Promoção de inverno'
  ),
  'a caixa mostra a campanha enviada para todos');

select tests.ok('avisos',
  (select title from public.caixa_de_avisos(
    (select app_a from tests.lojas), 'sub-do-cliente') limit 1) = 'Promoção de inverno',
  'e a mais recente vem primeiro');

/*
 * Campanha com segmento foi para um recorte de clientes, e a segmentação
 * acontece dentro do OneSignal — a Storefy não sabe quem estava nele. Mostrá-la
 * a todos poria na caixa de um cliente uma oferta que não era para ele.
 */
select tests.ok('avisos',
  not exists (
    select 1 from public.caixa_de_avisos((select app_a from tests.lojas), 'sub-do-cliente')
     where title = 'Só para VIPs'
  ),
  'campanha com segmento NÃO entra na caixa de ninguém');

select tests.ok('avisos',
  not exists (
    select 1 from public.caixa_de_avisos((select app_a from tests.lojas), 'sub-do-cliente')
     where title = 'Antes do app'
  ),
  'campanha anterior à instalação não entra: aquela promoção já acabou');

select tests.ok('avisos',
  not exists (
    select 1 from public.caixa_de_avisos((select app_a from tests.lojas), 'sub-do-cliente')
     where title = 'Rascunho'
  ),
  'rascunho não vaza pela caixa de avisos');

select tests.ok('avisos',
  not exists (
    select 1 from public.caixa_de_avisos((select app_a from tests.lojas), 'sub-do-cliente')
     where title in ('Falhou no envio', 'Cancelada')
  ),
  'campanha que falhou ou foi cancelada não aparece como se tivesse chegado');

/*
 * Aparelho desconhecido não recebe lista nenhuma. Devolver as campanhas aqui
 * faria deste endpoint uma forma de ler o que qualquer loja anunciou sem nunca
 * ter instalado o app dela.
 */
select tests.ok('avisos',
  tests.contar($q$select count(*) from public.caixa_de_avisos(
    (select app_a from tests.lojas), 'nunca-instalou')$q$) = 0,
  'aparelho desconhecido não lê a caixa de ninguém');

select tests.ok('avisos',
  tests.contar($q$select count(*) from public.caixa_de_avisos(
    (select app_b from tests.lojas), 'sub-do-cliente')$q$) = 0,
  'a inscrição de uma loja não abre a caixa da outra');

reset role;

select tests.ok('permissões',
  not has_function_privilege('authenticated', 'public.caixa_de_avisos(uuid, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.caixa_de_avisos(uuid, text, integer)', 'execute'),
  'a caixa de avisos é só da service role');

-- ------------------------------------------------ o despacho (jobs)

-- Limpa o que os testes anteriores deixaram agendado, para as contagens
-- daqui falarem só do que esta seção cria.
update public.automation_runs set status = 'canceled', canceled_reason = 'limpeza do teste'
 where status = 'scheduled';
delete from public.push_campaigns where app_id = (select app_a from tests.lojas);

-- Um aparelho só desta seção: reaproveitar os de cima faria o teto de 24h
-- cancelar os envios daqui e o teste medir a coisa errada.
drop table if exists tests.aparelho_do_job;
create table tests.aparelho_do_job as
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-do-despacho', 'ios'
);
grant select on tests.aparelho_do_job to service_role;

insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
select app_a, 'Vencida', 'Deveria sair agora.', 'scheduled', now() - interval '1 minute'
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
select app_a, 'Ainda não', 'Sai amanhã.', 'scheduled', now() + interval '1 day'
from tests.lojas;

set role service_role;

drop table if exists tests.reservadas;
create table tests.reservadas as select * from public.reservar_campanhas(20);

select tests.ok('despacho',
  (select count(*) from tests.reservadas) = 1,
  'o job pega a campanha vencida');

select tests.ok('despacho',
  (select title from tests.reservadas) = 'Vencida',
  'e não pega a que ainda não venceu');

/*
 * A asserção mais importante desta suíte. Duas execuções do cron ao mesmo
 * tempo mandando a mesma campanha significam a base inteira de uma loja
 * recebendo o push duas vezes — e isso não tem desfazer.
 */
select tests.ok('despacho',
  tests.contar('select count(*) from public.reservar_campanhas(20)') = 0,
  'a segunda execução NÃO pega a mesma campanha de novo');

reset role;

select tests.ok('despacho',
  (select status = 'sending' from public.push_campaigns where title = 'Vencida'),
  'a campanha reservada fica marcada como enviando');

set role service_role;

select public.concluir_campanha(
  (select id from tests.reservadas), 'notificacao-1', '{"enviados":10}'::jsonb
);

reset role;

select tests.ok('despacho',
  (select status = 'sent' and onesignal_notification_id = 'notificacao-1'
     and sent_at is not null and stats->>'enviados' = '10'
     from public.push_campaigns where title = 'Vencida'),
  'concluir grava o envio, o id da notificação e o que a OneSignal respondeu');

-- ------------------------------------ campanha presa pela queda do job

/*
 * `updated_at` tem trigger que o reescreve para `now()` a cada UPDATE, então a
 * única forma de simular uma reserva antiga é desligando o gatilho. Vale a
 * pena: sem este teste, `devolver_campanhas_presas` seria código que ninguém
 * nunca viu rodar — e ele só entra em ação no dia em que o job cai.
 */
insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
select app_a, 'Presa', 'Ficou travada.', 'scheduled', now() - interval '1 minute'
from tests.lojas;

alter table public.push_campaigns disable trigger push_campaigns_set_updated_at;
update public.push_campaigns
   set status = 'sending', updated_at = now() - interval '30 minutes'
 where title = 'Presa';
alter table public.push_campaigns enable trigger push_campaigns_set_updated_at;

-- E uma reservada agora mesmo, que NÃO pode ser arrancada do job que a processa.
update public.push_campaigns set status = 'sending' where title = 'Ainda não';

set role service_role;

select tests.ok('despacho',
  public.devolver_campanhas_presas(15) = 1,
  'campanha presa em "enviando" volta para a fila — e só ela');

reset role;

select tests.ok('despacho',
  (select status = 'scheduled' from public.push_campaigns where title = 'Presa'),
  'ela volta como agendada, de onde o job a pega de novo');

select tests.ok('despacho',
  (select status = 'sending' from public.push_campaigns where title = 'Ainda não'),
  'e a reservada há pouco continua com o job que a está processando');

update public.push_campaigns set status = 'scheduled' where title = 'Ainda não';
update public.push_campaigns set status = 'canceled' where title = 'Presa';

-- ------------------------------------ envios de automação

update public.push_automations set enabled = true, delay_minutes = 60
 where app_id = (select app_a from tests.lojas) and type = 'abandoned_cart';
update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from now() at time zone name) between 9 and 20
     and name like 'America/%'
   limit 1
) where id = (select loja_a from tests.lojas);

insert into public.automation_runs (automation_id, device_id, scheduled_for)
select (select id from tests.automacao), (select device_id from tests.aparelho_do_job),
       now() - interval '1 minute';

set role service_role;

drop table if exists tests.envios;
create table tests.envios as select * from public.reservar_envios_de_automacao(100);

select tests.ok('despacho',
  (select count(*) from tests.envios) = 1,
  'o job pega o envio de automação vencido');

select tests.ok('despacho',
  (select subscription_id = 'sub-do-despacho' and title is not null from tests.envios),
  'com a inscrição do aparelho e o texto da automação');

select tests.ok('despacho',
  tests.contar('select count(*) from public.reservar_envios_de_automacao(100)') = 0,
  'e a segunda execução não pega o mesmo envio');

select public.concluir_envio((select id from tests.envios));

reset role;

select tests.ok('despacho',
  (select status = 'sent' and sent_at is not null from public.automation_runs
    where id = (select id from tests.envios)),
  'concluir marca o envio como enviado');

/*
 * O teto de 24 horas é conferido de novo AQUI porque entre agendar e enviar
 * passa pelo menos uma hora — e nesse meio-tempo outro envio pode ter saído.
 * Sem esta reconferência o cliente receberia dois lembretes de carrinho no
 * mesmo dia.
 */
insert into public.automation_runs (automation_id, device_id, scheduled_for)
select (select id from tests.automacao), (select device_id from tests.aparelho_do_job),
       now() - interval '1 minute';

set role service_role;

select tests.ok('despacho',
  tests.contar('select count(*) from public.reservar_envios_de_automacao(100)') = 0,
  'quem já recebeu um push de carrinho hoje não recebe o segundo');

reset role;

select tests.ok('despacho',
  (select canceled_reason = 'já recebeu um push de carrinho hoje'
     from public.automation_runs
    where automation_id = (select id from tests.automacao) and status = 'canceled'
    order by created_at desc limit 1),
  'e o envio repetido é cancelado com o motivo escrito');

-- ------------------------------------ automação desligada e madrugada

-- Um aparelho novo, sem envio nenhum no histórico, para o teto de 24 horas
-- não mascarar o que estas duas asserções medem.
drop table if exists tests.aparelho_da_madrugada;
create table tests.aparelho_da_madrugada as
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-da-madrugada-job', 'android'
);
grant select on tests.aparelho_da_madrugada to service_role;

update public.push_automations set enabled = false
 where id = (select id from tests.automacao);
insert into public.automation_runs (automation_id, device_id, scheduled_for)
select (select id from tests.automacao), (select device_id from tests.aparelho_da_madrugada),
       now() - interval '1 minute';

set role service_role;

select tests.ok('despacho',
  tests.contar('select count(*) from public.reservar_envios_de_automacao(100)') = 0,
  'automação desligada não dispara o que já estava agendado');

reset role;
update public.push_automations set enabled = true
 where id = (select id from tests.automacao);

/*
 * O job pode atrasar por queda ou deploy. Um envio que vence durante a
 * madrugada é ADIADO para as 8h em vez de sair — acordar o cliente com uma
 * mensagem de carrinho é o caminho mais curto para a desinstalação.
 */
update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from now() at time zone name) not between 8 and 21
     and name like 'America/%'
   limit 1
) where id = (select loja_a from tests.lojas);

set role service_role;

select tests.ok('despacho',
  tests.contar('select count(*) from public.reservar_envios_de_automacao(100)') = 0,
  'envio vencido na madrugada NÃO sai');

reset role;

-- Filtra pela automação: `registrar_aparelho` também deixa um envio de
-- boas-vindas agendado para este aparelho, e ele não é o que se mede aqui.
select tests.ok('despacho',
  (select extract(hour from r.scheduled_for at time zone s.timezone) = 8
     from public.automation_runs r, public.stores s
    where r.device_id = (select device_id from tests.aparelho_da_madrugada)
      and r.automation_id = (select id from tests.automacao)
      and r.status = 'scheduled'
      and s.id = (select loja_a from tests.lojas)),
  'ele é adiado para as 8h do fuso da loja');

update public.stores set timezone = 'America/Sao_Paulo'
 where id = (select loja_a from tests.lojas);

-- Envio preso pela queda do job volta para a fila.
update public.automation_runs set claimed_at = now() - interval '30 minutes'
 where device_id = (select device_id from tests.aparelho_da_madrugada)
   and automation_id = (select id from tests.automacao)
   and status = 'scheduled';

set role service_role;

select tests.ok('despacho',
  public.devolver_envios_presos(15) >= 1,
  'envio preso pela queda do job volta para a fila');

reset role;

select tests.ok('despacho',
  (select claimed_at is null from public.automation_runs
    where device_id = (select device_id from tests.aparelho_da_madrugada)
      and automation_id = (select id from tests.automacao)
      and status = 'scheduled'),
  'e volta sem reserva, de onde o job o pega de novo');

-- ------------------------------------------------ estatísticas

set role service_role;

select tests.ok('despacho',
  exists (
    select 1 from public.campanhas_para_estatistica(50)
     where onesignal_notification_id = 'notificacao-1'
  ),
  'a campanha enviada entra na fila de estatística');

select public.gravar_estatistica(
  (select id from tests.reservadas), '{"entregues":9,"abertos":3}'::jsonb
);

reset role;

select tests.ok('despacho',
  (select stats->>'entregues' = '9' and stats->>'abertos' = '3' and stats->>'enviados' = '10'
     from public.push_campaigns where title = 'Vencida'),
  'gravar estatística soma ao que já havia, em vez de substituir');

-- Depois de 48h os números param de mexer; continuar consultando gastaria a
-- cota da API da loja sem mudar nada na tela.
update public.push_campaigns set sent_at = now() - interval '3 days' where title = 'Vencida';

set role service_role;

select tests.ok('despacho',
  not exists (
    select 1 from public.campanhas_para_estatistica(50)
     where onesignal_notification_id = 'notificacao-1'
  ),
  'campanha de três dias atrás não gasta mais cota da API da loja');

reset role;

select tests.ok('permissões',
  not has_function_privilege('authenticated', 'public.reservar_campanhas(integer)', 'execute')
    and not has_function_privilege('anon', 'public.reservar_campanhas(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.concluir_campanha(uuid, text, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.reservar_envios_de_automacao(integer)', 'execute'),
  'o despacho é só da service role: ninguém dispara push pelo PostgREST');

-- ------------------------------------------------ builds (fase 4)

insert into public.builds (app_id, platform, profile, status, version, build_number)
select app_a, 'ios', 'production', 'queued', '1.0.0', 1 from tests.lojas;
insert into public.builds (app_id, platform, profile, status)
select app_b, 'android', 'production', 'queued' from tests.lojas;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('builds',
  tests.contar('select count(*) from public.builds') = 1,
  'o lojista vê os builds do próprio app');

/*
 * Publicar é ação de servidor, que valida o checklist inteiro antes de criar a
 * linha. Deixar o navegador inserir direto permitiria pular a validação e
 * mandar para a Apple um app sem ícone — que volta rejeitado dias depois.
 */
select tests.ok('builds',
  tests.bloqueado($q$insert into public.builds (app_id, platform)
    values ((select app_a from tests.lojas), 'ios')$q$),
  'nem o owner insere build pelo painel');

/*
 * O histórico de builds é a trilha do que foi mandado para as lojas de
 * aplicativos. Apagar um build rejeitado é justamente o que ninguém pode
 * fazer, nem quem é dono da loja.
 */
select tests.ok('builds',
  tests.bloqueado('delete from public.builds'),
  'e ninguém apaga build: o histórico é a trilha');

select tests.ok('builds',
  tests.bloqueado($q$update public.builds set status = 'approved'$q$),
  'nem muda o status na mão para fingir que foi aprovado');

reset role;

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.builds') = 1,
  'B vê só o build da própria loja');

select tests.ok('isolamento',
  not exists (
    select 1 from public.builds b
     where b.app_id = (select app_a from tests.lojas)
  ),
  'e não enxerga nenhum build de A');

reset role;
select tests.logout();
set role anon;

select tests.ok('builds',
  tests.contar('select count(*) from public.builds') = 0,
  'anon não lê build nenhum');

reset role;

select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.contar('select count(*) from public.builds') = 2,
  'o admin da Storefy vê a fila de builds de todo mundo (A05)');

reset role;
select tests.logout();

select tests.ok('auditoria',
  exists (
    select 1 from public.audit_logs
     where entity = 'builds' and action = 'create'
  ),
  'pedir um build fica na trilha de auditoria');

-- ------------------------------------------ assets no Storage (C06a)

/*
 * O caminho do arquivo é `<store_id>/<arquivo>`, e é dele que as policies
 * tiram de quem é. O ataque óbvio é enviar um arquivo com o id de OUTRA loja
 * no caminho — e é exatamente isso que as asserções abaixo tentam.
 */
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('assets',
  tests.permitido($q$insert into storage.objects (bucket_id, name)
    values ('app-assets', (select loja_a from tests.lojas)::text || '/icon.png')$q$),
  'o owner envia o ícone da própria loja');

/*
 * Este é o teste que importa: nada impede o navegador de mandar um caminho
 * com o id de outra loja. Quem barra é a policy, e só ela.
 */
select tests.ok('assets',
  tests.bloqueado($q$insert into storage.objects (bucket_id, name)
    values ('app-assets', (select loja_b from tests.lojas)::text || '/icon.png')$q$),
  'mas NÃO consegue enviar para a pasta da loja de outra organização');

select tests.ok('assets',
  tests.contar($q$select count(*) from storage.objects
    where bucket_id = 'app-assets'$q$) = 1,
  'e enxerga só os arquivos da própria loja');

reset role;

-- Um arquivo da loja B, criado por fora (como faria a service role).
insert into storage.objects (bucket_id, name)
select 'app-assets', loja_b::text || '/icon.png' from tests.lojas;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar($q$select count(*) from storage.objects
    where bucket_id = 'app-assets'$q$) = 1,
  'o arquivo da outra organização não aparece para A');

select tests.ok('assets',
  tests.bloqueado($q$delete from storage.objects
    where name like (select loja_b from tests.lojas)::text || '%'$q$),
  'nem dá para apagar o ícone da loja de outra organização');

reset role;

-- Member não manda ícone: trocar a marca do app é decisão de quem responde
-- pela organização, o mesmo critério de publicar.
select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('papéis',
  tests.bloqueado($q$insert into storage.objects (bucket_id, name)
    values ('app-assets', (select loja_a from tests.lojas)::text || '/outro.png')$q$),
  'member NÃO troca o ícone do app');

select tests.ok('papéis',
  tests.bloqueado($q$update storage.objects set updated_at = now()
    where bucket_id = 'app-assets'
      and name like (select loja_a from tests.lojas)::text || '%'$q$),
  'nem troca o arquivo que já está lá');

select tests.ok('papéis',
  tests.bloqueado($q$delete from storage.objects
    where bucket_id = 'app-assets'
      and name like (select loja_a from tests.lojas)::text || '%'$q$),
  'nem apaga o ícone da própria loja');

select tests.ok('assets',
  tests.contar($q$select count(*) from storage.objects
    where bucket_id = 'app-assets'$q$) = 1,
  'mas enxerga o que existe na loja dele');

reset role;
select tests.logout();
set role anon;

select tests.ok('assets',
  tests.contar($q$select count(*) from storage.objects
    where bucket_id = 'app-assets'$q$) = 0,
  'anon não lê asset nenhum: o bucket é privado');

reset role;

select tests.ok('assets',
  (select not public from storage.buckets where id = 'app-assets'),
  'e o bucket está mesmo marcado como privado');

-- --------------------------------------------- nada disso vaza para a org B

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.automation_runs') = 0,
  'B não enxerga os agendamentos de A');

reset role;
select tests.logout();

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
