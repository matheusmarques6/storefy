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
