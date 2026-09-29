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

-- E o par que faltava: segredo também NÃO SE ESCREVE pelo painel.
--
-- Ler é o risco óbvio, escrever é o silencioso. Com `update` aberto, o dono da
-- organização sobrescreve o token da Shopify, o segredo do app ou as chaves
-- Apple/Google direto pelo PostgREST — sem passar por linha nenhuma do nosso
-- código, e portanto sem auditoria e sem log. Quem grava essas colunas é a
-- service role, sempre.
select tests.ok('segredo',
  not exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and a.attnum > 0 and not a.attisdropped
       and a.attname like '%\_enc'
       and (has_column_privilege('authenticated', c.oid, a.attnum, 'insert')
         or has_column_privilege('authenticated', c.oid, a.attnum, 'update')
         or has_column_privilege('anon', c.oid, a.attnum, 'insert')
         or has_column_privilege('anon', c.oid, a.attnum, 'update'))
  ),
  'NENHUMA coluna _enc do schema é gravável por quem tem sessão');

-- O espelho da asserção de leitura: uma coluna nova nas três tabelas de grant
-- coluna a coluna nasce sem INSERT e sem UPDATE, e o sintoma é o painel parar
-- de salvar aquele campo sem erro nenhum na tela.
--
-- A LISTA DE EXCEÇÕES É NOMINAL de propósito. Existe uma terceira categoria
-- de coluna, além de "do painel" e "segredo": a que não é segredo mas só o
-- SERVIDOR escreve, depois de ter falado com a Shopify. Dar insert/update
-- delas ao painel deixaria o dono da organização declarar-se conectado a uma
-- loja que nunca autorizou nada.
--
-- Nominal, e não por prefixo, porque o risco de uma lista larga é justamente
-- o que esta asserção existe para pegar: alguém acrescenta uma coluna do
-- painel, ela cai na exceção por acidente e o campo para de salvar em
-- silêncio. Uma coluna nova aqui é uma decisão, e não um padrão de nome.
select tests.ok('segredo',
  not exists (
    select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('stores', 'developer_accounts')
       and a.attnum > 0 and not a.attisdropped
       and a.attname not like '%\_enc'
       -- Só o servidor grava: quem conecta é a rota, com a resposta da Shopify.
       and (c.relname, a.attname) not in (
         ('stores', 'shopify_conexao'),
         ('stores', 'shopify_client_id'),
         ('stores', 'shopify_token_expires_at'),
         -- O status vem dos builds, por gatilho (migration 53): o dono não se
         -- declara "No ar".
         ('stores', 'status')
       )
       and not (has_column_privilege('authenticated', c.oid, a.attnum, 'insert')
            and has_column_privilege('authenticated', c.oid, a.attnum, 'update'))
  ),
  'e toda coluna que NÃO é segredo continua gravável pelo painel');

-- `apps` é o contrário (migration 51): o app nasce com a loja, e o que ele tem
-- — identificador, nome, projeto do Expo, app do OneSignal, vínculo dos links —
-- só o servidor escreve, depois de conferir. A sessão grava DUAS colunas, e a
-- lista é nominal: uma terceira aqui é uma decisão, não um acidente.
select tests.ok('segredo',
  (select array_agg(a.attname::text order by a.attname)
     from pg_attribute a
    where a.attrelid = 'public.apps'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update'))
  = array['android_cert_fingerprints', 'current_config_version'],
  'no app, a sessão só grava as impressões do Android e a versão no ar');

select tests.ok('segredo',
  not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.apps'::regclass
       and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')
  ),
  'e não cria app: ele nasce com a loja');

-- E as três da exceção precisam ser LEGÍVEIS: a tela mostra por qual caminho a
-- loja conectou e qual app é. Sem o select, a página quebraria inteira — o
-- `COLUNAS_DA_LOJA` as pede por nome.
select tests.ok('segredo',
  tests.contar('select count(*) from public.stores where shopify_conexao is null') >= 1,
  'o painel lê o estado da conexão, mesmo sem poder gravá-lo');

-- E NÃO podem ser graváveis por ele. O espelho da exceção acima: sem isto, a
-- lista nominal viraria um buraco em vez de uma decisão.
select tests.ok('segredo',
  tests.erro($q$update public.stores set shopify_conexao = 'manual'$q$),
  'e não consegue declarar-se conectado por fora da rota');

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('segredo',
  tests.erro($q$update public.stores set shopify_access_token_enc = 'meu'$q$),
  'owner NÃO sobrescreve o token da Shopify');

select tests.ok('segredo',
  tests.erro($q$update public.apps set device_secret_enc = 'meu'$q$),
  'owner NÃO sobrescreve o segredo do app');

select tests.ok('segredo',
  tests.erro($q$update public.developer_accounts set apns_key_enc = 'minha'$q$),
  'owner NÃO sobrescreve a chave de push da Apple');

reset role;

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

/*
 * O horário agendado respeita a janela de silêncio DA LOJA. Em vez de esperar
 * a madrugada chegar, o teste escolhe um fuso que já esteja nela agora.
 *
 * A BUSCA É EM TODOS OS FUSOS, e não só nos das Américas. Os fusos do mundo
 * cobrem 26 horas de deslocamento, então sempre existe um em que agora é
 * madrugada; os das Américas cobrem 10, e entre umas 16h e 18h UTC NENHUM
 * deles está na janela — o `update` gravava null, o `not null` da coluna
 * estourava, e o teste falhava por causa da hora do dia em que rodou.
 */
select tests.ok('silêncio',
  exists (
    select 1 from pg_timezone_names
     where extract(hour from (now() + interval '60 minutes') at time zone name) not between 8 and 21
  ),
  'em algum lugar do mundo é madrugada agora');

update public.stores set timezone = (
  select name from pg_timezone_names
   where extract(hour from (now() + interval '60 minutes') at time zone name) not between 8 and 21
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
select app_a, 'Só para VIPs', 'Preço especial.', 'sent', now(), '{"publico":"compradores"}'::jsonb
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

/*
 * O e-mail de atendimento da loja (fase 4).
 *
 * Ele aparece na política de privacidade PÚBLICA de cada loja, e a coluna nova
 * precisa do grant coluna a coluna: o Postgres não estende grant de coluna
 * para colunas criadas depois, e sem isso o campo existiria no banco e seria
 * invisível para o painel — o mesmo defeito que `stores.timezone` teve.
 */
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('permissões',
  not tests.erro('select support_email from public.stores'),
  'o painel lê o e-mail de atendimento da loja');

select tests.ok('permissões',
  not tests.bloqueado($q$update public.stores set support_email = 'oi@loja.com.br'$q$),
  'e o owner consegue gravá-lo');

reset role;
select tests.logout();

/*
 * `anon` não tem grant NENHUM em `stores`: a consulta falha antes mesmo de a
 * RLS ser avaliada. Quem serve a política pública é o servidor, com a service
 * role, e devolvendo só três colunas.
 */
set role anon;
select tests.ok('isolamento',
  tests.erro('select support_email from public.stores'),
  'anon não alcança o e-mail de atendimento de loja nenhuma');
reset role;

/*
 * A revisão da Apple (fase 4).
 *
 * `builds_em_revisao` devolve a chave .p8 CIFRADA de cada loja, e
 * `gravar_revisao` escreve numa tabela que não tem policy de update. As duas
 * são do servidor; o navegador não pode chamar nenhuma delas.
 */
set role authenticated;
select tests.ok('segredo',
  tests.erro('select * from public.builds_em_revisao(10)'),
  'o lojista não chama builds_em_revisao, que carrega a chave da Apple');
select tests.ok('segredo',
  tests.erro($q$select public.gravar_revisao(gen_random_uuid(), 'approved', null)$q$),
  'nem gravar_revisao, que aprovaria o próprio app');
reset role;

set role anon;
select tests.ok('segredo',
  tests.erro('select * from public.builds_em_revisao(10)'),
  'anon também não');
reset role;

set role service_role;

-- A organização A conecta a conta Apple: sem ela o cron não tem com que
-- perguntar, e o build nem aparece na fila.
insert into public.developer_accounts (org_id, platform, status, asc_key_id, asc_issuer_id, asc_key_enc)
select org_a, 'apple', 'verified', 'KEY123', 'ISS-456', 'cifrado-de-mentira' from tests.ids;

-- O app precisa ter bundle: é por ele que a Apple é consultada. Um app sem
-- bundle não tem o que perguntar, e é por isso que a função o exclui.
update public.apps set bundle_id_ios = 'br.com.lojaa'
 where id = (select app_a from tests.lojas);
update public.apps set package_android = 'br.com.lojab'
 where id = (select app_b from tests.lojas);

update public.builds set status = 'submitted', submitted_at = now()
 where app_id = (select app_a from tests.lojas) and platform = 'ios';

drop table if exists tests.build_ios;
create table tests.build_ios as
select id from public.builds
 where app_id = (select app_a from tests.lojas) and platform = 'ios' limit 1;

/*
 * A função só devolve quem ESPERA decisão. Um build aprovado voltando na lista
 * faria o cron perguntar à Apple sobre ele de hora em hora para sempre,
 * gastando a cota da chave do lojista em algo que não muda mais.
 */
select tests.ok('revisão',
  tests.contar('select count(*) from public.builds_em_revisao(50)') = 1,
  'build de iOS esperando decisão entra na fila do cron');

/*
 * Um build de Android da MESMA LOJA, com a mesma conta Apple conectada, NÃO
 * entra: a trilha interna do Google não passa por revisão, e perguntar à Apple
 * sobre ele seria perguntar à loja errada. A loja é a mesma de propósito —
 * usar outra provaria só que a outra não tem conta Apple.
 */
insert into public.builds (app_id, platform, profile, status, submitted_at)
select app_a, 'android', 'production', 'submitted', now() from tests.lojas;

select tests.ok('revisão',
  tests.contar('select count(*) from public.builds_em_revisao(50)') = 1,
  'e o de Android da mesma loja não entra: a trilha do Google não tem revisão');

/*
 * Sem bundle não há o que perguntar: a Apple é consultada POR bundle. Deixar
 * o build na fila faria o cron gastar uma chamada por hora para descobrir a
 * mesma coisa toda vez.
 *
 * O app enviado não perde o identificador (a migration 51 trava), então o
 * caso é montado numa loja NOVA da mesma organização — com a mesma conta
 * Apple —, com um build de iPhone esperando decisão e sem identificador.
 */
insert into public.stores (org_id, name, primary_url)
select org_a, 'Loja sem Bundle', 'https://sembundle.teste' from tests.ids;
insert into public.builds (app_id, platform, profile, status, submitted_at)
select a.id, 'ios', 'production', 'submitted', now()
  from public.apps a join public.stores s on s.id = a.store_id
 where s.name = 'Loja sem Bundle';
select tests.ok('revisão',
  tests.contar('select count(*) from public.builds_em_revisao(50)') = 1,
  'app sem bundle fica fora da fila: não há o que perguntar à Apple');
delete from public.stores where name = 'Loja sem Bundle';

select tests.ok('revisão',
  tests.erro($q$select public.gravar_revisao(
    (select id from tests.build_ios), 'building', null)$q$),
  'gravar_revisao recusa status que não é decisão de revisão');

select tests.ok('revisão',
  (select public.gravar_revisao((select id from tests.build_ios), 'in_review', null)),
  'gravar_revisao move o build e diz que mudou');

/*
 * A segunda passada do cron com a MESMA resposta da Apple não pode dizer que
 * mudou. O build continua em revisão — estado de espera, então a trava de
 * estado final não entra aqui e quem responde é a comparação com o valor
 * anterior. Sem ela, uma versão parada em revisão por três dias geraria 72
 * avisos iguais ao lojista.
 */
select tests.ok('revisão',
  not (select public.gravar_revisao((select id from tests.build_ios), 'in_review', null)),
  'e não mente que mudou quando a Apple repete a mesma resposta');

select tests.ok('revisão',
  (select public.gravar_revisao((select id from tests.build_ios), 'approved', null)),
  'a decisão final move o build');

select tests.ok('revisão',
  not (select public.gravar_revisao((select id from tests.build_ios), 'approved', null)),
  'e repetir a decisão final não muda nada');

/*
 * Depois de aprovado, acabou. Um ciclo do cron rodando sobre dado velho não
 * pode voltar o build para "em revisão" — o lojista veria o app sair do ar na
 * tela sem nada ter acontecido.
 */
select tests.ok('revisão',
  not (select public.gravar_revisao((select id from tests.build_ios), 'in_review', null)),
  'build aprovado não volta para em revisão');

select tests.ok('revisão',
  tests.contar('select count(*) from public.builds_em_revisao(50)') = 0,
  'e sai da fila do cron');

/*
 * O aviso por e-mail. O cron roda de hora em hora: um "aprovado" que não fosse
 * marcado viraria 24 e-mails por dia para o mesmo lojista.
 */
select tests.ok('revisão',
  (select public.reservar_aviso((select id from tests.build_ios), 'approved')),
  'o primeiro ciclo reserva o aviso');

select tests.ok('revisão',
  not (select public.reservar_aviso((select id from tests.build_ios), 'approved')),
  'e o segundo não manda o mesmo e-mail de novo');

select tests.ok('revisão',
  not (select public.reservar_aviso((select id from tests.build_ios), 'rejected')),
  'nem avisa uma decisão diferente da que o build tem');

/*
 * Devolver é o que impede uma queda de dez minutos do serviço de e-mail de
 * fazer o lojista NUNCA saber que o app foi aprovado.
 */
select public.devolver_aviso((select id from tests.build_ios));
select tests.ok('revisão',
  (select public.reservar_aviso((select id from tests.build_ios), 'approved')),
  'devolver a reserva deixa a próxima hora tentar de novo');

/*
 * Para quem avisar: só quem decide sobre publicação. Um `member` recebendo
 * "seu app foi recusado" só gera confusão, porque ele não pode fazer nada.
 */
/*
 * A organização A tem owner, admin e member. O aviso vai para os dois
 * primeiros e não para o terceiro: um `member` recebendo "seu app foi
 * recusado" só gera confusão, porque ele não pode publicar.
 */
select tests.ok('revisão',
  (select count(*) from public.emails_do_build((select id from tests.build_ios))) = 2,
  'emails_do_build avisa owner e admin, e são dois');

select tests.ok('revisão',
  not exists (
    select 1 from public.emails_do_build((select id from tests.build_ios)) e
     where e.email = 'a-member@teste.local'
  ),
  'e não avisa quem não decide nada sobre publicação');

select tests.ok('revisão',
  (select count(*) from public.emails_do_build((select id from tests.build_ios)) e
    where e.email = 'b-owner@teste.local') = 0,
  'nem o dono de outra organização');

/*
 * E-mail não confirmado não recebe aviso.
 *
 * Um convite aceito mas nunca confirmado deixa um endereço que pode não ser da
 * pessoa. Mandar para ele o "seu app foi aprovado" de um cliente conta a um
 * estranho o que a loja está fazendo — e ainda queima a reputação do nosso
 * domínio de envio com um endereço que provavelmente rejeita.
 *
 * O usuário é criado e apagado aqui de propósito: somá-lo às fixturas mudaria
 * a contagem de meia dúzia de asserções que não têm nada a ver com isto.
 */
reset role;
insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
values ('nao-confirmado@teste.local', '{"company_name":"Nao Confirmado"}'::jsonb, null);
insert into public.memberships (org_id, user_id, role)
select org_a, (select id from auth.users where email = 'nao-confirmado@teste.local'), 'admin'
  from tests.ids;
set role service_role;

select tests.ok('revisão',
  not exists (
    select 1 from public.emails_do_build((select id from tests.build_ios)) e
     where e.email = 'nao-confirmado@teste.local'
  ),
  'e não avisa endereço que nunca foi confirmado');

/*
 * Sai só da organização A. Apagar o usuário inteiro levaria junto a
 * organização pessoal dele, onde ele é o único owner — e o gatilho que protege
 * o último owner derruba a transação.
 */
reset role;
delete from public.memberships
 where org_id = (select org_a from tests.ids)
   and user_id = (select id from auth.users where email = 'nao-confirmado@teste.local');
set role service_role;

/*
 * O nome da loja vem junto porque é ele que vai no assunto do e-mail — "O app
 * de Loja da Ana foi aprovado". Uma consulta separada para buscá-lo seria uma
 * ida ao banco a mais por aviso.
 */
select tests.ok('revisão',
  (select nome_da_loja from public.emails_do_build((select id from tests.build_ios)) limit 1)
    = (select name from public.stores where id = (select loja_a from tests.lojas)),
  'e leva o nome da loja, que vai no assunto do e-mail');

reset role;

set role authenticated;
select tests.ok('segredo',
  tests.erro($q$select * from public.emails_do_build(gen_random_uuid())$q$),
  'o navegador não lista os e-mails de uma organização');
select tests.ok('segredo',
  tests.erro($q$select public.reservar_aviso(gen_random_uuid(), 'approved')$q$),
  'nem reserva aviso de ninguém');
reset role;

set role service_role;

/*
 * Build parado há semanas sai da fila sozinho. A Apple às vezes simplesmente
 * não responde — app abandonado, conta cancelada, versão substituída — e sem
 * este corte o cron perguntaria por ele para sempre.
 */
update public.builds
   set status = 'submitted', submitted_at = now() - interval '30 days'
 where id = (select id from tests.build_ios);

select tests.ok('revisão',
  tests.contar('select count(*) from public.builds_em_revisao(50)') = 0,
  'build esquecido há um mês para de gastar cota da chave do lojista');

reset role;

set role service_role;
update public.builds set artifact_url = 'https://exemplo/app-da-loja-a.aab'
 where app_id = (select app_a from tests.lojas);
reset role;

/*
 * As colunas do envio (fase 4).
 *
 * `manual_action` decide qual passo a passo a tela mostra. Se o banco aceitasse
 * qualquer texto ali, um valor errado gravado por um workflow com bug viraria
 * um card em branco na tela do lojista — um erro que some sem dizer nada.
 */
select tests.ok('builds',
  tests.erro($q$update public.builds set manual_action = 'qualquer_coisa'$q$),
  'manual_action não aceita valor fora da lista');

select tests.ok('builds',
  not tests.erro($q$update public.builds set manual_action = 'play_primeiro_envio'$q$)
  and not tests.erro($q$update public.builds set manual_action = null$q$),
  'e aceita os valores que a tela sabe mostrar');

/*
 * O link do binário NÃO é segredo: é justamente o que o lojista baixa quando o
 * primeiro envio ao Google tem de ser manual. Ele precisa chegar à tela DELE —
 * e só dele. Um link assinado do binário de outra loja daria a um cliente o
 * app inteiro de um concorrente.
 */
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('builds',
  tests.contar('select count(*) from public.builds where artifact_url is not null') >= 1,
  'o lojista lê o link do binário do próprio build');

reset role;
select tests.logout();

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.builds where artifact_url is not null') = 0,
  'e o de outra organização não: o binário de um cliente não vaza para outro');

reset role;
select tests.logout();

-- --------------------------------- pedidos e analytics (fase 5)

set role service_role;

/*
 * A loja entra CONECTADA: `app_da_loja_shopify` só devolve app enquanto o
 * token existe, e sem gravá-lo aqui as asserções de baixo passariam a contar
 * zero por um motivo que não é o que elas testam.
 */
update public.stores
   set shop_domain = 'loja-a.myshopify.com',
       shopify_access_token_enc = 'token-cifrado-de-mentira',
       shopify_scopes = array['read_orders']
 where id = (select loja_a from tests.lojas);

select tests.ok('shopify',
  tests.contar($q$select count(*) from public.app_da_loja_shopify('loja-a.myshopify.com')$q$) = 1,
  'o webhook acha o app pelo domínio .myshopify.com');

select tests.ok('shopify',
  tests.contar($q$select count(*) from public.app_da_loja_shopify('LOJA-A.MyShopify.com  ')$q$) = 1,
  'e não se importa com maiúscula nem espaço, que é como a Shopify às vezes manda');

select tests.ok('shopify',
  tests.contar($q$select count(*) from public.app_da_loja_shopify('outra.myshopify.com')$q$) = 0,
  'loja que não é nossa não acha app nenhum');

/*
 * A Shopify REENTREGA webhook: ela desiste em 5 segundos e tenta de novo, e o
 * mesmo pedido chega duas, três vezes. Sem a trava, a receita do app apareceria
 * DOBRADA no painel — e o lojista confiaria no número.
 */
select tests.ok('shopify',
  (select public.registrar_pedido(
     (select app_a from tests.lojas), '12345', 'app', 14990, now(), '#1001', 'BRL', null)),
  'o primeiro pedido é gravado');

select tests.ok('shopify',
  not (select public.registrar_pedido(
     (select app_a from tests.lojas), '12345', 'app', 14990, now(), '#1001', 'BRL', null)),
  'e a reentrega do mesmo pedido não duplica a receita');

select tests.ok('shopify',
  tests.contar($q$select count(*) from public.shop_orders
                where shopify_order_id = '12345'$q$) = 1,
  'continua uma linha só');

/*
 * O aparelho é descoberto pelo token do carrinho que o app já reportou. É o
 * que liga o pedido ao aparelho sem o app precisar mandar nada na compra — ele
 * nem está aberto quando o webhook chega.
 */
insert into public.cart_events (app_id, device_id, cart_token, event, item_count)
select app_a, (select id from public.devices where app_id = (select app_a from tests.lojas) limit 1),
       'token-do-carrinho', 'add', 2
  from tests.lojas
 where exists (select 1 from public.devices where app_id = (select app_a from tests.lojas));

select tests.ok('shopify',
  (select public.registrar_pedido(
     (select app_a from tests.lojas), '99999', 'app', 5000, now(), '#1002', 'BRL',
     'token-do-carrinho')),
  'pedido com token de carrinho é gravado');

select tests.ok('shopify',
  (select device_id is not null from public.shop_orders where shopify_order_id = '99999')
  or not exists (select 1 from public.devices where app_id = (select app_a from tests.lojas)),
  'e ele fica ligado ao aparelho que montou aquele carrinho');

/*
 * O `/cart.js` devolve `<token>?key=<segredo>`, e a chave dá acesso aos dados
 * do comprador: a Shopify manda tratá-la como senha. O pedido do webhook vem
 * com o token SEM a chave — gravada de um lado só, o pedido nunca casaria com
 * o aparelho.
 */
insert into public.cart_events (app_id, device_id, cart_token, event, item_count)
select app_a, (select id from public.devices where app_id = (select app_a from tests.lojas) limit 1),
       'Z2NwLXVzLWVhc3Q?key=segredo-do-comprador', 'add', 1
  from tests.lojas;

select tests.ok('carrinho sem chave',
  tests.contar($q$select count(*) from public.cart_events where cart_token like '%segredo%'$q$) = 0,
  'a chave secreta do carrinho nunca fica guardada');

select tests.ok('carrinho sem chave',
  tests.contar($q$select count(*) from public.cart_events where cart_token = 'Z2NwLXVzLWVhc3Q'$q$) = 1,
  'o token fica, sem a chave');

select tests.ok('carrinho sem chave',
  (select public.registrar_pedido(
     (select app_a from tests.lojas), '99998', 'app', 7000, now(), '#1003', 'BRL',
     'Z2NwLXVzLWVhc3Q')),
  'o pedido do webhook, com o token sem a chave, é gravado');

select tests.ok('carrinho sem chave',
  (select device_id is not null from public.shop_orders where shopify_order_id = '99998')
  or not exists (select 1 from public.devices where app_id = (select app_a from tests.lojas)),
  'e casa com o aparelho que montou o carrinho');

update public.cart_events set cart_token = 'outro?key=mais-um-segredo'
 where cart_token = 'Z2NwLXVzLWVhc3Q';

select tests.ok('carrinho sem chave',
  tests.contar($q$select count(*) from public.cart_events where cart_token = 'outro'$q$) = 1,
  'nem numa atualização a chave entra');

insert into public.cart_events (app_id, cart_token, event, item_count)
select app_a, '?key=so-a-chave', 'add', 1 from tests.lojas;

select tests.ok('carrinho sem chave',
  tests.contar($q$select count(*) from public.cart_events
                where cart_token = '' or cart_token like '%so-a-chave%'$q$) = 0,
  'token que só tem a chave vira nulo, e não texto vazio');

/*
 * `shop/redact` chega 48 horas depois da desinstalação e é OBRIGATÓRIO: é o que
 * a lei de privacidade exige e o que a revisão do app da Shopify confere.
 */
select tests.ok('shopify',
  (select public.desconectar_shopify('loja-a.myshopify.com')),
  'app/uninstalled apaga o token da loja');

select tests.ok('segredo',
  (select shopify_access_token_enc is null and shopify_scopes is null
     from public.stores where id = (select loja_a from tests.lojas)),
  'e não sobra token morto guardado');

/*
 * E a busca do webhook para junto. O `shop_domain` continua gravado de
 * propósito — ele também é o domínio que o app libera na WebView —, então sem
 * esta condição um webhook atrasado viraria pedido atribuído numa loja que
 * desligou a integração, e a receita do app subiria sozinha.
 */
select tests.ok('shopify',
  tests.contar($q$select count(*) from public.app_da_loja_shopify('loja-a.myshopify.com')$q$) = 0,
  'e loja desconectada não acha mais app: webhook atrasado não vira pedido');

select tests.ok('shopify',
  (select public.apagar_dados_da_shopify('loja-a.myshopify.com')) >= 2,
  'shop/redact apaga os pedidos e os eventos de carrinho da loja');

select tests.ok('shopify',
  tests.contar($q$select count(*) from public.shop_orders
                where app_id = (select app_a from tests.lojas)$q$) = 0,
  'e não sobra pedido nenhum');

/*
 * Os eventos de carrinho também são dado da loja e também somem. Conferir só
 * os pedidos deixaria passar um `shop/redact` pela metade — que é exatamente o
 * que a revisão da Shopify procura.
 */
select tests.ok('shopify',
  tests.contar($q$select count(*) from public.cart_events
                where app_id = (select app_a from tests.lojas)$q$) = 0,
  'nem evento de carrinho');

/*
 * Loja que nunca existiu aqui não pode virar erro: a Shopify manda
 * `shop/redact` para lojas que desinstalaram antes de a gente as conhecer, e
 * responder erro nisso é motivo de recusa na revisão.
 */
select tests.ok('shopify',
  (select public.apagar_dados_da_shopify('nunca-existiu.myshopify.com')) = 0,
  'loja desconhecida no shop/redact devolve zero, e não erro');

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

set role service_role;
insert into public.shop_orders (app_id, shopify_order_id, source, total_cents, ordered_at)
select app_a, 'do-lojista', 'app', 10000, now() from tests.lojas;
insert into public.analytics_daily (app_id, day, orders_app, revenue_app_cents)
select app_a, current_date, 1, 10000 from tests.lojas;
reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('shopify',
  tests.contar('select count(*) from public.shop_orders') = 1,
  'o lojista vê os pedidos do próprio app');

select tests.ok('shopify',
  tests.contar('select count(*) from public.analytics_daily') = 1,
  'e os números diários dele');

/*
 * Os pedidos e os números são escritos por job e por webhook, com a service
 * role. Deixar o navegador inserir permitiria ao lojista inventar a própria
 * receita — o número que ele usa para decidir se renova a assinatura.
 */
select tests.ok('shopify',
  tests.bloqueado($q$insert into public.shop_orders (app_id, shopify_order_id, source, total_cents, ordered_at)
    values ((select app_a from tests.lojas), 'inventado', 'app', 999999, now())$q$),
  'mas não inventa pedido nenhum pelo painel');

select tests.ok('shopify',
  tests.bloqueado($q$update public.analytics_daily set revenue_app_cents = 999999$q$),
  'nem mexe nos próprios números');

select tests.ok('segredo',
  tests.erro('select * from public.app_da_loja_shopify($$x.myshopify.com$$)'),
  'nem usa as funções do webhook');

/*
 * `registrar_pedido` escreve a receita atribuída ao app — o número que o
 * lojista usa para decidir se renova a assinatura. Ele não pode escrevê-lo.
 */
select tests.ok('segredo',
  tests.erro($q$select public.registrar_pedido(
    (select app_a from tests.lojas), 'inventado', 'app', 999999, now())$q$),
  'nem grava pedido pela função do webhook');

select tests.ok('segredo',
  tests.erro($q$select public.apagar_dados_da_shopify('x.myshopify.com')$q$),
  'nem apaga os dados de uma loja qualquer');

reset role;
select tests.logout();

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.shop_orders') = 0
  and tests.contar('select count(*) from public.analytics_daily') = 0,
  'a receita de um cliente não aparece para outro');

reset role;
select tests.logout();

-- ------------------------------------------- correção OTA (fase 4)

set role service_role;

insert into public.ota_updates (message, triggered_by)
select 'Corrige o carrinho no iPhone', u_equipe from tests.ids;

/*
 * A lista que vira matriz de jobs no GitHub NÃO leva segredo: os nomes dos
 * jobs ficam visíveis para quem tem leitura no repositório.
 */
select tests.ok('ota',
  tests.contar('select count(*) from public.lojas_para_ota()') = 0,
  'loja sem projeto no Expo fica de fora: não há canal para publicar');

update public.apps set expo_project_id = 'proj-a' where id = (select app_a from tests.lojas);

select tests.ok('ota',
  tests.contar('select count(*) from public.lojas_para_ota()') = 1,
  'e a loja com projeto entra');

/*
 * O pacote da correção leva o número do app na App Store (migration 62): é
 * por ele que a atualização obrigatória (M11) abre a ficha do app, e os
 * binários gerados antes de o build gravá-lo só o recebem assim.
 */
update public.apps set ios_asc_app_id = '6470000001' where id = (select app_a from tests.lojas);

select tests.ok('ota',
  (select ios_asc_app_id = '6470000001' and expo_project_id = 'proj-a'
     from public.dados_da_ota((select loja_a from tests.lojas))),
  'dados_da_ota leva o número do app na App Store');

update public.apps set ios_asc_app_id = null where id = (select app_a from tests.lojas);

/*
 * Loja pausada não recebe correção. Publicar num canal de loja pausada gasta
 * cota do Expo por um app que ninguém está usando.
 */
update public.apps set expo_project_id = 'proj-b' where id = (select app_b from tests.lojas);
update public.stores set status = 'paused' where id = (select loja_b from tests.lojas);

select tests.ok('ota',
  tests.contar('select count(*) from public.lojas_para_ota()') = 1,
  'loja pausada fica de fora');

update public.stores set status = 'draft' where id = (select loja_b from tests.lojas);

/*
 * A soma é ATÔMICA no banco: os jobs da matriz correm em paralelo, e dois
 * terminando ao mesmo tempo escreveriam por cima um do outro se o contador
 * fosse lido e gravado em duas idas.
 */
select public.contar_ota((select id from public.ota_updates limit 1), true);
select public.contar_ota((select id from public.ota_updates limit 1), true);
select public.contar_ota((select id from public.ota_updates limit 1), false);

select tests.ok('ota',
  (select concluidas = 2 and falhas = 1 and status = 'running'
     from public.ota_updates limit 1),
  'contar_ota soma cada loja e põe a rodada em andamento');

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

/*
 * Uma correção OTA é ação da PLATAFORMA. Mostrá-la ao lojista contaria a ele
 * que outras lojas existem e quantas são.
 */
select tests.ok('ota',
  tests.contar('select count(*) from public.ota_updates') = 0,
  'o lojista não vê correção OTA nenhuma');

select tests.ok('segredo',
  tests.erro('select * from public.lojas_para_ota()'),
  'nem lista as lojas da plataforma');

select tests.ok('segredo',
  tests.erro($q$select * from public.dados_da_ota(gen_random_uuid())$q$),
  'nem busca o segredo do app de uma loja');

select tests.ok('segredo',
  tests.erro($q$select public.contar_ota(gen_random_uuid(), true)$q$),
  'nem mexe no andamento de uma rodada');

reset role;
select tests.logout();

select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.contar('select count(*) from public.ota_updates') = 1,
  'a equipe da Storefy vê as correções OTA');

reset role;
select tests.logout();

/*
 * A auditoria de uma correção OTA nasce SEM organização, e é o primeiro caso
 * assim: ela não pertence a nenhum cliente. Forçar uma org aqui atribuiria a
 * um deles uma ação que não foi dele.
 */
select tests.ok('auditoria',
  exists (
    select 1 from public.audit_logs
     where entity = 'ota_updates' and action = 'create' and org_id is null
  ),
  'publicar correção OTA fica na trilha, sem organização');

/*
 * O Realtime da tela de publicação (C12).
 *
 * Sem a tabela na publicação, o canal do painel sobe, não dá erro nenhum e
 * simplesmente nunca recebe evento — a tela congela mostrando "gerando" para
 * um app que já ficou pronto. É uma falha silenciosa, e por isso ela precisa
 * de asserção.
 */
select tests.ok('realtime',
  exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'builds'
  ),
  'builds está na publicação do Realtime');

/*
 * E entrar na publicação NÃO pode ter aberto a tabela: o Realtime só entrega
 * a linha a quem a policy de SELECT deixaria ler. Se a RLS de `builds` fosse
 * desligada, a tabela inteira passaria a ser transmitida para qualquer
 * assinante autenticado — de qualquer organização.
 */
select tests.ok('realtime',
  (select relrowsecurity from pg_class where oid = 'public.builds'::regclass),
  'e a RLS de builds continua ligada, que é o que o Realtime respeita');

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


-- ================================ grupo 14: números do dia (fase 5)
--
-- O que a tela C11 mostra vem daqui. Um número errado aqui não quebra nada e é
-- pior por isso: o lojista decide se continua pagando olhando para ele.

set role service_role;

-- A loja A volta a existir para a Shopify, com fuso conhecido.
update public.stores
   set shop_domain = 'loja-a.myshopify.com',
       timezone = 'America/Sao_Paulo',
       shopify_access_token_enc = 'token-cifrado-de-mentira',
       shopify_scopes = array['read_orders']
 where id = (select loja_a from tests.lojas);

delete from public.device_days where app_id = (select app_a from tests.lojas);
delete from public.analytics_daily where app_id = (select app_a from tests.lojas);
delete from public.shop_orders where app_id = (select app_a from tests.lojas);
delete from public.rate_limits where chave like 'aparelhos:%';

/*
 * Momento FIXO, escolhido onde os dois fusos discordam: 01h30 UTC ainda é o
 * dia anterior em São Paulo. Comparar com `now()` só acusaria o erro entre
 * meia-noite e três da manhã UTC — o teste passaria 87% do tempo, que é pior
 * do que não existir.
 */
select tests.ok('numeros',
  (select public.dia_da_loja(
     (select app_a from tests.lojas), timestamptz '2026-03-10 01:30:00+00'))
    = date '2026-03-09',
  'o dia do app é o dia NO FUSO DA LOJA, e não em UTC');

/*
 * A abertura é contada dentro de `registrar_aparelho`. Duas aberturas do mesmo
 * aparelho no mesmo dia são UMA linha com duas — é o que separa "ativos" de
 * "sessões", e o que impede a tabela de crescer por abertura.
 */
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-dos-numeros', 'ios'
);
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-dos-numeros', 'ios'
);
select * from public.registrar_aparelho(
  (select app_a from tests.lojas), 'sub-dos-numeros-2', 'android'
);

select tests.ok('numeros',
  tests.contar($q$select count(*) from public.device_days
    where app_id = (select app_a from tests.lojas)$q$) = 2,
  'dois aparelhos viram duas linhas de dia, e não uma por abertura');

select tests.ok('numeros',
  (select sum(opens) from public.device_days
    where app_id = (select app_a from tests.lojas)) = 3,
  'e as três aberturas foram somadas');

-- Um pedido de cada origem, hoje, no fuso da loja.
insert into public.shop_orders (app_id, shopify_order_id, source, total_cents, ordered_at)
select app_a, 'ped-app-1', 'app', 14990, now() from tests.lojas;
insert into public.shop_orders (app_id, shopify_order_id, source, total_cents, ordered_at)
select app_a, 'ped-site-1', 'site', 5000, now() from tests.lojas;

/*
 * Um pedido das 23h em São Paulo é 02h do dia SEGUINTE em UTC. Ele tem que
 * cair no dia de HOJE da loja — é exatamente aqui que o número do painel
 * deixaria de bater com o extrato da Shopify, por pouco e todo dia.
 */
insert into public.shop_orders (app_id, shopify_order_id, source, total_cents, ordered_at)
select app_a, 'ped-app-noite', 'app', 10,
       (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '23 hours')
         at time zone 'America/Sao_Paulo'
from tests.lojas;

/*
 * Duas campanhas enviadas hoje: uma com números da OneSignal e outra sem. A
 * segunda tem que contar ZERO — "ainda não sabemos" não vira número estimado
 * a partir da contagem de aparelhos (regra 1 do CLAUDE.md).
 */
insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_a, 'Promoção', 'Entra que tem novidade', 'sent', now(),
       '{"enviados": 10, "entregues": 9, "abertos": 4}'::jsonb
from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_a, 'Recém-enviada', 'Os números ainda não voltaram', 'sent', now(), '{}'::jsonb
from tests.lojas;

-- E uma de cinco dias atrás, para o dia de hoje não herdar o total de sempre.
insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_a, 'Antiga', 'Isto é de outro dia', 'sent', now() - interval '5 days',
       '{"enviados": 500, "abertos": 300}'::jsonb
from tests.lojas;

select tests.ok('numeros',
  public.consolidar_analytics(2) >= 1,
  'a consolidação escreve pelo menos um dia');

select tests.ok('numeros',
  (select push_sent = 10 and push_opened = 4 from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date),
  'o push soma o que a OneSignal reportou, e a campanha sem números conta zero');

select tests.ok('numeros',
  (select orders_app = 2 from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date),
  'o pedido das 23h da loja não vaza para o dia seguinte em UTC');

/*
 * Um aparelho na organização B, para a contagem do app A ter de EXCLUIR
 * alguém. Sem isso, um `count(*)` sem filtro de app daria o mesmo número e o
 * vazamento entre clientes passaria batido no teste.
 */
select * from public.registrar_aparelho(
  (select app_b from tests.lojas), 'sub-da-outra-org', 'ios'
);

select public.consolidar_analytics(2);

select tests.ok('numeros',
  (select installs from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date)
  = (select count(*) from public.devices d
      where d.app_id = (select app_a from tests.lojas)
        and (d.created_at at time zone 'America/Sao_Paulo')::date
            = (now() at time zone 'America/Sao_Paulo')::date),
  'instalações contam só os aparelhos DESTE app');

select tests.ok('numeros',
  (select installs from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date)
  < (select count(*) from public.devices d
      where (d.created_at at time zone 'America/Sao_Paulo')::date
            = (now() at time zone 'America/Sao_Paulo')::date),
  'e são MENOS do que os aparelhos de todas as lojas juntas');

select tests.ok('numeros',
  (select active_users = 2 and sessions = 3
     from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date),
  'ativos e sessões saem de device_days, e são coisas diferentes');

select tests.ok('numeros',
  (select orders_app = 2 and revenue_app_cents = 15000
      and orders_site = 1 and revenue_site_cents = 5000
     from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = (now() at time zone 'America/Sao_Paulo')::date),
  'e a receita do app fica separada da do site, em centavos');

/*
 * RECALCULAR não pode acumular. Rodar duas vezes com o mesmo dado tem que dar
 * o mesmo número — é o que deixa o cron chamar de hora em hora sem medo.
 */
drop table if exists tests.antes_da_segunda;
create table tests.antes_da_segunda as
select installs, active_users, sessions, push_sent, push_opened,
       orders_app, revenue_app_cents, orders_site, revenue_site_cents
  from public.analytics_daily
 where app_id = (select app_a from tests.lojas)
   and day = (now() at time zone 'America/Sao_Paulo')::date;

select public.consolidar_analytics(2);

/*
 * A linha INTEIRA, e não três colunas escolhidas a dedo: a acumulação entra
 * por uma coluna só, e a que ficou de fora é justamente a que ninguém olha.
 */
select tests.ok('numeros',
  (select count(*) from (
     select installs, active_users, sessions, push_sent, push_opened,
            orders_app, revenue_app_cents, orders_site, revenue_site_cents
       from public.analytics_daily
      where app_id = (select app_a from tests.lojas)
        and day = (now() at time zone 'America/Sao_Paulo')::date
     except
     select * from tests.antes_da_segunda
   ) as diferenca) = 0,
  'rodar de novo não dobra nada: a consolidação recalcula, não soma');

/*
 * Regra 1 do CLAUDE.md: dia sem número não vira linha. Uma linha de zeros
 * viraria gráfico com chão falso, que parece dado.
 */
select tests.ok('numeros',
  tests.contar($q$select count(*) from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = ((now() at time zone 'America/Sao_Paulo')::date - 1)$q$) = 0,
  'dia sem nenhum número não vira linha');

/*
 * E uma linha que deixou de ser verdade é APAGADA. Sem isto, o dado apagado
 * pelo `shop/redact` continuaria visível no resumo.
 */
insert into public.analytics_daily (app_id, day, sessions)
select app_a, (now() at time zone 'America/Sao_Paulo')::date - 2, 99 from tests.lojas;

select public.consolidar_analytics(3);

select tests.ok('numeros',
  tests.contar($q$select count(*) from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = ((now() at time zone 'America/Sao_Paulo')::date - 2)$q$) = 0,
  'linha que zerou é apagada, e não fica mentindo no gráfico');

/*
 * A janela tem teto. Sem ele, uma chamada com um número grande varreria os
 * pedidos de todos os clientes no horário do cron.
 */
/*
 * A janela cobre AMANHÃ na loja. Sem isso, a loja em Tóquio — que já virou a
 * data enquanto aqui ainda é ontem — nunca teria o dia corrente consolidado, e
 * o painel dela mostraria sempre um dia de atraso.
 */
insert into public.device_days (app_id, device_id, day, opens)
select app_a, (select id from public.devices
                where app_id = (select app_a from tests.lojas) limit 1),
       (now() at time zone 'America/Sao_Paulo')::date + 1, 5
from tests.lojas;

select public.consolidar_analytics(2);

select tests.ok('numeros',
  (select sessions = 5 from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = ((now() at time zone 'America/Sao_Paulo')::date + 1)),
  'a janela alcança o dia seguinte da loja, para quem está à frente do UTC');

/*
 * O teto da janela precisa de uma consequência VISÍVEL, senão "com teto" e
 * "sem teto" passam igual e o teto some no primeiro refactor. Esta linha de
 * 200 dias atrás está fora da janela máxima de 90: a consolidação não pode
 * encostar nela, por mais dias que peçam.
 */
insert into public.analytics_daily (app_id, day, sessions)
select app_a, (now() at time zone 'America/Sao_Paulo')::date - 200, 42 from tests.lojas;

select tests.ok('numeros',
  public.consolidar_analytics(100000) >= 1,
  'janela absurda não derruba a consolidação');

select tests.ok('numeros',
  tests.contar($q$select count(*) from public.analytics_daily
    where app_id = (select app_a from tests.lojas)
      and day = ((now() at time zone 'America/Sao_Paulo')::date - 200)$q$) = 1,
  'e ela para em 90 dias: o dia de 200 atrás não é varrido');

/*
 * ----------------------------------------------- aviso de pedido enviado
 *
 * O destinatário é o APARELHO QUE FEZ O PEDIDO. Sem esse elo, "seu pedido saiu
 * para entrega" iria para a loja inteira — spam, e motivo de desinstalação.
 */
insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'order_shipped', true, 0, 'Seu pedido saiu', 'Acompanhe por aqui.'
from tests.lojas
on conflict (app_id, type) do update set enabled = true;

-- Um pedido feito PELO APP, ligado ao aparelho pelo token do carrinho.
insert into public.cart_events (app_id, device_id, cart_token, item_count, event)
select app_a,
       (select id from public.devices
         where app_id = (select app_a from tests.lojas)
           and onesignal_subscription_id = 'sub-dos-numeros'),
       'token-do-pedido-enviado', 2, 'add'
from tests.lojas;

select public.registrar_pedido(
  (select app_a from tests.lojas), 'ped-com-aparelho', 'app', 9900, now(),
  p_cart_token => 'token-do-pedido-enviado'
);

select tests.ok('automacao',
  (select public.agendar_pedido_enviado((select app_a from tests.lojas), 'ped-com-aparelho')),
  'a remessa agenda o aviso para o aparelho que fez o pedido');

/*
 * A Shopify manda `fulfillments/create` uma vez por REMESSA: um pedido em três
 * caixas gera três webhooks. Sem a trava, o cliente receberia três avisos
 * iguais do mesmo pedido.
 */
select tests.ok('automacao',
  not (select public.agendar_pedido_enviado((select app_a from tests.lojas), 'ped-com-aparelho')),
  'e a segunda remessa do mesmo pedido não agenda de novo');

select tests.ok('automacao',
  tests.contar($q$select count(*) from public.automation_runs r
    join public.push_automations a on a.id = r.automation_id
   where a.type = 'order_shipped' and r.trigger_ref = 'ped-com-aparelho'$q$) = 1,
  'um aviso, e só um');

-- Pedido do SITE não tem aparelho: não há para onde mandar.
select public.registrar_pedido(
  (select app_a from tests.lojas), 'ped-do-site', 'site', 5000, now()
);

select tests.ok('automacao',
  not (select public.agendar_pedido_enviado((select app_a from tests.lojas), 'ped-do-site')),
  'pedido sem aparelho não gera aviso nenhum');

select tests.ok('automacao',
  not (select public.agendar_pedido_enviado((select app_a from tests.lojas), 'nunca-existiu')),
  'nem um pedido que não conhecemos');

/*
 * O MESMO id de pedido na outra organização, com aparelho. Os ids da Shopify
 * são por loja, então dois clientes têm pedidos com o mesmo número o tempo
 * todo — e sem o filtro por app, a remessa de um avisaria o cliente do outro.
 */
insert into public.cart_events (app_id, device_id, cart_token, item_count, event)
select app_b,
       (select id from public.devices
         where app_id = (select app_b from tests.lojas)
           and onesignal_subscription_id = 'sub-da-outra-org'),
       'token-da-outra-org', 1, 'add'
from tests.lojas;

select public.registrar_pedido(
  (select app_b from tests.lojas), 'ped-repetido', 'app', 1000, now(),
  p_cart_token => 'token-da-outra-org'
);

select tests.ok('isolamento',
  not (select public.agendar_pedido_enviado((select app_a from tests.lojas), 'ped-repetido')),
  'o pedido com o mesmo número na outra organização não vira aviso aqui');

/*
 * Um pedido NOVO, com aparelho e sem aviso ainda: é o único jeito de provar
 * que foi a automação desligada que barrou, e não a falta de aparelho.
 */
select public.registrar_pedido(
  (select app_a from tests.lojas), 'ped-com-a-automacao-desligada', 'app', 7700, now(),
  p_cart_token => 'token-do-pedido-enviado'
);

update public.push_automations set enabled = false
 where app_id = (select app_a from tests.lojas) and type = 'order_shipped';

select tests.ok('automacao',
  not (select public.agendar_pedido_enviado(
    (select app_a from tests.lojas), 'ped-com-a-automacao-desligada')),
  'automação desligada não agenda nada');

update public.push_automations set enabled = true
 where app_id = (select app_a from tests.lojas) and type = 'order_shipped';

select tests.ok('automacao',
  (select public.agendar_pedido_enviado(
    (select app_a from tests.lojas), 'ped-com-a-automacao-desligada')),
  'e ligada de novo, o mesmo pedido agenda: era a automação que barrava');

/*
 * O silêncio noturno vale aqui também. O atraso é calculado para cair às 3h
 * da manhã na loja — e não com um número fixo, senão a asserção só valeria se
 * a suíte rodasse a uma certa hora do dia.
 */
update public.push_automations
   set delay_minutes = (extract(epoch from (
         ((date_trunc('day', now() at time zone 'America/Sao_Paulo')
            + interval '1 day 3 hours') at time zone 'America/Sao_Paulo') - now()
       )) / 60)::integer
 where app_id = (select app_a from tests.lojas) and type = 'order_shipped';

select public.registrar_pedido(
  (select app_a from tests.lojas), 'ped-da-madrugada', 'app', 1234, now(),
  p_cart_token => 'token-do-pedido-enviado'
);

select public.agendar_pedido_enviado((select app_a from tests.lojas), 'ped-da-madrugada');

select tests.ok('silêncio',
  (select extract(hour from (r.scheduled_for at time zone 'America/Sao_Paulo'))::integer = 8
     from public.automation_runs r
    where r.trigger_ref = 'ped-da-madrugada'),
  'o aviso que cairia às 3h da manhã é adiado para as 8h');

/*
 * ------------------------------------------------ avise-me quando voltar
 *
 * A inscrição é CONSUMIDA no aviso: quem pediu recebe uma vez e sai da lista.
 * Guardar o pedido atendido faria a mesma pessoa receber o mesmo aviso no
 * reabastecimento seguinte, sem ter pedido de novo.
 */
insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'back_in_stock', true, 0, 'Voltou!', 'O que você queria está de volta.'
from tests.lojas
on conflict (app_id, type) do update set enabled = true, delay_minutes = 0;

select tests.ok('automacao',
  (select public.inscrever_de_volta(
     (select app_a from tests.lojas),
     (select id from public.devices
       where app_id = (select app_a from tests.lojas)
         and onesignal_subscription_id = 'sub-dos-numeros'),
     '4412345', '/products/jaqueta?variant=4412345')),
  'o aparelho pede para ser avisado quando a variante voltar');

/*
 * Tocar duas vezes no botão não pode virar duas notificações iguais quando o
 * produto voltar.
 */
select tests.ok('automacao',
  not (select public.inscrever_de_volta(
     (select app_a from tests.lojas),
     (select id from public.devices
       where app_id = (select app_a from tests.lojas)
         and onesignal_subscription_id = 'sub-dos-numeros'),
     '4412345', '/products/jaqueta?variant=4412345')),
  'e pedir de novo não cria um segundo pedido');

/*
 * O aparelho tem que ser DESTE app. O endpoint já confere a assinatura, mas
 * esta é a checagem que impede um app de inscrever o aparelho de outro.
 */
select tests.ok('isolamento',
  not (select public.inscrever_de_volta(
     (select app_a from tests.lojas),
     (select id from public.devices
       where app_id = (select app_b from tests.lojas)
         and onesignal_subscription_id = 'sub-da-outra-org'),
     '4412345', '/x')),
  'um app não inscreve o aparelho de outra organização');

select tests.ok('automacao',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_a from tests.lojas)$q$) = 1,
  'um pedido, e só um');

-- Variante que ninguém pediu não avisa ninguém.
select tests.ok('automacao',
  (select public.avisar_de_volta((select app_a from tests.lojas), '999')) = 0,
  'variante sem ninguém inscrito não agenda nada');

/*
 * A MESMA variante inscrita na outra organização. Os ids da Shopify são por
 * loja, então duas lojas têm variantes com o mesmo número o tempo todo — e sem
 * o filtro por app, o reabastecimento de uma avisaria o cliente da outra.
 */
insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_b, 'back_in_stock', true, 0, 'Voltou!', 'Está de volta.'
from tests.lojas
on conflict (app_id, type) do update set enabled = true;

select public.inscrever_de_volta(
  (select app_b from tests.lojas),
  (select id from public.devices
    where app_id = (select app_b from tests.lojas)
      and onesignal_subscription_id = 'sub-da-outra-org'),
  '4412345', '/products/outro-produto');

select tests.ok('automacao',
  (select public.avisar_de_volta((select app_a from tests.lojas), '4412345')) = 1,
  'a variante que voltou avisa quem pediu');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_b from tests.lojas)$q$) = 1,
  'e o pedido da outra organização continua lá: o número da variante se repete entre lojas');

/*
 * O link do ENVIO vence o da automação: "voltou!" que abre a home obriga o
 * cliente a procurar de novo o produto que ele pediu para acompanhar.
 */
select tests.ok('automacao',
  (select r.deep_link = '/products/jaqueta?variant=4412345'
     from public.automation_runs r
    where r.trigger_ref = '4412345'),
  'e o aviso leva ao produto, e não à automação');

/*
 * E o DESPACHO tem que entregar esse link. Conferir só a coluna deixaria
 * passar um `reservar_envios_de_automacao` que ignora o link do envio e manda
 * todo mundo para a home — que é o bug que este par de asserções existe para
 * pegar.
 *
 * O FUSO DA LOJA É FIXADO ANTES, e isso não é conveniência. `avisar_de_volta`
 * agenda com `fora_do_silencio`, e `reservar_envios_de_automacao` reagenda de
 * novo quem cair na madrugada — então, entre 22h e 8h do fuso da loja, o envio
 * é empurrado para as 8h e o despacho não o devolve. A subconsulta daria NULL
 * e a asserção falharia. Era um teste que passava o dia inteiro e reprovava a
 * madrugada: escondia o que deveria provar justamente quando ninguém está
 * olhando, e só apareceu porque uma execução caiu às 22h54 de São Paulo.
 *
 * O fuso é escolhido pela hora UTC de agora, para o relógio local da loja
 * cair ao meio-dia em qualquer horário de execução. `Etc/GMT-3` é UTC+3: o
 * sinal é invertido nessas zonas, e é por isso que a conta abaixo o inverte.
 * O horário de silêncio tem asserção própria; aqui o que está sob prova é o
 * LINK que o despacho entrega.
 */
do $$
declare
  v_desvio integer := 12 - extract(hour from now() at time zone 'UTC')::integer;
begin
  update public.stores
     set timezone = case
           when v_desvio = 0 then 'UTC'
           when v_desvio > 0 then 'Etc/GMT-' || v_desvio
           else 'Etc/GMT+' || abs(v_desvio)
         end
   where id = (select loja_a from tests.lojas);

  update public.automation_runs
     set scheduled_for = now() - interval '1 minute'
   where trigger_ref = '4412345';
end
$$;

select tests.ok('automacao',
  (select deep_link = '/products/jaqueta?variant=4412345'
     from public.reservar_envios_de_automacao(100)
    where id = (select r.id from public.automation_runs r
                 where r.trigger_ref = '4412345')),
  'o despacho entrega o link do ENVIO, e não o da automação');

select tests.ok('automacao',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'a inscrição é consumida: quem pediu, foi avisado');

select tests.ok('automacao',
  (select public.avisar_de_volta((select app_a from tests.lojas), '4412345')) = 0,
  'e o mesmo produto voltando de novo não avisa ninguém sem novo pedido');

/*
 * Com a automação desligada nada é agendado E NADA É APAGADO: o pedido espera
 * o lojista ligar. Apagá-lo perderia em silêncio a intenção de compra.
 */
update public.push_automations set enabled = false
 where app_id = (select app_a from tests.lojas) and type = 'back_in_stock';

select public.inscrever_de_volta(
  (select app_a from tests.lojas),
  (select id from public.devices
    where app_id = (select app_a from tests.lojas)
      and onesignal_subscription_id = 'sub-dos-numeros'),
  '777', '/products/outro');

select tests.ok('automacao',
  (select public.avisar_de_volta((select app_a from tests.lojas), '777')) = 0,
  'automação desligada não avisa');

select tests.ok('automacao',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where variant_id = '777'$q$) = 1,
  'e o pedido continua esperando o lojista ligar');

update public.push_automations set enabled = true
 where app_id = (select app_a from tests.lojas) and type = 'back_in_stock';

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('automacao',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_a from tests.lojas)$q$) = 1,
  'o lojista vê quantos pedidos de aviso existem no app dele');

select tests.ok('automacao',
  tests.bloqueado($q$insert into public.back_in_stock_subs (app_id, device_id, variant_id)
    values ((select app_a from tests.lojas), gen_random_uuid(), '1')$q$),
  'mas não inscreve ninguém por fora');

select tests.ok('segredo',
  tests.erro($q$select public.inscrever_de_volta(
    gen_random_uuid(), gen_random_uuid(), '1', '/x')$q$),
  'nem chama a função de inscrição');

select tests.ok('segredo',
  tests.erro($q$select public.avisar_de_volta(gen_random_uuid(), '1')$q$),
  'nem dispara o aviso de volta ao estoque');

reset role;
select tests.logout();

select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'e os pedidos de uma organização não aparecem para outra');

reset role;
select tests.logout();

set role service_role;

reset role;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('segredo',
  tests.erro($q$select public.agendar_pedido_enviado(gen_random_uuid(), 'x')$q$),
  'o lojista não agenda aviso de pedido por fora');

/*
 * MAU não é a soma de `active_users`: somar trinta dias daria "aparelho-dias",
 * e quem abre o app todo dia contaria trinta vezes. O distinto do PERÍODO só
 * existe em `device_days`, e é isto que a tela C11 chama de ativos no mês.
 */
select tests.ok('numeros',
  (select public.ativos_no_periodo(
     (select app_a from tests.lojas),
     (now() at time zone 'America/Sao_Paulo')::date - 30,
     (now() at time zone 'America/Sao_Paulo')::date + 1)) = 2,
  'ativos do período contam aparelho distinto, e não abertura nem dia');

-- Dois aparelhos hoje, mais a linha de amanhã do teste da janela.
select tests.ok('numeros',
  tests.contar($q$select count(*) from public.device_days
    where app_id = (select app_a from tests.lojas)$q$) = 3,
  'o lojista LÊ a atividade dos aparelhos do app dele');

select tests.ok('numeros',
  tests.bloqueado($q$insert into public.device_days (app_id, device_id, day)
    values ((select app_a from tests.lojas), gen_random_uuid(), current_date)$q$),
  'mas não escreve: quem conta abertura é o endpoint do app');

select tests.ok('segredo',
  tests.erro($q$select public.contar_abertura(gen_random_uuid(), gen_random_uuid())$q$),
  'o lojista não inventa abertura de aparelho');

select tests.ok('segredo',
  tests.erro('select public.consolidar_analytics(1)'),
  'nem manda recalcular os números de todo mundo');

select tests.ok('segredo',
  tests.erro($q$select public.dia_da_loja(gen_random_uuid())$q$),
  'nem usa a função de fuso da plataforma');

reset role;
select tests.logout();

/*
 * A prova do isolamento é feita AGORA, com os dados do app A de pé: depois do
 * `shop/redact` não sobraria linha nenhuma, e a asserção passaria por não
 * existir nada — que é o jeito clássico de um teste de vazamento mentir.
 */
select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.device_days
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'e a atividade de uma organização não aparece para outra');

/*
 * A função de ativos é `security invoker`: a RLS de quem chama é que decide.
 * Numa `security definer` mal feita, este número seria o da OUTRA loja.
 */
select tests.ok('isolamento',
  (select public.ativos_no_periodo(
     (select app_a from tests.lojas),
     current_date - 30, current_date + 1)) = 0,
  'e nem pelos ativos do período: a função respeita a RLS de quem chama');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.analytics_daily
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'nem os números dela');

reset role;
select tests.logout();

set role service_role;

-- `shop/redact` leva a atividade e os números junto.
select tests.ok('numeros',
  public.apagar_dados_da_shopify('loja-a.myshopify.com') >= 3,
  'shop/redact apaga pedidos, atividade e números');

select tests.ok('numeros',
  tests.contar($q$select count(*) from public.device_days
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'e não sobra atividade de aparelho');

select tests.ok('numeros',
  tests.contar($q$select count(*) from public.analytics_daily
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'nem o resumo do que foi apagado');

/*
 * O pedido de aviso é dado de cliente final: ele diz o que aquela pessoa quer
 * comprar. Sai junto — e o da OUTRA organização fica, porque o redact é de uma
 * loja só.
 */
select tests.ok('numeros',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_a from tests.lojas)$q$) = 0,
  'nem os pedidos de aviso de quem comprava nela');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.back_in_stock_subs
    where app_id = (select app_b from tests.lojas)$q$) = 1,
  'e o shop/redact de uma loja não apaga os pedidos da outra');


-- ================== grupo 12: conectar pelo app do próprio lojista
--
-- O caminho manual guarda, por loja, o Client Secret do app que o LOJISTA
-- criou. Isso muda duas coisas que o banco precisa garantir sozinho, porque
-- errar qualquer uma delas é silencioso.

reset role;

-- Uma conexão `manual` sem credencial é uma loja que não renova o token nem
-- confere assinatura de webhook: ela pararia de funcionar em 24 horas, e o
-- sintoma chegaria como "os pedidos sumiram" dias depois.
select tests.ok('conexao',
  tests.erro($q$update public.stores
    set shopify_conexao = 'manual', shopify_client_id = null,
        shopify_client_secret_enc = null
  where id = (select loja_a from tests.lojas)$q$),
  'o banco recusa conexão manual sem as credenciais do app');

select tests.ok('conexao',
  tests.permitido($q$update public.stores
    set shopify_conexao = 'manual', shopify_client_id = 'id-do-app',
        shopify_client_secret_enc = 'cifrado',
        shopify_access_token_enc = 'cifrado',
        shopify_token_expires_at = now() + interval '24 hours'
  where id = (select loja_a from tests.lojas)$q$),
  'e aceita quando as duas estão lá');

-- Duas lojas CONECTADAS ao mesmo domínio deixam o webhook sem dono: a rota não
-- saberia com qual segredo conferir a assinatura, e os pedidos cairiam num dos
-- dois apps por sorteio do plano de execução.
do $$
begin
  update public.stores set shop_domain = 'mesma-loja.myshopify.com'
   where id = (select loja_a from tests.lojas);
end
$$;

select tests.ok('conexao',
  tests.erro($q$update public.stores
    set shop_domain = 'mesma-loja.myshopify.com', shopify_access_token_enc = 'cifrado'
  where id = (select loja_b from tests.lojas)$q$),
  'duas lojas conectadas não podem dividir o mesmo domínio Shopify');

-- Mas DESCONECTADA pode repetir: é o que preenche o campo na reconexão, e
-- duas lojas que já usaram o mesmo domínio não incomodam ninguém.
select tests.ok('conexao',
  tests.permitido($q$update public.stores
    set shop_domain = 'mesma-loja.myshopify.com', shopify_access_token_enc = null
  where id = (select loja_b from tests.lojas)$q$),
  'e uma loja desconectada pode repetir o domínio de outra');

-- A desconexão leva TUDO junto. Deixar o Client Secret para trás guardaria o
-- segredo do app de um cliente que pediu para desconectar.
select public.desconectar_shopify('mesma-loja.myshopify.com');

select tests.ok('conexao',
  tests.contar($q$select count(*) from public.stores
    where id = (select loja_a from tests.lojas)
      and shopify_conexao is null
      and shopify_client_id is null
      and shopify_client_secret_enc is null
      and shopify_token_expires_at is null
      and shopify_access_token_enc is null
      and shopify_scopes is null$q$) = 1,
  'desconectar apaga token, escopos, credenciais e prazo de uma vez');


-- ============================== grupo: A02 — o resumo do admin
--
-- Duas perguntas, e a segunda é a que importa. A primeira é quem pode chamar.
-- A segunda é se o número é VERDADE: `resumo_do_admin` é `security invoker`,
-- então cada contagem passa pela RLS, e ela só devolve o total real porque
-- toda policy de leitura destas tabelas termina em `or is_platform_admin()`.
-- No dia em que uma tabela nova esquecer essa cláusula, o cartão da tela vai
-- mostrar zero sem reclamar de nada — e é esta asserção que cai primeiro.

reset role;
select tests.logout();

/*
 * CADA CATEGORIA PRECISA DE UMA LINHA DE VERDADE, e isto não é preciosismo.
 * A primeira versão destas asserções comparava os números da função com os
 * números reais sem plantar dado nenhum — e os fixtures davam zero em todas as
 * categorias. `0 = 0` passa, e passa também quando a função está errada: a
 * mutação que trocou `live` por `paused` não ficou vermelha, porque não havia
 * loja em nenhum dos dois estados. Um teste que não sabe falhar não é um teste.
 */
update public.organizations set status = 'active' where id = (select org_a from tests.ids);
-- O status da loja vem dos builds (migration 53): no ar é ter um aprovado, e
-- em revisão é ter um enviado. Plantar o status direto seria desfeito pelo
-- primeiro build abaixo.
insert into public.builds (app_id, platform, profile, status)
select app_a, 'ios', 'production', 'approved' from tests.lojas;
insert into public.builds (app_id, platform, profile, status, submitted_at)
select app_b, 'ios', 'production', 'submitted', now() from tests.lojas;

insert into public.builds (app_id, platform, profile, status)
select app_a, 'ios', 'production', 'queued' from tests.lojas;
insert into public.builds (app_id, platform, profile, status)
select app_a, 'android', 'production', 'building' from tests.lojas;

-- org_a já tem a conta Apple (`verified`) lá em cima; a Google fica livre, e a
-- unicidade é por (org_id, platform).
insert into public.developer_accounts (org_id, platform, status)
select org_a, 'google', 'error' from tests.ids;

-- A verdade, medida sem RLS no caminho, para comparar com o que a função
-- devolve por dentro dela.
drop table if exists tests.verdade;
create table tests.verdade as
select
  (select count(*) from public.organizations where status = 'active')::integer as orgs_ativas,
  (select count(*) from public.stores where status = 'live')::integer as lojas_live,
  (select count(*) from public.builds where status in ('queued', 'building'))::integer
    as builds_na_fila,
  (select count(*) from public.developer_accounts where status = 'error')::integer
    as contas_dev_com_erro;

grant select on tests.verdade to authenticated;

select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.erro('select * from public.resumo_do_admin()'),
  'usuário comum NÃO lê o resumo do admin');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  (select orgs_ativas from public.resumo_do_admin())
    = (select orgs_ativas from tests.verdade)
  and (select orgs_ativas from tests.verdade) > 0,
  'o resumo conta as organizações que EXISTEM, e não as que a RLS deixa ver');

select tests.ok('admin',
  (select lojas_live from public.resumo_do_admin())
    = (select lojas_live from tests.verdade)
  and (select lojas_live from tests.verdade) > 0,
  'o resumo conta as lojas de todas as organizações');

select tests.ok('admin',
  (select builds_na_fila from public.resumo_do_admin())
    = (select builds_na_fila from tests.verdade)
  and (select builds_na_fila from tests.verdade) > 0,
  'o resumo conta os builds de todas as organizações');

-- `developer_accounts` é a tabela mais fechada do banco — as colunas `_enc`
-- são invisíveis até para o dono da organização. Contar o STATUS dela pela
-- sessão do admin prova que a leitura por coluna basta, e que a função não
-- precisou de `definer` para chegar ao número.
select tests.ok('admin',
  (select contas_dev_com_erro from public.resumo_do_admin())
    = (select contas_dev_com_erro from tests.verdade)
  and (select contas_dev_com_erro from tests.verdade) > 0,
  'o resumo conta as contas de desenvolvedor com erro, sem ler segredo nenhum');

reset role;
select tests.logout();

-- ============================== grupo: A08 — o push global do admin
--
-- Três coisas sob prova, e a terceira é a que nasceu de um bug real em outra
-- função: `stats` é JSON que veio da OneSignal, e um valor que não seja
-- inteiro NÃO pode derrubar a consulta. Um cast direto estoura a query inteira
-- por causa do lixo de um único app — e a tela do admin some por causa de um
-- cliente.

reset role;
select tests.logout();

/*
 * TUDO AQUI USA A LOJA B, e isso não é escolha estética: a loja A acumula
 * campanhas de meia dúzia de grupos anteriores deste mesmo arquivo. A primeira
 * versão destas asserções usava a A e afirmava "2 campanhas enviadas" — a
 * função devolveu 6, e as corretas eram as 6. O teste estava errado, não o
 * código. Um arquivo de asserções com estado compartilhado precisa de um
 * cantinho limpo para contar, e a loja B é o dela.
 *
 * Dado de verdade em cada coluna que as asserções conferem: sem isso a
 * comparação vira `0 = 0`, que passa mesmo com a função errada.
 */
insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_b, 'Campanha boa', 'corpo', 'sent', now() - interval '2 days',
       '{"enviados": 100, "entregues": 90, "abertos": 30}'::jsonb
  from tests.lojas;

/*
 * A campanha com `stats` podre. `entregues` veio texto e `abertos` veio
 * objeto — as duas formas que a OneSignal já mandou de verdade quando a
 * notificação foi recusada. A função tem que somar ZERO aqui e seguir viva.
 */
insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_b, 'Campanha com lixo', 'corpo', 'sent', now() - interval '1 day',
       '{"enviados": "muitos", "entregues": "n/d", "abertos": {"erro": true}}'::jsonb
  from tests.lojas;

insert into public.push_campaigns (app_id, title, body, status, stats)
select app_b, 'Campanha que falhou', 'corpo', 'failed', '{}'::jsonb from tests.lojas;

select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.erro('select * from public.push_do_admin(30)'),
  'usuário comum NÃO lê o push global');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  (select campanhas_enviadas from public.push_do_admin(30)
    where app_id = (select app_b from tests.lojas)) = 2,
  'conta as campanhas enviadas no período');

select tests.ok('admin',
  (select campanhas_falhas from public.push_do_admin(30)
    where app_id = (select app_b from tests.lojas)) = 1,
  'conta as campanhas que falharam');

/*
 * A asserção que importa: 90 da campanha boa + 0 da podre. Se alguém trocar o
 * `~ '^[0-9]+$'` por um cast direto, isto não falha — ESTOURA, que é
 * exatamente o que se quer impedir.
 */
select tests.ok('admin',
  (select entregues from public.push_do_admin(30)
    where app_id = (select app_b from tests.lojas)) = 90,
  'stats podre soma zero em vez de derrubar a consulta');

select tests.ok('admin',
  (select abertos from public.push_do_admin(30)
    where app_id = (select app_b from tests.lojas)) = 30,
  'o mesmo vale para aberturas: objeto onde devia haver número vira zero');

/*
 * O recorte de tempo precisa recortar. Uma campanha de 40 dias atrás não pode
 * aparecer num período de 30 — senão o número nunca baixa e a tela deixa de
 * dizer alguma coisa sobre AGORA.
 */
reset role;
insert into public.push_campaigns (app_id, title, body, status, sent_at, stats)
select app_b, 'Campanha antiga', 'corpo', 'sent', now() - interval '40 days',
       '{"entregues": 5000}'::jsonb from tests.lojas;

select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  (select entregues from public.push_do_admin(30)
    where app_id = (select app_b from tests.lojas)) = 90,
  'campanha fora do período não entra na soma');

select tests.ok('admin',
  (select entregues from public.push_do_admin(90)
    where app_id = (select app_b from tests.lojas)) = 5090,
  'e entra quando o período alcança ela');

reset role;
select tests.logout();

-- ============================== grupo: A11 — a equipe da plataforma
--
-- Três funções com TRÊS ALCANCES DIFERENTES, e a diferença é o ponto:
--
--   `admin_equipe` é para a tela: o admin logado chama e vê a equipe;
--   `outros_superadmins` e `admin_usuario_por_email` são só service_role.
--
-- As duas últimas são `security definer` e leem `auth.users` ou contam quem
-- manda na plataforma. Deixá-las ao alcance da sessão do navegador daria a
-- qualquer admin logado um jeito de descobrir se um e-mail tem conta — e o
-- único motivo de elas existirem é servir a uma ação do servidor.

reset role;
select tests.logout();
select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.erro('select * from public.admin_equipe()'),
  'usuário comum NÃO lê a equipe da plataforma');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('admin',
  tests.contar('select count(*) from public.admin_equipe()') >= 1,
  'o admin lê a equipe, com e-mail vindo de auth.users');

select tests.ok('admin',
  (select role from public.admin_equipe()
    where user_id = (select u_equipe from tests.ids)) = 'superadmin',
  'e o papel de cada um vem junto');

/*
 * As duas de service_role. `tests.erro` aqui prova o GRANT, não a RLS: sem
 * permissão de execução o Postgres recusa antes de rodar uma linha da função.
 */
select tests.ok('admin',
  tests.erro(format('select public.outros_superadmins(%L)', (select u_equipe from tests.ids))),
  'nem o admin logado conta superadmins pelo navegador: é só do servidor');

select tests.ok('admin',
  tests.erro($q$select public.admin_usuario_por_email('equipe@teste.local')$q$),
  'nem descobre id por e-mail pelo navegador: é só do servidor');

reset role;
set role service_role;

select tests.ok('admin',
  (select public.admin_usuario_por_email('equipe@teste.local'))
    = (select u_equipe from tests.ids),
  'o servidor acha o usuário pelo e-mail');

/* Caixa e espaço não podem impedir de achar quem existe. */
select tests.ok('admin',
  (select public.admin_usuario_por_email('  EQUIPE@Teste.Local  '))
    = (select u_equipe from tests.ids),
  'e acha mesmo com maiúscula e espaço sobrando');

select tests.ok('admin',
  (select public.admin_usuario_por_email('ninguem@lugar-nenhum.local')) is null,
  'e-mail sem conta devolve nulo, não exceção');

/*
 * A trava do último superadmin. Só existe um na base de teste, então
 * "outros além dele" tem que ser zero — é esse zero que faz a ação do
 * servidor recusar a remoção.
 */
select tests.ok('admin',
  (select public.outros_superadmins((select u_equipe from tests.ids))) = 0,
  'sem outro superadmin, a conta dá zero e a remoção do último é barrada');

reset role;
select tests.logout();

-- ============================== grupo: A04 — notas internas sobre o cliente
--
-- A ASSERÇÃO QUE SEGURA TUDO é a do dono. A policy natural de escrever seria
-- "membros leem as notas da própria organização" — e ela entregaria ao lojista
-- tudo que a equipe anotou sobre ele: reclamação, desconto negociado, risco de
-- cancelamento. A policy certa não tem cláusula por organização nenhuma.

reset role;
select tests.logout();

insert into public.org_notes (org_id, author_id, body)
select org_a, u_equipe, 'Ligou reclamando do build de ontem. Prometido retorno na sexta.'
  from tests.ids;

-- O DONO da organização de que a nota fala. Se alguém enxerga, é ele.
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('notas',
  tests.contar('select count(*) from public.org_notes') = 0,
  'o DONO da organização não enxerga as notas internas sobre ela');

select tests.ok('notas',
  tests.erro(format('select * from public.admin_notas_da_org(%L)', (select org_a from tests.ids))),
  'e nem pela função que lista as notas com autor');

/* Escrever também não: a RLS nega por padrão, sem policy de insert. */
select tests.ok('notas',
  tests.bloqueado(format(
    'insert into public.org_notes (org_id, body) values (%L, ''nota do cliente'')',
    (select org_a from tests.ids))),
  'o dono também não escreve nota interna sobre a própria organização');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('notas',
  tests.contar('select count(*) from public.org_notes') = 1,
  'a equipe da plataforma enxerga a nota');

select tests.ok('notas',
  (select author_email from public.admin_notas_da_org((select org_a from tests.ids)))
    = 'equipe@teste.local',
  'e a função devolve quem escreveu, vindo de auth.users');

/*
 * Nem a equipe escreve pelo navegador: não há policy de insert, e o caminho é
 * a ação do servidor com a service role. Uma policy de escrita aqui seria uma
 * segunda porta a lembrar de trancar.
 */
select tests.ok('notas',
  tests.bloqueado(format(
    'insert into public.org_notes (org_id, body) values (%L, ''pelo navegador'')',
    (select org_a from tests.ids))),
  'nem a equipe escreve nota pelo navegador: só pelo servidor');

reset role;
set role service_role;

/* O piso e o teto do tamanho. Nota vazia ocupa espaço e não diz nada. */
select tests.ok('notas',
  tests.erro(format(
    'insert into public.org_notes (org_id, body) values (%L, ''   '')',
    (select org_a from tests.ids))),
  'nota só de espaço em branco é recusada pelo banco');

select tests.ok('notas',
  tests.erro(format(
    'insert into public.org_notes (org_id, body) values (%L, %L)',
    (select org_a from tests.ids), repeat('x', 4001))),
  'nota maior que o teto é recusada pelo banco');

/*
 * A nota sobrevive à saída de quem escreveu. Perder o histórico de um cliente
 * porque alguém deixou a equipe seria perder justamente o que ela guarda.
 */
update public.org_notes set author_id = null
 where org_id = (select org_a from tests.ids);

select tests.ok('notas',
  tests.contar('select count(*) from public.org_notes') = 1,
  'nota sem autor continua existindo, em vez de sumir junto com a pessoa');

reset role;
select tests.logout();

-- ============================== grupo: A10 — presets de configuração
--
-- O CONTRÁRIO DAS NOTAS INTERNAS, e vale dizer em voz alta: aqui o lojista
-- LÊ de propósito. Um preset é conteúdo do produto, não dado de cliente, e sem
-- essa leitura ele não teria como aplicar — a curadoria do admin viraria dado
-- que ninguém consome. O que ele NÃO pode é ver os desligados nem escrever.

reset role;
select tests.logout();

insert into public.config_presets (nome, tema, tabs, hide_selectors, custom_css)
values (
  'Dawn — padrão', 'Dawn',
  '[{"id":"inicio","label":"Início","icon":"home","type":"webview","url":"/","badge":"none"},
    {"id":"conta","label":"Conta","icon":"user","type":"webview","url":"/account","badge":"none"}]'::jsonb,
  '["header", ".footer"]'::jsonb,
  'body { padding: 0 }'
);

insert into public.config_presets (nome, tema, tabs, ativo)
values (
  'Impulse — rascunho', 'Impulse',
  '[{"id":"a","label":"A","icon":"home","type":"webview","url":"/","badge":"none"},
    {"id":"b","label":"B","icon":"user","type":"webview","url":"/b","badge":"none"}]'::jsonb,
  false
);

select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('presets',
  tests.contar('select count(*) from public.config_presets') = 1,
  'o lojista enxerga o preset ATIVO, que é o que ele vai aplicar');

select tests.ok('presets',
  tests.contar($q$select count(*) from public.config_presets where ativo = false$q$) = 0,
  'e não enxerga o desligado, que ainda está sendo preparado');

select tests.ok('presets',
  tests.bloqueado($q$insert into public.config_presets (nome, tema, tabs)
    values ('Meu', 'Tema',
      '[{"id":"a","label":"A","icon":"home","type":"webview","url":"/","badge":"none"},
        {"id":"b","label":"B","icon":"user","type":"webview","url":"/b","badge":"none"}]'::jsonb)$q$),
  'o lojista NÃO cria preset: a curadoria é da equipe');

select tests.ok('presets',
  tests.bloqueado($q$update public.config_presets set nome = 'Meu'$q$),
  'nem edita o que a equipe curou');

select tests.ok('presets',
  tests.erro('select * from public.admin_config_para_preset(gen_random_uuid())'),
  'nem copia a config publicada de uma loja para virar preset');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('presets',
  tests.contar('select count(*) from public.config_presets') = 2,
  'a equipe enxerga os dois, ativo e desligado');

/*
 * A forma das abas é conferida pelo BANCO, e não só pelo Zod. Sem isso um
 * preset com uma aba só chegaria até a hora de aplicar, depois de o lojista
 * escolher — e o erro apareceria como se fosse culpa dele.
 */
reset role;
set role service_role;

select tests.ok('presets',
  tests.erro($q$insert into public.config_presets (nome, tema, tabs)
    values ('Uma aba só', 'Tema',
      '[{"id":"a","label":"A","icon":"home","type":"webview","url":"/","badge":"none"}]'::jsonb)$q$),
  'preset com menos de duas abas é recusado pelo banco');

select tests.ok('presets',
  tests.erro($q$insert into public.config_presets (nome, tema, tabs)
    values ('Nem é lista', 'Tema', '{"abas": 1}'::jsonb)$q$),
  'tabs que não é lista é recusado pelo banco');

select tests.ok('presets',
  tests.erro($q$insert into public.config_presets (nome, tema, tabs)
    values ('x', 'Tema',
      '[{"id":"a","label":"A","icon":"home","type":"webview","url":"/","badge":"none"},
        {"id":"b","label":"B","icon":"user","type":"webview","url":"/b","badge":"none"}]'::jsonb)$q$),
  'nome curto demais é recusado pelo banco');

reset role;
select tests.logout();

-- ============================== grupo: fuso da loja
--
-- O fuso é texto que o PAINEL grava, e o job diário lê com `at time zone`
-- num laço sobre as lojas de todos os clientes. Um fuso que o banco não
-- conhece derrubaria o fechamento do dia de todo mundo — então quem recusa é o
-- banco, e não só a tela.

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('fuso',
  tests.permitido($q$update public.stores set timezone = 'America/Manaus'
    where id = (select loja_a from tests.lojas)$q$),
  'o dono troca o fuso da loja por um fuso de verdade');

select tests.ok('fuso',
  tests.erro($q$update public.stores set timezone = 'lixo'
    where id = (select loja_a from tests.lojas)$q$),
  'fuso que o banco não conhece é recusado, mesmo direto pela API');

select tests.ok('fuso',
  tests.erro($q$update public.stores set timezone = 'posix/America/Sao_Paulo'
    where id = (select loja_a from tests.lojas)$q$),
  'fuso no formato posix é recusado: o painel não saberia ler');

select tests.ok('fuso',
  tests.erro($q$insert into public.stores (org_id, name, primary_url, timezone)
    select org_a, 'Loja Fuso Ruim', 'https://fuso-ruim.com.br', 'Marte/Olimpo' from tests.ids$q$),
  'nem uma loja nova nasce com fuso inventado');

select tests.ok('fuso',
  tests.permitido($q$update public.stores set name = 'Loja da A'
    where id = (select loja_a from tests.lojas)$q$),
  'editar o nome não passa pela conferência do fuso');

reset role;
select tests.logout();

select tests.ok('fuso',
  (select timezone from public.stores where id = (select loja_a from tests.lojas)) = 'America/Manaus',
  'o fuso gravado é o que o dono escolheu, e não o que foi recusado depois');

-- E a consequência que motivou tudo: o job segue de pé.
set role service_role;
select tests.ok('fuso',
  not tests.erro('select public.consolidar_analytics(1)'),
  'o fechamento do dia roda com as lojas em fusos diferentes');
reset role;

update public.stores set timezone = 'America/Sao_Paulo'
 where id = (select loja_a from tests.lojas);

-- ============================== grupo: versão do build
--
-- Todo binário saía como 1.0.0 (1), e a segunda publicação de qualquer loja
-- era recusada pelas duas lojas de aplicativos. O número agora é reservado
-- aqui, um contador POR APP, com trava para builds que começam juntos.

reset role;
select tests.logout();

drop table if exists tests.maximo_do_app_a;
create table tests.maximo_do_app_a as
select coalesce(max(b.build_number), 0) as m
  from public.builds b
 where b.app_id = (select app_a from tests.lojas);

drop table if exists tests.builds_novos;
create table tests.builds_novos as
with novos as (
  insert into public.builds (app_id, platform, profile, status)
  select l.app_a, p.plataforma, 'production', 'queued'
    from tests.lojas l,
         unnest(array['android', 'ios']::public.device_platform[]) as p(plataforma)
  returning id, platform
)
select * from novos;

drop table if exists tests.maximo_do_app_b;
create table tests.maximo_do_app_b as
select coalesce(max(b.build_number), 0) as m
  from public.builds b
 where b.app_id = (select app_b from tests.lojas);

drop table if exists tests.build_novo_b;
create table tests.build_novo_b as
with novo as (
  insert into public.builds (app_id, platform, profile, status)
  select app_b, 'ios', 'production', 'queued' from tests.lojas
  returning id
)
select * from novo;

grant select on tests.maximo_do_app_a, tests.maximo_do_app_b, tests.builds_novos,
  tests.build_novo_b to anon, authenticated, service_role;

set role service_role;

select tests.ok('versão do build',
  (select numero from public.reservar_versao_do_build(
     (select id from tests.builds_novos where platform = 'android')))
    = (select m from tests.maximo_do_app_a) + 1,
  'o primeiro build novo recebe o próximo número do app');

select tests.ok('versão do build',
  (select numero from public.reservar_versao_do_build(
     (select id from tests.builds_novos where platform = 'ios')))
    = (select m from tests.maximo_do_app_a) + 2,
  'o contador é do APP: o iOS logo depois do Android recebe o número seguinte');

select tests.ok('versão do build',
  (select numero from public.reservar_versao_do_build(
     (select id from tests.builds_novos where platform = 'android')))
    = (select m from tests.maximo_do_app_a) + 1,
  'pedir de novo devolve o MESMO número: o workflow reexecutado não gasta outro');

select tests.ok('versão do build',
  (select b.version from public.builds b
    where b.id = (select id from tests.builds_novos where platform = 'ios'))
    = '1.0.' || ((select m from tests.maximo_do_app_a) + 2)::text,
  'a versão acompanha o número, e sobe junto');

select tests.ok('versão do build',
  (select numero from public.reservar_versao_do_build((select id from tests.build_novo_b)))
    = (select m from tests.maximo_do_app_b) + 1,
  'o app de outra loja tem o próprio contador');

reset role;
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('versão do build',
  tests.erro($q$select * from public.reservar_versao_do_build(
    (select id from tests.builds_novos where platform = 'android'))$q$),
  'o lojista não reserva número: quem reserva é o workflow, pela service role');

reset role;
select tests.logout();

-- ============================== grupo: atualização obrigatória
--
-- Exigir uma versão que não está nas lojas trava o app de todo cliente da
-- loja. O banco recusa, e não só a tela.

reset role;
select tests.logout();

update public.app_configs
   set config = jsonb_set(config, '{minSupportedBuild}', '50')
 where app_id = (select app_a from tests.lojas) and status = 'draft';

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('atualização obrigatória',
  tests.erro('select public.publicar_config((select app_a from tests.lojas))'),
  'sem build aprovado, não dá para exigir versão nenhuma');

reset role;
select tests.logout();

-- iPhone aprovado no 60, Android no 55: o número que dá para exigir é 55.
insert into public.builds (app_id, platform, profile, status, version, build_number)
select app_a, 'ios', 'production', 'approved', '1.0.60', 60 from tests.lojas;
insert into public.builds (app_id, platform, profile, status, version, build_number)
select app_a, 'android', 'production', 'approved', '1.0.55', 55 from tests.lojas;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('atualização obrigatória',
  tests.permitido('select public.publicar_config((select app_a from tests.lojas))'),
  'exigir uma versão que as duas lojas já aprovaram publica normalmente');

reset role;
select tests.logout();

select tests.ok('atualização obrigatória',
  (select (config ->> 'minSupportedBuild')::integer from public.app_configs
    where app_id = (select app_a from tests.lojas) and status = 'published') = 50,
  'a config no ar exige a versão escolhida');

update public.app_configs
   set config = jsonb_set(config, '{minSupportedBuild}', '57')
 where app_id = (select app_a from tests.lojas) and status = 'draft';

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('atualização obrigatória',
  tests.erro('select public.publicar_config((select app_a from tests.lojas))'),
  'o 57 existe no iPhone mas não no Android: exigir travaria quem usa Android');

reset role;
select tests.logout();

-- ============================== grupo: A13 — chaves da plataforma
--
-- Só a equipe lê; ninguém escreve pela API, nem a equipe: quem escreve é a
-- ação do servidor, pela service role, depois de conferir superadmin.

reset role;
select tests.logout();

insert into public.platform_settings (chave, valor) values ('cadastro_aberto', 'false');

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('chaves da plataforma',
  tests.contar('select count(*) from public.platform_settings') = 0,
  'o lojista não lê as chaves da plataforma');

select tests.ok('chaves da plataforma',
  tests.bloqueado($q$update public.platform_settings set valor = 'true'
    where chave = 'cadastro_aberto'$q$),
  'o lojista não reabre o cadastro');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('chaves da plataforma',
  tests.contar('select count(*) from public.platform_settings') = 1,
  'a equipe lê as chaves');

select tests.ok('chaves da plataforma',
  tests.bloqueado($q$update public.platform_settings set valor = 'true'
    where chave = 'cadastro_aberto'$q$),
  'nem a equipe escreve pela API: só a ação do servidor, que confere o papel e audita');

select tests.ok('chaves da plataforma',
  tests.bloqueado($q$insert into public.platform_settings (chave, valor)
    values ('aviso_no_painel', '"x"')$q$),
  'nem cria chave pela API');

reset role;
set role service_role;

select tests.ok('chaves da plataforma',
  tests.erro($q$insert into public.platform_settings (chave, valor)
    values ('chave_inventada', 'true')$q$),
  'chave que o código não conhece é recusada pelo banco');

select tests.ok('chaves da plataforma',
  tests.permitido($q$insert into public.platform_settings (chave, valor)
    values ('previa_no_iphone', '"https://apps.apple.com/app/id1"'),
           ('previa_no_android', '"https://play.google.com/store/apps/details?id=br.storefy"')$q$),
  'os links do Storefy Preview são chaves que o banco conhece');

select tests.ok('chaves da plataforma',
  tests.permitido($q$insert into public.platform_settings (chave, valor)
    values ('video_da_apple', '"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'),
           ('video_do_google', '"https://player.vimeo.com/video/123456789"')$q$),
  'os vídeos do passo a passo (C13) são chaves que o banco conhece');

reset role;
select tests.logout();
delete from public.platform_settings;

-- ============================== grupo: C16 — convites
--
-- Vínculo novo só nasce de convite; só o proprietário convida para a
-- empresa; só o dono do e-mail aceita; e o cadastro fechado vale NO BANCO,
-- para toda porta de entrada (e-mail, Google, API direta) — não só na tela.
--
-- Os segredos abaixo fazem o papel do link: o banco só conhece o hash.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('conv-dono@teste.local',          '{"company_name":"Org dos Convites"}'::jsonb, now()),
  ('conv-admin@teste.local',         '{"company_name":"Conv Admin"}'::jsonb,       now()),
  ('conv-membro@teste.local',        '{"company_name":"Conv Membro"}'::jsonb,      now()),
  ('conv-convidado@teste.local',     '{"company_name":"Conv Convidado"}'::jsonb,   now()),
  ('conv-sem-confirmar@teste.local', '{"company_name":"Sem Confirmar"}'::jsonb,    null),
  ('conv-suporte@teste.local',       '{"company_name":"Conv Suporte"}'::jsonb,     now());

drop table if exists tests.conv;
create table tests.conv as
select
  (select id from auth.users where email = 'conv-dono@teste.local')          as u_dono,
  (select id from auth.users where email = 'conv-admin@teste.local')         as u_admin,
  (select id from auth.users where email = 'conv-membro@teste.local')        as u_membro,
  (select id from auth.users where email = 'conv-convidado@teste.local')     as u_convidado,
  (select id from auth.users where email = 'conv-sem-confirmar@teste.local') as u_sem_confirmar,
  (select id from auth.users where email = 'conv-suporte@teste.local')       as u_suporte,
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id
    where u.email = 'conv-dono@teste.local') as org;
grant select on tests.conv to anon, authenticated, service_role;

insert into public.memberships (org_id, user_id, role)
select org, u_admin, 'admin' from tests.conv;
insert into public.memberships (org_id, user_id, role)
select org, u_membro, 'member' from tests.conv;
insert into public.platform_admins (user_id, role)
select u_suporte, 'support' from tests.conv;

-- ------------------------------------------------ o proprietário convida

select tests.login('conv-dono@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.permitido($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'admin', 'conv-convidado@teste.local',
      encode(extensions.digest('segredo-do-convite-numero-01', 'sha256'), 'hex'),
      u_dono, now() + interval '7 days' from tests.conv$q$),
  'o proprietário convida para a própria empresa');

select tests.ok('convites',
  tests.erro($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'member', 'conv-convidado@teste.local',
      encode(extensions.digest('segredo-duplicado-numero-99', 'sha256'), 'hex'),
      u_dono, now() + interval '7 days' from tests.conv$q$),
  'um convite em aberto por pessoa: convidar de novo é reenviar o mesmo');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'owner', 'dono-novo@teste.local',
      encode(extensions.digest('segredo-convite-de-dono-00', 'sha256'), 'hex'),
      u_dono, now() + interval '7 days' from tests.conv$q$),
  'ninguém é convidado como proprietário: um link vazado dá no máximo administrador');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', ids.org_a, 'admin', 'intruso@teste.local',
      encode(extensions.digest('segredo-para-outra-empresa', 'sha256'), 'hex'),
      conv.u_dono, now() + interval '7 days' from tests.conv, tests.ids$q$),
  'o proprietário não convida para a empresa dos outros');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'member', 'em-nome-de-outro@teste.local',
      encode(extensions.digest('segredo-em-nome-de-outro-1', 'sha256'), 'hex'),
      u_admin, now() + interval '7 days' from tests.conv$q$),
  'não convida em nome de outra pessoa');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'member', 'eterno@teste.local',
      encode(extensions.digest('segredo-convite-eterno-0001', 'sha256'), 'hex'),
      u_dono, now() + interval '90 days' from tests.conv$q$),
  'convite não nasce com prazo longo');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, email, token_hash, invited_by, expires_at)
    select 'conta', 'amigo-do-dono@teste.local',
      encode(extensions.digest('segredo-conta-pelo-lojista-1', 'sha256'), 'hex'),
      u_dono, now() + interval '7 days' from tests.conv$q$),
  'o lojista não convida gente para criar conta com o cadastro fechado');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at, accepted_at, accepted_by)
    select 'organizacao', org, 'member', 'ja-aceito@teste.local',
      encode(extensions.digest('segredo-nascido-aceito-0001', 'sha256'), 'hex'),
      u_dono, now() + interval '7 days', now(), u_dono from tests.conv$q$),
  'convite não nasce aceito');

-- Para os casos de expirado, cancelado, e-mail sem confirmar e cadastro.
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'alguem-que-demorou@teste.local',
  encode(extensions.digest('segredo-do-convite-expirado-02', 'sha256'), 'hex'),
  u_dono, now() - interval '1 minute' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'desistiram-de-mim@teste.local',
  encode(extensions.digest('segredo-do-convite-cancelado-03', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'conv-novo@teste.local',
  encode(extensions.digest('segredo-do-convite-de-cadastro-04', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'conv-sem-confirmar@teste.local',
  encode(extensions.digest('segredo-do-convite-sem-confirmar-07', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'conv-suporte@teste.local',
  encode(extensions.digest('segredo-do-convite-da-lista-08', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'conv-certo@teste.local',
  encode(extensions.digest('segredo-do-convite-do-certo-09', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;
insert into public.invitations (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
select 'organizacao', org, 'member', 'conv-sem-empresa@teste.local',
  encode(extensions.digest('segredo-do-convite-que-sera-tirado-10', 'sha256'), 'hex'),
  u_dono, now() + interval '7 days' from tests.conv;

select tests.ok('convites',
  tests.permitido($q$update public.invitations set revoked_at = now()
    where email = 'desistiram-de-mim@teste.local'$q$),
  'o proprietário cancela um convite');

select tests.ok('convites',
  tests.bloqueado($q$update public.invitations set accepted_at = now(),
    accepted_by = (select u_dono from tests.conv)
    where email = 'conv-certo@teste.local'$q$),
  'nem o proprietário marca um convite como aceito: aceitar é da pessoa convidada');

select tests.ok('convites',
  tests.bloqueado($q$update public.invitations set email = 'desviado@teste.local'
    where email = 'conv-certo@teste.local'$q$),
  'o e-mail de um convite não muda: outro e-mail é outro convite');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.memberships (org_id, user_id, role)
    select org, u_convidado, 'member' from tests.conv$q$),
  'nem o proprietário põe alguém na empresa sem convite');

select tests.ok('convites',
  tests.bloqueado($q$update public.memberships set user_id = (select u_convidado from tests.conv)
    where user_id = (select u_membro from tests.conv)$q$),
  'trocar a pessoa de um vínculo é pôr outra na empresa sem convite');

select tests.ok('convites',
  tests.permitido($q$update public.memberships set role = 'admin'
    where user_id = (select u_membro from tests.conv)
      and org_id = (select org from tests.conv)$q$),
  'o proprietário continua mudando papéis');

reset role;
update public.memberships set role = 'member'
 where user_id = (select u_membro from tests.conv) and org_id = (select org from tests.conv);

-- ------------------------------------------- admin e membro não convidam

select tests.login('conv-admin@teste.local');
set role authenticated;

-- Uma segunda conta do próprio admin: é assim que a escalada funcionava.
select tests.ok('convites',
  tests.bloqueado($q$insert into public.memberships (org_id, user_id, role)
    select org, u_sem_confirmar, 'owner' from tests.conv$q$),
  'FALHA CORRIGIDA: administrador não se faz dono por uma segunda conta');

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'member', 'pelo-admin@teste.local',
      encode(extensions.digest('segredo-convite-pelo-admin-1', 'sha256'), 'hex'),
      u_admin, now() + interval '7 days' from tests.conv$q$),
  'administrador não convida (só o proprietário mexe na equipe)');

select tests.ok('convites',
  tests.bloqueado($q$update public.invitations set revoked_at = now()
    where email = 'conv-certo@teste.local'$q$),
  'administrador não cancela convite');

select tests.ok('convites',
  tests.contar($q$select count(*) from public.invitations
    where org_id = (select org from tests.conv)$q$) = 8,
  'administrador vê quem foi convidado, como vê quem já está na empresa');

reset role;
select tests.login('conv-membro@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, org_id, org_role, email, token_hash, invited_by, expires_at)
    select 'organizacao', org, 'member', 'pelo-membro@teste.local',
      encode(extensions.digest('segredo-convite-pelo-membro1', 'sha256'), 'hex'),
      u_membro, now() + interval '7 days' from tests.conv$q$),
  'membro não convida');

select tests.ok('convites',
  (select count(*) from public.membros_da_organizacao((select org from tests.conv))) = 3,
  'membro vê a equipe da empresa, com e-mail');

reset role;
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.contar($q$select count(*) from public.invitations
    where org_id = (select org from tests.conv)$q$) = 0,
  'outra empresa não vê os convites desta');

select tests.ok('convites',
  tests.erro($q$select * from public.membros_da_organizacao((select org from tests.conv))$q$),
  'outra empresa não lista a equipe desta');

-- ------------------------------------------------------------- aceitar

reset role;
select tests.login('conv-membro@teste.local');
set role authenticated;

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-numero-01')) = 'outro_email',
  'o link na mão de outra pessoa não aceita: o convite é para um e-mail');

reset role;
select tests.login('conv-convidado@teste.local');
set role authenticated;

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-numero-01')) = 'aceito',
  'a pessoa convidada aceita pelo link');

select tests.ok('convites',
  tests.contar($q$select count(*) from public.memberships
    where org_id = (select org from tests.conv)
      and user_id = (select u_convidado from tests.conv) and role = 'admin'$q$) = 1,
  'e entra na empresa com o papel do convite');

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-numero-01')) = 'aceito',
  'aceitar de novo (clique duplo) não é erro');

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-expirado-02')) = 'expirado',
  'convite vencido não entra');

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-cancelado-03')) = 'cancelado',
  'convite cancelado não entra');

select tests.ok('convites',
  (select resultado from public.aceitar_convite('um-segredo-que-ninguem-criou')) = 'inexistente',
  'link inventado não entra');

reset role;
select tests.login('conv-membro@teste.local');
set role authenticated;

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-numero-01')) = 'usado',
  'convite aceito não serve para mais ninguém');

reset role;
select tests.login('conv-sem-confirmar@teste.local');
set role authenticated;

select tests.ok('convites',
  (select resultado from public.aceitar_convite('segredo-do-convite-sem-confirmar-07'))
    = 'email_nao_confirmado',
  'conta que não confirmou o e-mail não aceita');

-- "Convites para você": sem o link, pela conta dona do e-mail.
reset role;
select tests.login('conv-convidado@teste.local');
set role authenticated;

select tests.ok('convites',
  (select count(*) from public.meus_convites()) = 0,
  'a lista de convites mostra só os do próprio e-mail');

select tests.ok('convites',
  (select resultado from public.aceitar_convite_por_id(
    (select id from public.invitations where email = 'conv-suporte@teste.local'))) = 'outro_email',
  'aceitar pela lista também exige ser o dono do e-mail');

reset role;
select tests.login('conv-suporte@teste.local');
set role authenticated;

select tests.ok('convites',
  (select organizacao from public.meus_convites()) = 'Org dos Convites',
  'a conta dona do e-mail vê o convite com o nome da empresa');

select tests.ok('convites',
  (select resultado from public.aceitar_convite_por_id(
    (select id from public.invitations where email = 'conv-suporte@teste.local'))) = 'aceito',
  'e aceita sem o link');

-- --------------------------------------------------- o link, visto de fora

reset role;
select tests.logout();
set role anon;

select tests.ok('convites',
  (select situacao from public.ver_convite('segredo-do-convite-de-cadastro-04')) = 'pendente'
  and (select organizacao from public.ver_convite('segredo-do-convite-de-cadastro-04'))
    = 'Org dos Convites'
  and (select ja_tem_conta from public.ver_convite('segredo-do-convite-de-cadastro-04')) = false,
  'quem tem o link vê a empresa e o papel, sem precisar de conta');

select tests.ok('convites',
  (select situacao from public.ver_convite('segredo-do-convite-numero-01')) = 'usado'
  and (select situacao from public.ver_convite('segredo-do-convite-expirado-02')) = 'expirado'
  and (select situacao from public.ver_convite('segredo-do-convite-cancelado-03')) = 'cancelado'
  and (select situacao from public.ver_convite('curto')) = 'inexistente',
  'e a situação de cada link');

select tests.ok('convites',
  tests.erro($q$select * from public.aceitar_convite('segredo-do-convite-de-cadastro-04')$q$),
  'sem conta não se aceita nada');

select tests.ok('convites',
  tests.erro('select count(*) from public.invitations'),
  'sem conta não se lê a tabela de convites');

-- ----------------------------------------------------- os da plataforma

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.permitido($q$insert into public.invitations
    (kind, platform_role, email, token_hash, invited_by, expires_at)
    select 'equipe', 'support', 'colega@teste.local',
      encode(extensions.digest('segredo-do-convite-de-colega-06', 'sha256'), 'hex'),
      (select auth.uid()), now() + interval '7 days'$q$),
  'superadmin convida um colega para a equipe');

select tests.ok('convites',
  (select count(*) from public.membros_da_organizacao((select org from tests.conv))) = 5,
  'a equipe vê a equipe de qualquer empresa');

reset role;
select tests.login('conv-suporte@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.bloqueado($q$insert into public.invitations
    (kind, platform_role, email, token_hash, invited_by, expires_at)
    select 'equipe', 'superadmin', 'outro-colega@teste.local',
      encode(extensions.digest('segredo-colega-pelo-suporte', 'sha256'), 'hex'),
      (select auth.uid()), now() + interval '7 days'$q$),
  'suporte não põe ninguém na equipe da Storefy');

select tests.ok('convites',
  tests.permitido($q$insert into public.invitations
    (kind, email, token_hash, invited_by, expires_at)
    select 'conta', 'piloto@teste.local',
      encode(extensions.digest('segredo-do-convite-do-piloto-05', 'sha256'), 'hex'),
      (select auth.uid()), now() + interval '7 days'$q$),
  'suporte convida um lojista piloto');

select tests.ok('convites',
  tests.bloqueado($q$update public.invitations set revoked_at = now()
    where email = 'colega@teste.local'$q$),
  'suporte não cancela convite de colega');

select tests.ok('convites',
  tests.erro('select public.cadastro_aberto()'),
  'a chave do cadastro não é perguntada pela API');

reset role;
select tests.login('conv-dono@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.contar($q$select count(*) from public.invitations where kind <> 'organizacao'$q$) = 0,
  'o lojista não vê os convites da plataforma');

-- ------------------------------------------ cadastro fechado, no banco

-- Como o Auth cria uma conta: o INSERT e, conforme o caminho, uma segunda
-- instrução — a API admin grava o `app_metadata` depois; o "convidar" do
-- Auth marca `invited_at` depois. A conferência do cadastro fechado roda no
-- COMMIT; `set constraints all immediate` a dispara aqui, onde dá para ver.
reset role;
select tests.logout();

create or replace function tests.conta_como_o_auth(
  p_email text,
  p_metadados jsonb default '{}'::jsonb,
  p_app_depois jsonb default null,
  p_convidado_pelo_auth boolean default false
) returns boolean
language plpgsql
as $$
begin
  insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
  values (p_email, p_metadados, now());
  if p_app_depois is not null then
    update auth.users set raw_app_meta_data = raw_app_meta_data || p_app_depois
     where email = p_email;
  end if;
  if p_convidado_pelo_auth then
    update auth.users set invited_at = now() where email = p_email;
  end if;
  set constraints all immediate;
  return true;
exception
  when others then
    return false;
end;
$$;

insert into public.platform_settings (chave, valor) values ('cadastro_aberto', 'false');

select tests.ok('convites',
  not tests.conta_como_o_auth('por-fora@teste.local'),
  'cadastro fechado: a conta não nasce pela API do Auth, nem pelo Google');

select tests.ok('convites',
  tests.contar($q$select count(*) from auth.users where email = 'por-fora@teste.local'$q$) = 0
  and tests.contar($q$select count(*) from public.organizations
    where name = 'por-fora'$q$) = 0,
  'e nada do que o cadastro criou fica: nem a conta, nem a empresa');

select tests.ok('convites',
  tests.conta_como_o_auth('criado-pela-storefy@teste.local', '{}', '{"criado_pela_equipe": true}'),
  'a conta criada pela equipe nasce, com a marca gravada DEPOIS do INSERT, como faz a API admin');

select tests.ok('convites',
  tests.conta_como_o_auth('convidado-pelo-auth@teste.local', '{}', null, true),
  'o "convidar usuário" do próprio Auth (só service role) também passa');

select tests.ok('convites',
  not tests.conta_como_o_auth('fingindo@teste.local', '{"criado_pela_equipe": "true"}'),
  'a marca da equipe nos metadados do USUÁRIO (que o cadastro público escreve) não vale');

select tests.ok('convites',
  not tests.conta_como_o_auth('conv-errado@teste.local',
    '{"convite":"segredo-do-convite-do-certo-09"}'),
  'convite de outro e-mail não cria conta');

select tests.ok('convites',
  (select accepted_at is null from public.invitations where email = 'conv-certo@teste.local'),
  'e o convite recusado continua em aberto para a pessoa certa');

select tests.ok('convites',
  not tests.conta_como_o_auth('alguem-que-demorou@teste.local',
    '{"convite":"segredo-do-convite-expirado-02"}'),
  'convite vencido não cria conta');

select tests.ok('convites',
  tests.conta_como_o_auth('conv-novo@teste.local',
    '{"full_name":"Pessoa Nova","convite":"segredo-do-convite-de-cadastro-04"}'),
  'com convite, a conta nasce mesmo com o cadastro fechado');

select tests.ok('convites',
  (select count(*) from public.memberships m
     join auth.users u on u.id = m.user_id
    where u.email = 'conv-novo@teste.local') = 1
  and (select m.org_id = (select org from tests.conv) and m.role = 'member'
         from public.memberships m join auth.users u on u.id = m.user_id
        where u.email = 'conv-novo@teste.local'),
  'e entra só na empresa do convite, sem ganhar uma empresa vazia');

select tests.ok('convites',
  (select i.accepted_by = u.id from public.invitations i, auth.users u
    where i.email = 'conv-novo@teste.local' and u.email = 'conv-novo@teste.local')
  and (select not (raw_user_meta_data ? 'convite') from auth.users
        where email = 'conv-novo@teste.local'),
  'o convite fica aceito, e o segredo sai dos metadados da conta');

select tests.ok('convites',
  not tests.conta_como_o_auth('conv-novo-2@teste.local',
    '{"convite":"segredo-do-convite-de-cadastro-04"}'),
  'o mesmo link não cria uma segunda conta');

select tests.ok('convites',
  tests.conta_como_o_auth('piloto@teste.local',
    '{"company_name":"Loja Piloto","convite":"segredo-do-convite-do-piloto-05"}'),
  'o lojista piloto cria a conta com o cadastro fechado');

select tests.ok('convites',
  (select o.name from public.organizations o
     join public.memberships m on m.org_id = o.id
     join auth.users u on u.id = m.user_id
    where u.email = 'piloto@teste.local' and m.role = 'owner') = 'Loja Piloto',
  'com a própria empresa, como proprietário');

select tests.ok('convites',
  tests.conta_como_o_auth('colega@teste.local',
    '{"full_name":"Colega Novo","convite":"segredo-do-convite-de-colega-06"}'),
  'o colega convidado cria a conta com o cadastro fechado');

select tests.ok('convites',
  (select pa.role from public.platform_admins pa
     join auth.users u on u.id = pa.user_id where u.email = 'colega@teste.local') = 'support',
  'e nasce na equipe da Storefy, com o papel do convite');

select tests.ok('convites',
  (select count(*) from public.audit_logs
    where entity = 'platform_admins'
      and entity_id = (select id from auth.users where email = 'colega@teste.local')) = 1,
  'e a entrada na equipe vai para a trilha');

-- ------------------------------------------------------ sair da empresa

select tests.login('conv-membro@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.bloqueado($q$delete from public.memberships
    where user_id = (select u_admin from tests.conv)$q$),
  'membro não tira ninguém da empresa');

select tests.ok('convites',
  tests.permitido($q$delete from public.memberships
    where user_id = (select auth.uid()) and org_id = (select org from tests.conv)$q$),
  'mas sai dela quando quer');

reset role;
select tests.login('conv-dono@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.bloqueado($q$delete from public.memberships
    where user_id = (select auth.uid()) and org_id = (select org from tests.conv)$q$),
  'o único proprietário não sai sem passar a propriedade');

reset role;
select tests.logout();

-- ---------------------------------------------- conta sem empresa nenhuma

-- Entrou só pela empresa do convite e depois foi tirado dela.
insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
values ('conv-sem-empresa@teste.local', '{"convite":"segredo-do-convite-que-sera-tirado-10"}', now());
delete from public.memberships
 where user_id = (select id from auth.users where email = 'conv-sem-empresa@teste.local');

select tests.login('conv-sem-empresa@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.erro($q$select public.criar_minha_organizacao('Empresa Nova')$q$),
  'com o cadastro fechado, conta sem empresa não cria outra');

reset role;
delete from public.platform_settings;
set role authenticated;

select tests.ok('convites',
  (select public.criar_minha_organizacao('  Empresa   Nova  ')) is not null
  and tests.contar($q$select count(*) from public.memberships
    where user_id = (select auth.uid()) and role = 'owner'$q$) = 1,
  'com o cadastro aberto, a conta sem empresa cria a sua');

select tests.ok('convites',
  tests.erro($q$select public.criar_minha_organizacao('Segunda Empresa')$q$),
  'quem já tem empresa não cria outra por aqui');

reset role;
select tests.login('conv-dono@teste.local');
set role authenticated;

select tests.ok('convites',
  tests.contar($q$select count(*) from public.audit_logs
    where entity = 'invitations' and org_id = (select org from tests.conv)$q$) > 0
  and tests.contar($q$select count(*) from public.audit_logs
    where entity = 'invitations' and diff::text like '%token_hash%'$q$) = 0,
  'convites vão para a trilha da empresa, sem o hash do segredo');

reset role;
select tests.logout();
delete from public.platform_settings;

-- ============================== grupo: Minha conta — excluir a conta
--
-- A tela promete, empresa por empresa, o que acontece. A promessa tem de
-- ser a mesma coisa que a cascata do banco FAZ — então o teste pergunta, e
-- depois exclui de verdade e confere.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('exc-sozinho@teste.local', '{"company_name":"Empresa Solitaria"}'::jsonb, now()),
  ('exc-dono@teste.local',    '{"company_name":"Empresa Dividida"}'::jsonb,  now()),
  ('exc-membro@teste.local',  '{"company_name":"Exc Membro"}'::jsonb,        now()),
  ('exc-admin@teste.local',   '{"full_name":"Admin Sucessor","company_name":"Exc Admin"}'::jsonb, now());

drop table if exists tests.exc;
create table tests.exc as
select
  (select id from auth.users where email = 'exc-sozinho@teste.local') as u_sozinho,
  (select id from auth.users where email = 'exc-dono@teste.local')    as u_dono,
  (select id from auth.users where email = 'exc-membro@teste.local')  as u_membro,
  (select id from auth.users where email = 'exc-admin@teste.local')   as u_admin,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'exc-sozinho@teste.local') as org_sozinha,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'exc-dono@teste.local') as org_dividida;
grant select on tests.exc to authenticated;

-- O membro entrou ANTES do admin: mesmo assim, o sucessor é o admin.
insert into public.memberships (org_id, user_id, role, created_at)
select org_dividida, u_membro, 'member', now() - interval '2 days' from tests.exc;
insert into public.memberships (org_id, user_id, role, created_at)
select org_dividida, u_admin, 'admin', now() - interval '1 day' from tests.exc;
insert into public.stores (org_id, name, primary_url)
select org_sozinha, 'Loja Solitaria', 'https://solitaria.com.br' from tests.exc;

select tests.login('exc-sozinho@teste.local');
set role authenticated;

select tests.ok('excluir conta',
  (select efeito from public.consequencias_de_excluir_minha_conta()) = 'excluida'
  and (select lojas from public.consequencias_de_excluir_minha_conta()) = 1,
  'a única pessoa da empresa fica sabendo que a empresa vai junto, com a loja');

reset role;
select tests.login('exc-dono@teste.local');
set role authenticated;

select tests.ok('excluir conta',
  (select efeito from public.consequencias_de_excluir_minha_conta()
    where empresa = 'Empresa Dividida') = 'passa_para'
  and (select sucessor from public.consequencias_de_excluir_minha_conta()
    where empresa = 'Empresa Dividida') = 'Admin Sucessor',
  'o único proprietário fica sabendo quem herda: o administrador, antes do membro mais antigo');

reset role;
select tests.login('exc-membro@teste.local');
set role authenticated;

select tests.ok('excluir conta',
  (select efeito from public.consequencias_de_excluir_minha_conta()
    where empresa = 'Empresa Dividida') = 'sai'
  and (select count(*) from public.consequencias_de_excluir_minha_conta()) = 2,
  'quem não é o único dono só sai — e vê também a própria empresa');

select tests.ok('excluir conta',
  tests.erro('select count(*) from auth.users'),
  'e a lista vem da função, sem abrir auth.users');

-- Agora de verdade, como a API admin do Auth faz.
reset role;
select tests.logout();
delete from auth.users where email in ('exc-dono@teste.local', 'exc-sozinho@teste.local');

select tests.ok('excluir conta',
  (select m.role from public.memberships m
    where m.org_id = (select org_dividida from tests.exc)
      and m.user_id = (select u_admin from tests.exc)) = 'owner',
  'a cascata fez o que a tela prometeu: o administrador virou proprietário');

select tests.ok('excluir conta',
  not exists (select 1 from public.organizations where id = (select org_sozinha from tests.exc))
  and not exists (select 1 from public.stores where name = 'Loja Solitaria'),
  'e a empresa da pessoa sozinha foi embora com a loja');

select tests.ok('excluir conta',
  exists (select 1 from public.organizations where id = (select org_dividida from tests.exc)),
  'a empresa com mais gente continua');

-- Quem entrou por convite também consegue sair: o aceite fica, sem autor.
select tests.ok('excluir conta',
  tests.permitido($q$delete from auth.users where email = 'conv-novo@teste.local'$q$),
  'a conta que aceitou um convite se exclui');

select tests.ok('excluir conta',
  (select accepted_at is not null and accepted_by is null
     from public.invitations where email = 'conv-novo@teste.local'),
  'e o convite continua dizendo que foi aceito, sem apontar para quem já saiu');

-- ============================== grupo: C16 avisos por e-mail e C17 chamados
--
-- Cada um escolhe os próprios avisos; o aviso da revisão respeita a escolha.
-- O chamado é da empresa: ela lê e escreve como empresa, a equipe como
-- equipe, e ninguém de fora lê nada.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ch-dono@teste.local',    '{"company_name":"Empresa do Chamado"}'::jsonb, now()),
  ('ch-admin@teste.local',   '{"company_name":"Ch Admin"}'::jsonb,           now()),
  ('ch-membro@teste.local',  '{"full_name":"Membro Que Pergunta","company_name":"Ch Membro"}'::jsonb, now()),
  ('ch-fora@teste.local',    '{"company_name":"Empresa de Fora"}'::jsonb,    now()),
  ('ch-suporte@teste.local', '{"full_name":"Pessoa do Suporte","company_name":"Ch Suporte"}'::jsonb, now());

drop table if exists tests.ch;
create table tests.ch as
select
  (select id from auth.users where email = 'ch-dono@teste.local')    as u_dono,
  (select id from auth.users where email = 'ch-admin@teste.local')   as u_admin,
  (select id from auth.users where email = 'ch-membro@teste.local')  as u_membro,
  (select id from auth.users where email = 'ch-suporte@teste.local') as u_suporte,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'ch-dono@teste.local') as org,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'ch-fora@teste.local') as org_fora;

insert into public.memberships (org_id, user_id, role)
select org, u_admin, 'admin' from tests.ch;
insert into public.memberships (org_id, user_id, role)
select org, u_membro, 'member' from tests.ch;
insert into public.platform_admins (user_id, role)
select u_suporte, 'support' from tests.ch;
insert into public.stores (org_id, name, primary_url)
select org, 'Loja do Chamado', 'https://loja-do-chamado.com.br' from tests.ch;
insert into public.stores (org_id, name, primary_url)
select org_fora, 'Loja de Fora', 'https://loja-de-fora.com.br' from tests.ch;

alter table tests.ch add column loja uuid, add column loja_fora uuid, add column build uuid;
update tests.ch set
  loja = (select id from public.stores where name = 'Loja do Chamado'),
  loja_fora = (select id from public.stores where name = 'Loja de Fora');
insert into public.builds (app_id, platform, status)
select a.id, 'ios', 'approved' from public.apps a where a.store_id = (select loja from tests.ch);
update tests.ch set build = (select b.id from public.builds b
  join public.apps a on a.id = b.app_id where a.store_id = (select loja from tests.ch));
grant select on tests.ch to authenticated, anon, service_role;

-- ---------------------------------------------------------------- avisos

select tests.login('ch-dono@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.permitido($q$insert into public.email_preferences (org_id, user_id, revisao_do_app)
    select org, u_dono, false from tests.ch$q$),
  'o dono desliga o aviso da revisão só para si');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$insert into public.email_preferences (org_id, user_id, revisao_do_app)
    select org, u_admin, false from tests.ch$q$),
  'ninguém desliga o aviso dos outros');

reset role;
select tests.login('ch-fora@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.bloqueado($q$insert into public.email_preferences (org_id, user_id, revisao_do_app)
    select org, (select auth.uid()), false from tests.ch$q$),
  'nem cria preferência numa empresa de que não faz parte');

reset role;
select tests.login('ch-admin@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.contar('select count(*) from public.email_preferences') = 0,
  'a escolha de um não aparece para o outro');

reset role;
set role service_role;

select tests.ok('avisos e chamados',
  (select array_agg(email order by email) from public.emails_do_build((select build from tests.ch)))
    = array['ch-admin@teste.local'],
  'o aviso da revisão vai para quem quer: o dono desligou, o administrador recebe');

reset role;
select tests.login('ch-dono@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.permitido($q$update public.email_preferences set revisao_do_app = true
    where user_id = (select auth.uid())$q$),
  'e liga de novo quando quer');

-- -------------------------------------------------------------- chamados

reset role;
select tests.login('ch-membro@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  (select public.abrir_chamado((select org from tests.ch), 'publicacao',
    'O app não aparece na loja', 'Enviei faz três dias e ainda não aprovaram.',
    (select loja from tests.ch))) is not null,
  'qualquer pessoa da empresa abre um chamado, até quem só vê');

drop table if exists tests.chamado;
reset role;
create table tests.chamado as select id from public.support_tickets where titulo = 'O app não aparece na loja';
grant select on tests.chamado to authenticated, anon, service_role;
select tests.login('ch-membro@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.erro($q$select public.abrir_chamado((select org_fora from tests.ch), 'outro',
    'Chamado alheio', 'Tentando abrir em nome de outra empresa.')$q$),
  'ninguém abre chamado em nome de outra empresa');

select tests.ok('avisos e chamados',
  tests.erro($q$select public.abrir_chamado((select org from tests.ch), 'app',
    'Loja alheia', 'Pendurando a loja de outra empresa no chamado.',
    (select loja_fora from tests.ch))$q$),
  'nem pendura a loja de outra empresa no próprio chamado');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
    select id, (select auth.uid()), true, 'Resposta falsa da equipe' from tests.chamado$q$),
  'o lojista não fala como se fosse a equipe da Storefy');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
    select id, (select u_dono from tests.ch), false, 'Em nome do dono' from tests.chamado$q$),
  'nem escreve em nome de outra pessoa');

reset role;
select tests.login('ch-fora@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.contar('select count(*) from public.support_tickets') = 0
  and tests.contar('select count(*) from public.support_messages') = 0,
  'outra empresa não lê os chamados nem as mensagens');

select tests.ok('avisos e chamados',
  tests.erro($q$select * from public.mensagens_do_chamado((select id from tests.chamado))$q$),
  'nem pela função das mensagens');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
    select id, (select auth.uid()), false, 'Me intrometendo' from tests.chamado$q$),
  'nem escreve no chamado dos outros');

reset role;
select tests.login('ch-suporte@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.permitido($q$insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
    select id, (select auth.uid()), true, 'A Apple costuma levar até cinco dias úteis.' from tests.chamado$q$),
  'a equipe responde como equipe');

select tests.ok('avisos e chamados',
  (select status from public.support_tickets where id = (select id from tests.chamado)) = 'respondido',
  'e o chamado passa a esperar a empresa');

reset role;
select tests.login('ch-membro@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  (select autor from public.mensagens_do_chamado((select id from tests.chamado)) where da_equipe)
    = 'Equipe Storefy'
  and (select autor from public.mensagens_do_chamado((select id from tests.chamado)) where not da_equipe)
    = 'Membro Que Pergunta',
  'o lojista vê "Equipe Storefy", e não o e-mail pessoal de quem atendeu');

select tests.ok('avisos e chamados',
  tests.permitido($q$insert into public.support_messages (ticket_id, author_id, da_equipe, texto)
    select id, (select auth.uid()), false, 'Obrigado! E se passar de cinco dias?' from tests.chamado$q$),
  'a empresa responde');

select tests.ok('avisos e chamados',
  (select status from public.support_tickets where id = (select id from tests.chamado)) = 'aberto',
  'e o chamado volta para a equipe');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$update public.support_tickets set status = 'respondido'
    where id = (select id from tests.chamado)$q$),
  'a empresa não marca o próprio chamado como respondido');

select tests.ok('avisos e chamados',
  tests.bloqueado($q$update public.support_tickets set titulo = 'Outro assunto'
    where id = (select id from tests.chamado)$q$),
  'nem troca o título depois de aberto');

select tests.ok('avisos e chamados',
  tests.permitido($q$update public.support_tickets set status = 'fechado'
    where id = (select id from tests.chamado)$q$),
  'mas fecha quando resolveu');

reset role;
set role service_role;

select tests.ok('avisos e chamados',
  public.email_do_autor_do_chamado((select id from tests.chamado)) = 'ch-membro@teste.local',
  'a resposta vai por e-mail para quem abriu');

reset role;
update public.email_preferences set resposta_do_suporte = true;  -- nada muda para quem não escolheu
insert into public.email_preferences (org_id, user_id, resposta_do_suporte)
select org, u_membro, false from tests.ch;
set role service_role;

select tests.ok('avisos e chamados',
  public.email_do_autor_do_chamado((select id from tests.chamado)) is null,
  'menos para quem desligou esse aviso');

reset role;
select tests.login('ch-suporte@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.permitido($q$update public.support_tickets set status = 'aberto'
    where id = (select id from tests.chamado)$q$),
  'a equipe reabre um chamado');

reset role;
select tests.login('ch-dono@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  tests.contar($q$select count(*) from public.audit_logs
    where entity = 'support_tickets' and org_id = (select org from tests.ch)
      and actor_id = (select u_suporte from tests.ch)$q$) > 0
  and tests.contar($q$select count(*) from public.audit_logs
    where entity = 'support_tickets' and diff::text like '%cinco dias%'$q$) = 0,
  'a mudança de situação pela equipe vai para a trilha da empresa, sem o texto da conversa');

reset role;
drop table if exists tests.chamados_abertos;
create table tests.chamados_abertos as
select count(*)::integer as n from public.support_tickets where status = 'aberto';
grant select on tests.chamados_abertos to authenticated;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('avisos e chamados',
  (select chamados_esperando from public.resumo_do_admin()) = (select n from tests.chamados_abertos)
  and (select n from tests.chamados_abertos) > 0,
  'a visão geral do admin conta os chamados esperando a equipe');

reset role;
select tests.logout();
set role anon;

select tests.ok('avisos e chamados',
  tests.erro('select count(*) from public.support_tickets'),
  'sem conta, nada de chamados');

reset role;

-- ============================================ grupo: Fase 7 cobrança
--
-- Quem paga, o que libera e o que trava. A cobrança é escrita só pelo
-- servidor (depois da Asaas); o lojista lê a da própria empresa; a equipe cria
-- os planos. E o que custa dinheiro (loja, campanha, publicar, build) para
-- quando a empresa não está em dia — com a frase dizendo por quê.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cb-dono@teste.local',    '{"company_name":"Empresa que Paga"}'::jsonb, now()),
  ('cb-admin@teste.local',   '{"company_name":"Cb Admin"}'::jsonb,         now()),
  ('cb-membro@teste.local',  '{"company_name":"Cb Membro"}'::jsonb,        now()),
  ('cb-fora@teste.local',    '{"company_name":"Empresa Vizinha"}'::jsonb,  now()),
  ('cb-super@teste.local',   '{"company_name":"Cb Super"}'::jsonb,         now()),
  ('cb-suporte@teste.local', '{"company_name":"Cb Suporte"}'::jsonb,       now()),
  ('cb-teste@teste.local',   '{"company_name":"Empresa em Teste"}'::jsonb, now());

drop table if exists tests.cb;
create table tests.cb as
select
  (select id from auth.users where email = 'cb-dono@teste.local')  as u_dono,
  (select id from auth.users where email = 'cb-admin@teste.local') as u_admin,
  (select id from auth.users where email = 'cb-membro@teste.local') as u_membro,
  (select id from auth.users where email = 'cb-super@teste.local') as u_super,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'cb-dono@teste.local') as org,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'cb-fora@teste.local') as org_fora,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'cb-teste@teste.local') as org_teste;

insert into public.memberships (org_id, user_id, role)
select org, u_admin, 'admin' from tests.cb;
insert into public.memberships (org_id, user_id, role)
select org, u_membro, 'member' from tests.cb;
insert into public.platform_admins (user_id, role)
select u_super, 'superadmin' from tests.cb;
insert into public.platform_admins (user_id, role)
select id, 'support' from auth.users where email = 'cb-suporte@teste.local';

insert into public.stores (org_id, name, primary_url)
select org, 'Loja que Paga', 'https://loja-que-paga.com.br' from tests.cb;
insert into public.stores (org_id, name, primary_url)
select org_teste, 'Loja em Teste', 'https://loja-em-teste.com.br' from tests.cb;

alter table tests.cb
  add column app uuid, add column app_teste uuid,
  add column plano uuid, add column plano_grande uuid;
update tests.cb set
  app = (select a.id from public.apps a join public.stores s on s.id = a.store_id
          where s.name = 'Loja que Paga'),
  app_teste = (select a.id from public.apps a join public.stores s on s.id = a.store_id
                where s.name = 'Loja em Teste');

-- Um rascunho de config no app de quem paga, para a trava do "publicar".
insert into public.app_configs (app_id, version, config, status)
select app, 1, (select c.config from public.app_configs c order by c.version limit 1), 'draft'
from tests.cb;

-- Campanha agendada ainda em teste, que vai vencer depois de o teste acabar.
insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
select app_teste, 'Vai ficar sem assinatura', 'Corpo', 'scheduled', now() - interval '1 minute'
from tests.cb;

grant select on tests.cb to authenticated, anon, service_role;

-- ------------------------------------------- a empresa só muda o nome

select tests.login('cb-admin@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.permitido($q$update public.organizations set name = 'Empresa que Paga Bem'
    where id = (select org from tests.cb)$q$),
  'o administrador muda o nome da empresa');

select tests.ok('cobrança',
  tests.bloqueado($q$update public.organizations set trial_ends_at = now() + interval '10 years'
    where id = (select org from tests.cb)$q$),
  'mas não estica o próprio teste');

select tests.ok('cobrança',
  tests.bloqueado($q$update public.organizations set status = 'active'
    where id = (select org from tests.cb)$q$),
  'nem se declara em dia');

select tests.ok('cobrança',
  tests.bloqueado($q$update public.organizations set slug = 'outro-identificador'
    where id = (select org from tests.cb)$q$),
  'nem troca o identificador da empresa');

reset role;
select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.bloqueado($q$update public.organizations
    set name = 'Nome', trial_ends_at = now() + interval '1 year'
    where id = (select org from tests.cb)$q$),
  'nem o proprietário, nem escondendo a data junto com o nome');

-- ----------------------------------------------------------------- planos

reset role;
select tests.login('cb-super@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.permitido($q$insert into public.plans
    (nome, preco_centavos, limite_lojas, limite_aparelhos, limite_campanhas_mes)
    values ('Essencial', 9900, 2, 3, 1)$q$),
  'o superadmin cria um plano');

select tests.ok('cobrança',
  tests.permitido($q$insert into public.plans (nome, preco_centavos) values ('Grande', 19900)$q$),
  'e um sem limites');

select tests.ok('cobrança',
  tests.permitido($q$insert into public.plans (nome, preco_centavos, limite_lojas, vale_no_teste)
    values ('Teste', 500, 1, true)$q$),
  'e marca o plano cujos limites valem no teste');

select tests.ok('cobrança',
  tests.erro($q$insert into public.plans (nome, preco_centavos) values (' essencial', 1000)$q$),
  'nome repetido (sem ligar para maiúscula e espaço) não entra');

select tests.ok('cobrança',
  tests.erro($q$insert into public.plans (nome, preco_centavos, vale_no_teste)
    values ('Outro do teste', 1000, true)$q$),
  'só um plano vale no teste');

select tests.ok('cobrança',
  tests.erro($q$insert into public.plans (nome, preco_centavos) values ('Barato demais', 499)$q$),
  'nenhum custa menos que R$ 5,00, o mínimo da Asaas');

reset role;

update tests.cb set
  plano = (select id from public.plans where nome = 'Essencial'),
  plano_grande = (select id from public.plans where nome = 'Grande');

select tests.ok('cobrança',
  (select count(*) from public.audit_logs
    where entity = 'plans' and org_id is null
      and actor_id = (select u_super from tests.cb)) = 3,
  'cada plano criado vai para a trilha da plataforma, com quem criou');

select tests.login('cb-suporte@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.bloqueado($q$insert into public.plans (nome, preco_centavos) values ('Do suporte', 1000)$q$),
  'o suporte não cria plano');

select tests.ok('cobrança',
  tests.bloqueado($q$update public.plans set preco_centavos = 100000 where nome = 'Essencial'$q$),
  'nem muda o preço');

reset role;
select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.bloqueado($q$update public.plans set preco_centavos = 500 where nome = 'Essencial'$q$),
  'o lojista não baixa o próprio preço');

select tests.ok('cobrança',
  tests.bloqueado($q$delete from public.plans$q$),
  'nem apaga planos');

select tests.ok('cobrança',
  tests.contar($q$select count(*) from public.plans
    where nome in ('Essencial', 'Grande', 'Teste')$q$) = 3,
  'mas enxerga os planos para escolher');

reset role;
select tests.logout();
set role anon;

select tests.ok('cobrança',
  tests.erro('select count(*) from public.plans'),
  'sem conta, nem os planos');

reset role;

-- -------------------------------------------- o limite do teste

select tests.login('cb-teste@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.stores (org_id, name, primary_url)
    select org_teste, 'Segunda em Teste', 'https://segunda-em-teste.com.br' from tests.cb$q$,
    'Durante o teste, dá para ter até 1 loja'),
  'no teste, vale o limite de lojas do plano marcado para o teste');

select tests.ok('cobrança',
  (select limites_do_teste and limite_lojas = 1
     from public.situacao_da_cobranca((select org_teste from tests.cb))),
  'e a situação da cobrança diz de onde vem o limite');

reset role;

-- ------------------------------------ só o servidor escreve a cobrança

select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.bloqueado($q$insert into public.subscriptions
    (org_id, provider, external_id, plan_id, valor_centavos, status)
    select org, 'asaas', 'sub_falsa', plano, 100, 'active' from tests.cb$q$),
  'o lojista não grava assinatura pela API');

select tests.ok('cobrança',
  tests.erro($q$select public.registrar_assinatura((select org from tests.cb), 'asaas',
    'sub_falsa', (select plano from tests.cb), 100, null)$q$),
  'nem pela função do servidor');

select tests.ok('cobrança',
  tests.erro($q$select public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_falso', p_assinatura => 'sub_falsa', p_valor_centavos => 9900, p_status => 'paid', p_vencimento => current_date, p_evento => 'evt_falso', p_tipo => 'PAYMENT_RECEIVED', p_paga_em => current_date, p_link => null)$q$),
  'nem registra fatura paga');

select tests.ok('cobrança',
  tests.erro($q$select * from public.cobranca_da_org((select org from tests.cb))$q$),
  'a leitura interna da cobrança não é exposta');

select tests.ok('cobrança',
  tests.erro($q$select * from public.situacao_da_cobranca((select org_fora from tests.cb))$q$),
  'e a pública só responde sobre a própria empresa');

select tests.ok('cobrança',
  (select em_dia from public.situacao_da_cobranca((select org from tests.cb))),
  'em teste, a empresa está em dia');

reset role;
set role service_role;

select public.salvar_quem_paga((select org from tests.cb), 'asaas', 'cus_1',
  'Empresa que Paga Ltda', 'cnpj', '0190', ' Financeiro@Paga.com.br ', (select u_dono from tests.cb));
select public.registrar_assinatura((select org from tests.cb), 'asaas', 'sub_1',
  (select plano from tests.cb), 9900, (select u_dono from tests.cb));

select tests.ok('cobrança',
  tests.erro_com($q$select public.registrar_assinatura((select org from tests.cb), 'asaas',
    'sub_2', (select plano from tests.cb), 9900, null)$q$, 'já tem uma assinatura'),
  'uma assinatura viva por empresa');

reset role;

select tests.ok('cobrança',
  (select status from public.subscriptions where org_id = (select org from tests.cb)) = 'pending',
  'assinada e ainda sem pagar: aguardando');

select tests.ok('cobrança',
  (select email from public.billing_customers where org_id = (select org from tests.cb))
    = 'financeiro@paga.com.br',
  'o e-mail de cobrança é guardado limpo e em minúsculas');

select tests.ok('cobrança',
  (select count(*) from public.audit_logs
    where org_id = (select org from tests.cb)
      and entity in ('subscriptions', 'billing_customers')
      and actor_id = (select u_dono from tests.cb)) = 2,
  'a trilha diz quem assinou e quem informou os dados de cobrança');

select tests.ok('cobrança',
  not exists (select 1 from public.audit_logs
               where entity = 'billing_customers' and diff::text like '%0190%'),
  'sem o documento na trilha');

-- -------------------------------------------------- quem lê o quê

select tests.login('cb-membro@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.contar('select count(*) from public.subscriptions') = 1,
  'o membro vê o plano da empresa');

select tests.ok('cobrança',
  tests.contar('select count(*) from public.billing_customers') = 0,
  'mas não quem paga');

reset role;
select tests.login('cb-admin@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.contar('select count(*) from public.billing_customers') = 1,
  'o administrador vê quem paga');

reset role;

-- ------------------------------------------ o teste acabou: tolerância e trava

update public.organizations set trial_ends_at = now() - interval '1 day'
 where id = (select org from tests.cb);

select tests.ok('cobrança',
  public.org_em_dia((select org from tests.cb)),
  'teste acabou ontem, assinatura esperando o primeiro pagamento: ainda em dia (a tolerância)');

update public.organizations set trial_ends_at = now() - interval '10 days'
 where id = (select org from tests.cb);

select tests.ok('cobrança',
  not public.org_em_dia((select org from tests.cb)),
  'dez dias sem pagar a primeira fatura: travada');

select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.stores (org_id, name, primary_url)
    select org, 'Loja Travada', 'https://travada.com.br' from tests.cb$q$,
    'A primeira fatura ainda não foi paga'),
  'travada: loja nova não entra, e a frase diz por quê');

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
    select app, 'Promo', 'Corpo', 'scheduled', now() from tests.cb$q$,
    'para enviar campanhas'),
  'nem campanha para enviar');

select tests.ok('cobrança',
  tests.permitido($q$insert into public.push_campaigns (app_id, title, body)
    select app, 'Rascunho', 'Corpo' from tests.cb$q$),
  'mas o rascunho de campanha continua');

select tests.ok('cobrança',
  tests.erro_com($q$select public.publicar_config((select app from tests.cb))$q$,
    'para publicar mudanças no app'),
  'nem publicar mudança no app');

select tests.ok('cobrança',
  tests.contar($q$select count(*) from public.app_configs
    where app_id = (select app from tests.cb) and status = 'draft'$q$) = 1,
  'e o rascunho do editor continua lá, intacto');

reset role;
set role service_role;

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.builds (app_id, platform, status)
    select app, 'ios', 'queued' from tests.cb$q$,
    'para gerar uma versão nova do app'),
  'nem versão nova para as lojas, nem pela service role (a reexecução do admin)');

-- -------------------------------------------------------- o pagamento

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_1', p_assinatura => 'sub_1', p_valor_centavos => 9900, p_status => 'pending', p_vencimento => public.hoje_em_brasilia() - 10, p_evento => 'evt_1', p_tipo => 'PAYMENT_CREATED', p_paga_em => null, p_link => 'https://www.asaas.com/i/pay_1') = 'aplicado',
  'a primeira fatura chega aguardando');

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_1', p_assinatura => 'sub_1', p_valor_centavos => 9900, p_status => 'paid', p_vencimento => public.hoje_em_brasilia() - 10, p_evento => 'evt_2', p_tipo => 'PAYMENT_RECEIVED', p_paga_em => public.hoje_em_brasilia(), p_link => null) = 'aplicado',
  'e é paga');

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_1', p_assinatura => 'sub_1', p_valor_centavos => 9900, p_status => 'paid', p_vencimento => public.hoje_em_brasilia() - 10, p_evento => 'evt_2', p_tipo => 'PAYMENT_RECEIVED', p_paga_em => public.hoje_em_brasilia(), p_link => null) = 'repetido',
  'o mesmo aviso de novo não é aplicado de novo');

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_1', p_assinatura => 'sub_1', p_valor_centavos => 9900, p_status => 'overdue', p_vencimento => public.hoje_em_brasilia() - 10, p_evento => 'evt_3', p_tipo => 'PAYMENT_OVERDUE', p_paga_em => null, p_link => null) = 'aplicado',
  'um "vencida" atrasado chega');

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_fora', p_assinatura => 'sub_de_outro_produto', p_valor_centavos => 1000, p_status => 'paid', p_vencimento => public.hoje_em_brasilia(), p_evento => 'evt_4', p_tipo => 'PAYMENT_RECEIVED', p_paga_em => public.hoje_em_brasilia(), p_link => null) = 'desconhecida',
  'cobrança de fora da Storefy é ignorada');

reset role;

select tests.ok('cobrança',
  (select status from public.invoices where external_id = 'pay_1') = 'paid'
    and (select link from public.invoices where external_id = 'pay_1')
      = 'https://www.asaas.com/i/pay_1',
  'e não desfaz o pagamento, nem apaga o link');

select tests.ok('cobrança',
  (select status from public.subscriptions where org_id = (select org from tests.cb)) = 'active'
    and (select status from public.organizations where id = (select org from tests.cb)) = 'active',
  'paga: assinatura ativa, empresa ativa');

select tests.ok('cobrança',
  (select pago_ate from public.subscriptions where org_id = (select org from tests.cb))
    = ((public.hoje_em_brasilia() - 10) + interval '1 month')::date - 1,
  'pago até: um mês a partir do vencimento pago');

select tests.ok('cobrança',
  public.org_em_dia((select org from tests.cb)),
  'e a empresa volta a estar em dia');

select tests.ok('cobrança',
  not exists (select 1 from public.invoices where external_id = 'pay_fora'),
  'sem fatura de fora');

select tests.ok('cobrança',
  (select count(*) from public.billing_events where external_id in ('evt_1', 'evt_2', 'evt_3', 'evt_4')) = 4
    and (select resultado from public.billing_events where external_id = 'evt_4') like 'ignorado%',
  'cada aviso fica anotado uma vez, inclusive o ignorado, para a equipe ver se chegam');

-- ------------------------------------------------- os limites do plano

select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.permitido($q$insert into public.stores (org_id, name, primary_url)
    select org, 'Segunda que Paga', 'https://segunda-que-paga.com.br' from tests.cb$q$),
  'em dia: a segunda loja entra (o plano permite duas)');

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.stores (org_id, name, primary_url)
    select org, 'Terceira que Paga', 'https://terceira-que-paga.com.br' from tests.cb$q$,
    'O seu plano permite até 2 lojas'),
  'a terceira não');

select tests.ok('cobrança',
  tests.permitido($q$insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
    select app, 'Uma no mês', 'Corpo', 'scheduled',
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month 10 days')
        at time zone 'America/Sao_Paulo'
    from tests.cb$q$),
  'a campanha do mês (o plano permite uma) entra');

select tests.ok('cobrança',
  tests.erro_com($q$insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
    select app, 'Outra no mês', 'Corpo', 'scheduled',
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '1 month 11 days')
        at time zone 'America/Sao_Paulo'
    from tests.cb$q$,
    'O seu plano permite 1 campanha por mês'),
  'a segunda do mesmo mês não');

select tests.ok('cobrança',
  tests.permitido($q$insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
    select app, 'No outro mês', 'Corpo', 'scheduled',
      (date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '2 months 10 days')
        at time zone 'America/Sao_Paulo'
    from tests.cb$q$),
  'no mês seguinte, sim');

select tests.ok('cobrança',
  tests.erro_com($q$update public.push_campaigns
    set status = 'scheduled',
        scheduled_at = (date_trunc('month', now() at time zone 'America/Sao_Paulo')
                        + interval '1 month 12 days') at time zone 'America/Sao_Paulo'
    where title = 'Rascunho' and app_id = (select app from tests.cb)$q$,
    'por mês'),
  'agendar um rascunho também conta no mês');

select tests.ok('cobrança',
  (select lojas = 2 and campanhas_no_mes = 0
     from public.uso_da_org((select org from tests.cb))),
  'o uso conta as lojas e só as campanhas deste mês');

reset role;

-- Quatro aparelhos abriram o app nos últimos dias; o plano permite três.
insert into public.devices (app_id, onesignal_subscription_id, platform)
select app, 'cb-aparelho-' || n, 'android' from tests.cb, generate_series(1, 4) n;
insert into public.device_days (app_id, device_id, day)
select d.app_id, d.id, public.hoje_em_brasilia() - (row_number() over ())::integer
  from public.devices d
 where d.onesignal_subscription_id like 'cb-aparelho-%';

select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  (select aparelhos_30d from public.uso_da_org((select org from tests.cb))) = 4,
  'aparelhos ativos: os distintos dos últimos 30 dias, como no Analytics');

select tests.ok('cobrança',
  tests.erro('select public.orgs_acima_do_limite_de_aparelhos()'),
  'a conta da plataforma inteira não é do lojista');

select tests.ok('cobrança',
  (select aparelhos_30d from public.aparelhos_por_loja((select org from tests.cb))
    where nome = 'Loja que Paga') = 4
    and (select count(*) from public.aparelhos_por_loja((select org from tests.cb))) = 2,
  'e loja por loja, como a OneSignal cobra');

reset role;
select tests.login('cb-fora@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro($q$select * from public.aparelhos_por_loja((select org from tests.cb))$q$),
  'outra empresa não lê os aparelhos desta');

reset role;
select tests.login('cb-super@teste.local');
set role authenticated;

select tests.ok('cobrança',
  (select acima_do_limite >= 1 and mrr_centavos = 9900 and assinaturas_ativas = 1
     from public.resumo_do_admin()),
  'a visão geral mostra o MRR das assinaturas em dia e quem passou do limite de aparelhos');

reset role;

-- --------------------------------- a campanha que vence com a empresa travada

update public.organizations set trial_ends_at = now() - interval '2 days'
 where id = (select org_teste from tests.cb);

insert into public.push_campaigns (app_id, title, body, status, scheduled_at)
select app, 'Sai normalmente', 'Corpo', 'scheduled', now() - interval '1 minute' from tests.cb;

set role service_role;
drop table if exists tests.cb_reservadas;
create table tests.cb_reservadas as select * from public.reservar_campanhas(50);
reset role;

select tests.ok('cobrança',
  (select status from public.push_campaigns where title = 'Vai ficar sem assinatura') = 'failed'
    and (select stats ->> 'erro' from public.push_campaigns
          where title = 'Vai ficar sem assinatura') like '%assinatura%',
  'a campanha agendada de uma empresa que travou não sai, e diz por quê');

select tests.ok('cobrança',
  exists (select 1 from tests.cb_reservadas where title = 'Sai normalmente')
    and not exists (select 1 from tests.cb_reservadas where title = 'Vai ficar sem assinatura'),
  'a de quem está em dia sai normalmente');

-- ------------------------------------------ trocar de plano e cancelar

set role service_role;
select public.trocar_plano_da_assinatura((select org from tests.cb), (select plano_grande from tests.cb),
  19900, (select u_dono from tests.cb));
reset role;

select tests.ok('cobrança',
  (select plan_id = (select plano_grande from tests.cb) and valor_centavos = 19900
     from public.subscriptions where org_id = (select org from tests.cb)),
  'trocar de plano muda o plano e o valor');

select tests.ok('cobrança',
  exists (select 1 from public.audit_logs
           where entity = 'subscriptions' and org_id = (select org from tests.cb)
             and actor_id = (select u_dono from tests.cb)
             and diff -> 'plano' ->> 'de' = 'Essencial'
             and diff -> 'plano' ->> 'para' = 'Grande'),
  'e a trilha guarda de qual para qual, e quem trocou');

select tests.login('cb-super@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro($q$delete from public.plans where nome = 'Grande'$q$),
  'plano com assinatura não se apaga (a equipe tira da vitrine)');

reset role;
select tests.login('cb-dono@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro_com($q$delete from public.organizations where id = (select org from tests.cb)$q$,
    'Cancele a assinatura'),
  'a empresa com assinatura viva não some sem cancelar antes');

reset role;
set role service_role;

select tests.ok('cobrança',
  public.encerrar_assinatura('asaas', 'sub_1', null, null, (select u_dono from tests.cb)) = 'aplicado',
  'o lojista cancela (o servidor grava depois da Asaas)');

select tests.ok('cobrança',
  public.encerrar_assinatura('asaas', 'sub_1', 'evt_5', 'SUBSCRIPTION_DELETED', null) = 'aplicado',
  'e o aviso da Asaas que vem depois não muda nada');

reset role;

select tests.ok('cobrança',
  (select status from public.subscriptions where org_id = (select org from tests.cb)) = 'canceled'
    and (select count(*) from public.audit_logs
          where entity = 'subscriptions' and org_id = (select org from tests.cb)
            and diff ? 'cancelada') = 1
    and (select actor_id from public.audit_logs
          where entity = 'subscriptions' and org_id = (select org from tests.cb)
            and diff ? 'cancelada') = (select u_dono from tests.cb),
  'cancelada, uma vez só na trilha, com quem cancelou');

select tests.ok('cobrança',
  public.org_em_dia((select org from tests.cb)),
  'cancelada, o período pago continua valendo');

-- O período pago acaba: sem tolerância, a assinatura cancelada trava.
update public.invoices set vencimento = public.hoje_em_brasilia() - 45
 where external_id = 'pay_1';
select public.recalcular_cobranca((select org from tests.cb));

select tests.ok('cobrança',
  not public.org_em_dia((select org from tests.cb))
    and public.mensagem_de_bloqueio((select org from tests.cb), 'x') like 'A assinatura foi cancelada%',
  'acabou o período pago de uma cancelada: travada, e a frase diz que foi cancelada');

set role service_role;
select public.registrar_assinatura((select org from tests.cb), 'asaas', 'sub_2',
  (select plano from tests.cb), 9900, (select u_dono from tests.cb));

select tests.ok('cobrança',
  public.registrar_fatura(p_provider => 'asaas', p_fatura => 'pay_1', p_assinatura => 'sub_1', p_valor_centavos => 9900, p_status => 'refunded', p_vencimento => public.hoje_em_brasilia() - 45, p_evento => 'evt_6', p_tipo => 'PAYMENT_REFUNDED', p_paga_em => null, p_link => null) = 'aplicado',
  'o aviso de uma fatura da assinatura antiga ainda acha a empresa');

reset role;

select tests.ok('cobrança',
  (select external_id = 'sub_2' and status = 'pending' and cancelada_em is null
     from public.subscriptions where org_id = (select org from tests.cb)),
  'depois de cancelada, a empresa assina de novo');

-- --------------------------------------------- a equipe estende o teste

select tests.login('cb-suporte@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro_com($q$select public.estender_teste((select org_teste from tests.cb),
    public.hoje_em_brasilia() + 10)$q$, 'Só superadmin'),
  'o suporte não estende teste');

reset role;
select tests.login('cb-teste@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro($q$select public.estender_teste((select org_teste from tests.cb),
    public.hoje_em_brasilia() + 10)$q$),
  'nem o próprio lojista');

reset role;
select tests.login('cb-super@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.erro_com($q$select public.estender_teste((select org_teste from tests.cb),
    public.hoje_em_brasilia() + 91)$q$, 'daqui a 90 dias'),
  'no máximo 90 dias à frente');

select tests.ok('cobrança',
  tests.permitido($q$select public.estender_teste((select org_teste from tests.cb),
    public.hoje_em_brasilia() + 10)$q$),
  'o superadmin estende');

reset role;

select tests.ok('cobrança',
  ((select trial_ends_at from public.organizations where id = (select org_teste from tests.cb))
     at time zone 'America/Sao_Paulo')::date = public.hoje_em_brasilia() + 10
    and public.org_em_dia((select org_teste from tests.cb)),
  'o teste vai até o fim do dia escolhido, no horário de Brasília, e a empresa volta a ficar em dia');

select tests.ok('cobrança',
  exists (select 1 from public.audit_logs
           where org_id = (select org_teste from tests.cb) and entity = 'organizations'
             and actor_id = (select u_super from tests.cb) and diff ? 'trial_ends_at'),
  'a trilha do cliente guarda quem estendeu, e até quando');

-- ------------------------------------------------------ olhares de fora

select tests.login('cb-fora@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.contar('select count(*) from public.subscriptions') = 0
    and tests.contar('select count(*) from public.billing_customers') = 0
    and tests.contar('select count(*) from public.invoices') = 0,
  'outra empresa não vê nada da cobrança desta');

select tests.ok('cobrança',
  tests.contar('select count(*) from public.billing_events') = 0,
  'nem os avisos da Asaas');

reset role;
select tests.login('cb-membro@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.contar('select count(*) from public.invoices') = 0,
  'o membro não vê as faturas (valor e link de pagamento)');

reset role;
select tests.login('cb-suporte@teste.local');
set role authenticated;

select tests.ok('cobrança',
  tests.contar('select count(*) from public.invoices') >= 1
    and tests.contar('select count(*) from public.billing_events') >= 1,
  'a equipe vê faturas e avisos, para atender o cliente');

reset role;

-- ============================== grupo: links do app (Universal Links, C12)
--
-- A impressão digital do Android é do dono e do administrador; as datas de
-- vínculo e o erro, só do servidor — se o painel pudesse gravá-las, "vinculado"
-- viraria uma palavra que qualquer um escreve.

reset role;
drop table if exists tests.impressao;
create table tests.impressao as
select '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5'::text as valor;
grant select on tests.impressao to anon, authenticated, service_role;

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('links do app',
  tests.contar($q$select count(*) from public.apps
                where id = (select app_a from tests.lojas)
                  and android_cert_fingerprints = '{}'
                  and ios_links_linked_at is null and links_error is null$q$) = 1,
  'o dono lê as colunas dos links do próprio app');

select tests.ok('links do app',
  tests.permitido($q$update public.apps
                     set android_cert_fingerprints = array[(select valor from tests.impressao)]
                   where id = (select app_a from tests.lojas)$q$),
  'o dono salva a impressão digital do Android');

select tests.ok('links do app',
  tests.erro($q$update public.apps set android_cert_fingerprints = array['nao-e-impressao']
                where id = (select app_a from tests.lojas)$q$),
  'impressão fora do formato é recusada pelo banco');

select tests.ok('links do app',
  tests.erro($q$update public.apps
                   set android_cert_fingerprints = array_fill((select valor from tests.impressao), array[6])
                 where id = (select app_a from tests.lojas)$q$),
  'mais de cinco impressões é recusado');

select tests.ok('links do app',
  tests.erro($q$update public.apps set ios_links_linked_at = now()
                where id = (select app_a from tests.lojas)$q$),
  'o painel NÃO grava a data de vínculo: só o servidor, depois da Shopify');

select tests.ok('links do app',
  tests.erro($q$update public.apps set links_error = null
                where id = (select app_a from tests.lojas)$q$),
  'nem o erro da última tentativa');

select tests.ok('links do app',
  tests.erro($q$select public.registrar_links_do_app(
                 (select app_a from tests.lojas), (select u_a_owner from tests.ids), 'vinculado')$q$),
  'o dono NÃO chama o registro do vínculo por conta própria');

select tests.ok('links do app',
  tests.bloqueado($q$update public.apps set android_cert_fingerprints = '{}'
                     where id = (select app_b from tests.lojas)$q$),
  'nem mexe nos links do app de outra empresa');

reset role;
select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('links do app',
  tests.bloqueado($q$update public.apps set android_cert_fingerprints = '{}'
                     where id = (select app_a from tests.lojas)$q$),
  'o membro vê, mas não troca a impressão');

reset role;
select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('links do app',
  tests.contar($q$select count(*) from public.apps
                where id = (select app_a from tests.lojas)$q$) = 0,
  'outra empresa não enxerga os links do app alheio');

-- O servidor grava o resultado, com quem pediu na trilha.
reset role;
set role service_role;

select public.registrar_links_do_app(
  (select app_a from tests.lojas), (select u_a_owner from tests.ids), 'vinculado', 'vinculado');

reset role;

select tests.ok('links do app',
  (select ios_links_linked_at is not null and android_links_linked_at is not null
          and links_error is null
     from public.apps where id = (select app_a from tests.lojas)),
  'o vínculo que deu certo fica com a data');

select tests.ok('links do app',
  exists (select 1 from public.audit_logs
           where entity = 'apps' and entity_id = (select app_a from tests.lojas)
             and actor_id = (select u_a_owner from tests.ids)
             and diff ? 'ios_links_linked_at'),
  'e a trilha credita quem pediu, e não "o sistema"');

set role service_role;
select public.registrar_links_do_app(
  (select app_a from tests.lojas), (select u_a_owner from tests.ids),
  p_android => 'falhou', p_erro => 'A Shopify não respondeu agora.');
reset role;

select tests.ok('links do app',
  (select android_links_linked_at is not null and links_error = 'A Shopify não respondeu agora.'
     from public.apps where id = (select app_a from tests.lojas)),
  'uma falha não apaga o vínculo anterior: mostra o erro ao lado da data');

select tests.ok('links do app',
  tests.erro($q$select public.registrar_links_do_app(
                 (select app_a from tests.lojas), null, 'talvez')$q$),
  'resultado desconhecido é recusado');

select tests.login('a-owner@teste.local');
set role authenticated;
update public.apps set android_cert_fingerprints = '{}'
 where id = (select app_a from tests.lojas);
reset role;

select tests.ok('links do app',
  (select android_links_linked_at is null and ios_links_linked_at is not null
     from public.apps where id = (select app_a from tests.lojas)),
  'trocar a impressão desfaz o vínculo do Android, e só o dele');

-- Desconectada a Shopify, o vínculo deixa de ser nosso para afirmar.
update public.stores set shopify_scopes = array['read_orders']
 where id = (select loja_a from tests.lojas);

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('links do app',
  tests.permitido($q$update public.stores set shopify_scopes = null
                   where id = (select loja_a from tests.lojas)$q$),
  'o dono desconecta a Shopify pelo painel');

reset role;

select tests.ok('links do app',
  (select ios_links_linked_at is null and android_links_linked_at is null and links_error is null
     from public.apps where id = (select app_a from tests.lojas)),
  'e a data de vínculo sai junto, sem o dono poder gravar a coluna');

-- ============================== grupo: batimento dos jobs (Fase 8)
--
-- Só o servidor anota; a equipe lê tudo; o público lê só as datas.

reset role;
set role service_role;
select public.registrar_batimento('dispatch-push', false, 1200, 'OneSignal fora do ar');
select public.registrar_batimento('dispatch-push', true, 800);
reset role;

select tests.ok('batimento',
  (select last_success_at is not null and last_failure_at is not null
          and last_error = 'OneSignal fora do ar' and last_duration_ms = 800
     from public.job_heartbeats where job = 'dispatch-push'),
  'a execução certa e a errada ficam anotadas, com o erro da última falha');

select tests.ok('batimento',
  (select failing_since is null from public.job_heartbeats where job = 'dispatch-push'),
  'depois de um sucesso, não está falhando desde nada');

set role service_role;
select public.registrar_batimento('push-stats', false, null, 'primeira falha');
reset role;
update public.job_heartbeats set failing_since = now() - interval '3 hours'
 where job = 'push-stats';
set role service_role;
select public.registrar_batimento('push-stats', false, null, 'segunda falha');
reset role;

select tests.ok('batimento',
  (select failing_since < now() - interval '2 hours' and last_error = 'segunda falha'
     from public.job_heartbeats where job = 'push-stats'),
  'falhas seguidas guardam desde quando falha, e o erro da mais recente');

select tests.ok('batimento',
  tests.erro($q$select public.registrar_batimento('job-que-nao-existe', true)$q$),
  'job desconhecido é recusado');

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('batimento',
  tests.contar('select count(*) from public.job_heartbeats') = 0,
  'o lojista não lê os batimentos (nem o erro)');

select tests.ok('batimento',
  tests.erro($q$select public.registrar_batimento('dispatch-push', true)$q$),
  'nem anota um batimento por conta própria');

select tests.ok('batimento',
  tests.bloqueado($q$update public.job_heartbeats set last_success_at = now()$q$),
  'nem mexe nas datas');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('batimento',
  tests.contar($q$select count(*) from public.job_heartbeats
                where job = 'dispatch-push' and last_error is not null$q$) = 1,
  'a equipe da plataforma lê tudo, inclusive o erro');

reset role;
set role anon;

select tests.ok('batimento',
  tests.contar($q$select count(*) from public.batimentos_publicos()
                where job = 'dispatch-push' and ultimo_sucesso is not null$q$) = 1,
  'o público lê as datas pela página de status');

select tests.ok('batimento',
  tests.erro('select * from public.job_heartbeats'),
  'mas não a tabela, que tem o texto do erro');

reset role;

-- ============================== grupo: inativos (Fase 8)
--
-- "Sentimos sua falta": quem abriu o app pela última vez há 7 a 9 dias recebe
-- UM aviso por sumiço, na hora que o lojista escolheu do 7º dia; quem voltou
-- antes do envio não recebe. As datas são sempre relativas ao "hoje" da loja,
-- para a suíte valer a qualquer hora do dia.

reset role;

insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'inactive_7d', true, 600, 'Sentimos sua falta', 'Vem ver as novidades.'
from tests.lojas
on conflict (app_id, type) do update set enabled = true, delay_minutes = 600;

insert into public.devices (app_id, onesignal_subscription_id, platform)
select app_a, sub, 'ios'
  from tests.lojas, unnest(array['sub-sumido-7', 'sub-sumido-12', 'sub-voltou', 'sub-ativo']) sub;
insert into public.devices (app_id, onesignal_subscription_id, platform)
select app_b, 'sub-sumido-da-outra-org', 'android' from tests.lojas;

create table tests.hoje_da_loja as
select (now() at time zone s.timezone)::date as hoje, s.timezone as fuso
  from public.stores s where s.id = (select loja_a from tests.lojas);

-- A história de uso de cada aparelho, em dias da loja.
insert into public.device_days (app_id, device_id, day)
select d.app_id, d.id, h.hoje - dias.n
  from public.devices d
  cross join tests.hoje_da_loja h
  join (values
    ('sub-sumido-7', 20), ('sub-sumido-7', 7),
    ('sub-sumido-12', 12),
    ('sub-voltou', 8), ('sub-voltou', 1),
    ('sub-ativo', 0),
    ('sub-sumido-da-outra-org', 7)
  ) as dias(sub, n) on dias.sub = d.onesignal_subscription_id;

set role service_role;
select public.agendar_inativos();
reset role;

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-7'
      and r.trigger_ref = 'inativo:' || ((select hoje from tests.hoje_da_loja) - 7)::text
      and r.status = 'scheduled'$q$) = 1,
  'quem abriu o app pela última vez há 7 dias recebe o aviso');

select tests.ok('inativos',
  (select extract(hour from r.scheduled_for at time zone h.fuso)::integer = 10
          and (r.scheduled_for at time zone h.fuso)::date = h.hoje
     from public.automation_runs r
     join public.devices d on d.id = r.device_id
     cross join tests.hoje_da_loja h
    where d.onesignal_subscription_id = 'sub-sumido-7'),
  'na hora escolhida do 7º dia, no fuso da loja (10h)');

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id in ('sub-sumido-12', 'sub-voltou', 'sub-ativo')$q$) = 0,
  'sumido há 12 dias, quem voltou depois e quem usou hoje não recebem');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-da-outra-org'$q$) = 0,
  'a outra organização, sem a automação ligada, não recebe nada');

set role service_role;
select public.agendar_inativos();
reset role;

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-7'$q$) = 1,
  'rodar de novo não repete: um aviso por sumiço');

-- Desligada, nada é agendado — nem para quem acabou de completar 7 dias.
insert into public.devices (app_id, onesignal_subscription_id, platform)
select app_a, 'sub-sumido-8', 'android' from tests.lojas;
insert into public.device_days (app_id, device_id, day)
select d.app_id, d.id, (select hoje from tests.hoje_da_loja) - 8
  from public.devices d where d.onesignal_subscription_id = 'sub-sumido-8';
update public.push_automations set enabled = false
 where app_id = (select app_a from tests.lojas) and type = 'inactive_7d';

set role service_role;
select public.agendar_inativos();
reset role;

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-8'$q$) = 0,
  'automação desligada não agenda nada');

update public.push_automations set enabled = true
 where app_id = (select app_a from tests.lojas) and type = 'inactive_7d';

-- Ligada de novo, quem está na janela (8 dias) entra.
set role service_role;
select public.agendar_inativos();
reset role;

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-8'$q$) = 1,
  'a janela vai até 9 dias: uma hora ou um dia sem cron não deixa ninguém de fora');

-- Voltou ao app antes do envio: o despacho cancela.
insert into public.device_days (app_id, device_id, day)
select d.app_id, d.id, (select hoje from tests.hoje_da_loja)
  from public.devices d where d.onesignal_subscription_id = 'sub-sumido-7';

set role service_role;
select count(*) from public.reservar_envios_de_automacao(1000);
reset role;

select tests.ok('inativos',
  (select r.status = 'canceled' and r.canceled_reason = 'voltou a abrir o app'
     from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-7'),
  'quem voltou ao app antes do envio não recebe o "sentimos sua falta"');

select tests.ok('inativos',
  (select r.status <> 'canceled'
     from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-sumido-8'),
  'e quem continua sumido segue na fila');

set role service_role;
select public.registrar_batimento('inactive-devices', true, 120);
reset role;

select tests.ok('inativos',
  tests.contar($q$select count(*) from public.job_heartbeats
    where job = 'inactive-devices' and last_success_at is not null$q$) = 1,
  'o job de hora em hora anota o próprio batimento');

select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('inativos',
  tests.erro($q$select public.agendar_inativos()$q$),
  'o lojista não dispara o agendamento por conta própria');

reset role;
set role anon;

select tests.ok('inativos',
  tests.erro($q$select public.agendar_inativos()$q$),
  'nem o anônimo');

reset role;
drop table tests.hoje_da_loja;

-- ============================== grupo: webhook de automação (C09 e C14)
--
-- A chave com que o Klaviyo, o Omnisend e o n8n mandam push pelo app. O
-- banco guarda só o hash, numa coluna que ninguém do painel lê; só o servidor
-- grava; a trilha diz quem criou, trocou e desativou, sem o hash. O
-- agendamento acha os aparelhos do cliente só no app da chave.

reset role;

insert into public.push_automations (app_id, type, enabled, delay_minutes, title, body)
select app_a, 'custom_webhook', false, 0, 'Texto da automação', 'Corpo da automação'
  from tests.lojas;

create table tests.webhook as
select pa.id as automacao, repeat('a', 64) as hash_1, repeat('b', 64) as hash_2
  from public.push_automations pa
 where pa.app_id = (select app_a from tests.lojas) and pa.type = 'custom_webhook';
grant select on tests.webhook to anon, authenticated, service_role;

insert into public.devices (app_id, onesignal_subscription_id, platform, external_id)
select app_a, v.sub, 'ios', v.cliente
  from tests.lojas,
       (values ('sub-wh-1001-a', '1001'), ('sub-wh-1001-b', '1001'), ('sub-wh-1002', '1002'),
               ('sub-wh-anonimo', null)) as v(sub, cliente);
-- O mesmo id de cliente, na loja da outra organização.
insert into public.devices (app_id, onesignal_subscription_id, platform, external_id)
select app_b, 'sub-wh-outra-org-1001', 'android', '1001' from tests.lojas;
-- Um cliente com doze aparelhos: o 1 é o usado por último, o 12 o mais antigo.
insert into public.devices (app_id, onesignal_subscription_id, platform, external_id, last_seen_at)
select app_a, 'sub-wh-1003-' || n, 'android', '1003', now() - make_interval(mins => n)
  from tests.lojas, generate_series(1, 12) n;

set role service_role;
select public.definir_chave_do_webhook(
  (select automacao from tests.webhook), (select u_a_owner from tests.ids),
  (select hash_1 from tests.webhook), 'h1h1');
reset role;

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.automation_webhooks w
    where w.app_id = (select app_a from tests.lojas) and w.token_hint = 'h1h1'
      and w.token_hash = (select hash_1 from tests.webhook)
      and w.created_by = (select u_a_owner from tests.ids)$q$) = 1,
  'o servidor grava a chave: o hash e os 4 últimos caracteres, nunca a chave');

select tests.ok('webhook',
  (select l.actor_id = t.u_a_owner and l.action = 'create' and l.org_id = t.org_a
     from public.audit_logs l, tests.ids t
    where l.entity = 'automation_webhooks'
    order by l.created_at desc limit 1),
  'a trilha credita quem gerou a chave, na organização da loja');

-- ---------------------------------------------------------- quem lê o quê

select tests.login('a-member@teste.local');
set role authenticated;

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.automation_webhooks
    where token_hint = 'h1h1' and received_count = 0 and created_at is not null$q$) = 1,
  'o membro da loja vê a dica, a data e a contagem');

select tests.ok('webhook',
  tests.erro($q$select token_hash from public.automation_webhooks$q$),
  'mas o hash da chave, ninguém do painel lê');

select tests.ok('webhook',
  tests.erro($q$select * from public.automation_webhooks$q$),
  'nem por select *');

reset role;
select tests.login('b-owner@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar('select count(*) from public.automation_webhooks') = 0,
  'a outra organização não vê nem a dica da chave');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.automation_webhooks where token_hint = 'h1h1'$q$) = 1,
  'a equipe da plataforma vê a dica, para o suporte');

-- ------------------------------------------------------- só o servidor grava

reset role;
select tests.login('a-owner@teste.local');
set role authenticated;

select tests.ok('webhook',
  tests.bloqueado($q$update public.automation_webhooks set token_hint = 'zzzz'$q$),
  'nem o proprietário mexe na chave direto: só o servidor, depois de conferir o papel');

select tests.ok('webhook',
  tests.bloqueado(format(
    $q$insert into public.automation_webhooks (automation_id, app_id, token_hash, token_hint)
       values (%L, %L, %L, 'zzzz')$q$,
    (select automacao from tests.webhook), (select app_a from tests.lojas), repeat('c', 64))),
  'nem cria uma chave que ele mesmo escolheu');

select tests.ok('webhook',
  tests.bloqueado($q$delete from public.automation_webhooks$q$),
  'nem apaga a chave por fora da trilha');

select tests.ok('webhook',
  tests.erro(format($q$select public.definir_chave_do_webhook(%L, %L, %L, 'zzzz')$q$,
    (select automacao from tests.webhook), (select u_a_owner from tests.ids), repeat('c', 64))),
  'o lojista não chama a função que grava a chave');

select tests.ok('webhook',
  tests.erro(format($q$select public.remover_chave_do_webhook(%L, %L)$q$,
    (select automacao from tests.webhook), (select u_a_owner from tests.ids))),
  'nem a que desativa');

select tests.ok('webhook',
  tests.erro(format($q$select * from public.ler_webhook_de_automacao(%L)$q$,
    (select hash_1 from tests.webhook))),
  'nem a que acha a automação pela chave');

select tests.ok('webhook',
  tests.erro(format($q$select public.agendar_pelo_webhook(%L, array['1001'])$q$,
    (select automacao from tests.webhook))),
  'nem a que agenda o envio');

reset role;
set role anon;

select tests.ok('webhook',
  tests.erro($q$select count(*) from public.automation_webhooks$q$)
  and tests.erro(format($q$select * from public.ler_webhook_de_automacao(%L)$q$,
    (select hash_1 from tests.webhook))),
  'o anônimo não lê a tabela nem chama as funções');

-- ------------------------------------------------------ receber e agendar

reset role;
set role service_role;
create table tests.webhook_lido as
select * from public.ler_webhook_de_automacao((select hash_1 from tests.webhook));
create table tests.webhook_nao_achado as
select * from public.ler_webhook_de_automacao(repeat('f', 64));
create table tests.webhook_desligada as
select public.agendar_pelo_webhook((select automacao from tests.webhook), array['1001']) as agendados;
reset role;

select tests.ok('webhook',
  (select l.automacao = w.automacao and l.app_id = t.app_a and l.store_id = t.loja_a
          and l.primary_url = 'https://loja-a.com.br' and not l.ligada
     from tests.webhook_lido l, tests.lojas t, tests.webhook w),
  'pela chave, o servidor acha a automação, a loja e se ela está ligada');

select tests.ok('webhook',
  tests.contar('select count(*) from tests.webhook_nao_achado') = 0,
  'chave desconhecida não acha nada');

select tests.ok('webhook',
  (select agendados = 0 from tests.webhook_desligada)
  and tests.contar(format('select count(*) from public.automation_runs where automation_id = %L',
        (select automacao from tests.webhook))) = 0,
  'desligada, a chamada não agenda nada');

select tests.ok('webhook',
  (select w.received_count = 1 and w.last_received_at is not null
     from public.automation_webhooks w
    where w.automation_id = (select automacao from tests.webhook)),
  'mas fica anotada: é o que mostra ao lojista que a ferramenta está chamando');

-- O envio vai na hora. Num fuso em que agora é de dia, a madrugada não o
-- empurra, e o despacho lá embaixo o encontra a qualquer hora que a suíte rode.
create table tests.fuso_original as
select timezone from public.stores where id = (select loja_a from tests.lojas);
update public.stores
   set timezone = case
     when extract(hour from now() at time zone 'America/Sao_Paulo') between 9 and 20
       then 'America/Sao_Paulo'
     else 'Asia/Tokyo'
   end
 where id = (select loja_a from tests.lojas);
update public.push_automations set enabled = true
 where id = (select automacao from tests.webhook);

set role service_role;
create table tests.webhook_agendado as
select public.agendar_pelo_webhook((select automacao from tests.webhook),
  array['1001', '1002', '9999'],
  p_titulo => 'Seu cupom chegou', p_link => '/products/camiseta', p_ref => 'evento-1') as agendados;
create table tests.webhook_repetido as
select public.agendar_pelo_webhook((select automacao from tests.webhook), array['1001', '1002'],
  p_titulo => 'Seu cupom chegou', p_ref => 'evento-1') as agendados;
reset role;

select tests.ok('webhook',
  (select agendados = 3 from tests.webhook_agendado),
  'ligada, agenda um envio por aparelho de cada cliente do chamado');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-wh-outra-org-1001'$q$) = 0,
  'o mesmo id de cliente na loja de outra organização não recebe: o cliente é do app da chave');

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id = 'sub-wh-anonimo'$q$) = 0,
  'aparelho sem cliente identificado não recebe');

select tests.ok('webhook',
  (select agendados = 0 from tests.webhook_repetido)
  and tests.contar(format('select count(*) from public.automation_runs where automation_id = %L',
        (select automacao from tests.webhook))) = 3,
  'a mesma entrega repetida (mesmo id de evento) não agenda de novo');

select tests.ok('webhook',
  (select bool_and(r.trigger_ref = 'webhook:evento-1' and r.title = 'Seu cupom chegou'
                   and r.body is null and r.deep_link = '/products/camiseta'
                   and r.status = 'scheduled' and r.scheduled_for <= now())
     from public.automation_runs r
    where r.automation_id = (select automacao from tests.webhook)),
  'o envio guarda o título e o link do chamado, e sai na hora; o texto que não veio fica para o da automação');

set role service_role;
-- O 1003 tem doze aparelhos; o 1001, dois. O teto é de cada cliente.
create table tests.webhook_doze as
select public.agendar_pelo_webhook((select automacao from tests.webhook),
  array['1003', '1001']) as agendados;
create table tests.webhook_sem_id_1 as
select public.agendar_pelo_webhook((select automacao from tests.webhook), array['1002']) as agendados;
create table tests.webhook_sem_id_2 as
select public.agendar_pelo_webhook((select automacao from tests.webhook), array['1002']) as agendados;
reset role;

select tests.ok('webhook',
  (select agendados = 12 from tests.webhook_doze),
  'no máximo dez aparelhos POR CLIENTE, e não por chamada: o 1003 recebe em dez, o 1001 nos dois');

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.automation_runs r
     join public.devices d on d.id = r.device_id
    where d.onesignal_subscription_id in ('sub-wh-1003-11', 'sub-wh-1003-12')$q$) = 0,
  'os dois aparelhos esquecidos há mais tempo ficam de fora');

select tests.ok('webhook',
  (select agendados = 1 from tests.webhook_sem_id_1)
  and (select agendados = 1 from tests.webhook_sem_id_2),
  'sem id de evento, cada chamada é um aviso novo');

select tests.ok('webhook',
  (select w.received_count = 6
     from public.automation_webhooks w
    where w.automation_id = (select automacao from tests.webhook)),
  'cada chamada conta, ligada ou desligada');

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.audit_logs where entity = 'automation_webhooks'$q$) = 1,
  'e a contagem não enche a trilha: só criar, trocar e desativar a chave entram nela');

set role service_role;
create table tests.webhook_despacho as
select * from public.reservar_envios_de_automacao(1000);
reset role;

select tests.ok('webhook',
  tests.contar($q$select count(*) from tests.webhook_despacho d
     join public.automation_runs r on r.id = d.id
    where r.trigger_ref = 'webhook:evento-1'
      and d.title = 'Seu cupom chegou' and d.body = 'Corpo da automação'
      and d.deep_link = '/products/camiseta'$q$) = 3,
  'no despacho, o título do chamado vence o da automação, e o texto que não veio é o dela');

select tests.ok('webhook',
  tests.contar($q$select count(*) from tests.webhook_despacho d
     join public.automation_runs r on r.id = d.id
    where r.trigger_ref = 'webhook'
      and d.title = 'Texto da automação' and d.body = 'Corpo da automação'$q$) = 14,
  'chamado sem texto vai com o texto da automação');

-- -------------------------------------------------- trocar e desativar

set role service_role;
select public.definir_chave_do_webhook(
  (select automacao from tests.webhook), (select u_a_admin from tests.ids),
  (select hash_2 from tests.webhook), 'h2h2');
create table tests.webhook_velha as
select * from public.ler_webhook_de_automacao((select hash_1 from tests.webhook));
create table tests.webhook_nova as
select * from public.ler_webhook_de_automacao((select hash_2 from tests.webhook));
reset role;

select tests.ok('webhook',
  tests.contar('select count(*) from tests.webhook_velha') = 0
  and tests.contar('select count(*) from tests.webhook_nova') = 1,
  'trocar a chave desfaz a anterior na hora');

select tests.ok('webhook',
  (select w.received_count = 0 and w.last_received_at is null and w.token_hint = 'h2h2'
          and w.created_by = (select u_a_admin from tests.ids)
     from public.automation_webhooks w
    where w.automation_id = (select automacao from tests.webhook)),
  'chave nova, contagem nova: o "último aviso" era da anterior');

select tests.ok('webhook',
  (select l.actor_id = t.u_a_admin and l.action = 'update'
     from public.audit_logs l, tests.ids t
    where l.entity = 'automation_webhooks'
    order by l.created_at desc limit 1),
  'a troca fica na trilha, em nome de quem trocou');

set role service_role;
create table tests.webhook_remocao_1 as
select public.remover_chave_do_webhook((select automacao from tests.webhook),
  (select u_a_owner from tests.ids)) as removida;
create table tests.webhook_remocao_2 as
select public.remover_chave_do_webhook((select automacao from tests.webhook),
  (select u_a_owner from tests.ids)) as removida;
create table tests.webhook_depois as
select * from public.ler_webhook_de_automacao((select hash_2 from tests.webhook));
reset role;

select tests.ok('webhook',
  (select removida from tests.webhook_remocao_1)
  and not (select removida from tests.webhook_remocao_2)
  and tests.contar('select count(*) from tests.webhook_depois') = 0,
  'desativar tira a chave do ar; desativar de novo não finge que tirou');

select tests.ok('webhook',
  (select l.actor_id = t.u_a_owner and l.action = 'delete'
     from public.audit_logs l, tests.ids t
    where l.entity = 'automation_webhooks'
    order by l.created_at desc limit 1),
  'a desativação fica na trilha, em nome de quem desativou');

select tests.ok('webhook',
  tests.contar($q$select count(*) from public.audit_logs
    where entity = 'automation_webhooks'
      and (diff::text like '%token_hash%'
           or diff::text like '%aaaaaaaaaaaaaaaa%'
           or diff::text like '%bbbbbbbbbbbbbbbb%')$q$) = 0,
  'nenhuma linha da trilha carrega o hash da chave');

set role service_role;
create table tests.webhook_tipo_errado as
select tests.erro_com(format($q$select public.definir_chave_do_webhook(%L, %L, %L, 'zzzz')$q$,
  (select id from public.push_automations
    where app_id = (select app_a from tests.lojas) and type = 'inactive_7d'),
  (select u_a_owner from tests.ids), repeat('c', 64)), 'não encontrada') as recusou;
create table tests.webhook_hash_errado as
select tests.erro(format($q$select public.definir_chave_do_webhook(%L, %L, 'nao-e-um-hash', 'zzzz')$q$,
  (select automacao from tests.webhook), (select u_a_owner from tests.ids))) as recusou;
select public.definir_chave_do_webhook(
  (select automacao from tests.webhook), (select u_a_owner from tests.ids),
  (select hash_1 from tests.webhook), 'h1h1');
reset role;

select tests.ok('webhook',
  (select recusou from tests.webhook_tipo_errado),
  'a chave só vale para a automação de webhook');

select tests.ok('webhook',
  (select recusou from tests.webhook_hash_errado),
  'e o banco só aceita um sha256 como hash');

delete from public.push_automations where id = (select automacao from tests.webhook);

select tests.ok('webhook',
  tests.contar('select count(*) from public.automation_webhooks') = 0,
  'excluir a automação leva a chave junto');

update public.stores set timezone = (select timezone from tests.fuso_original)
 where id = (select loja_a from tests.lojas);
drop table tests.webhook, tests.webhook_lido, tests.webhook_nao_achado, tests.webhook_desligada,
  tests.fuso_original, tests.webhook_agendado, tests.webhook_repetido, tests.webhook_doze,
  tests.webhook_sem_id_1, tests.webhook_sem_id_2, tests.webhook_despacho, tests.webhook_velha,
  tests.webhook_nova, tests.webhook_remocao_1, tests.webhook_remocao_2, tests.webhook_depois,
  tests.webhook_tipo_errado, tests.webhook_hash_errado;

-- ============================== grupo: a identidade do app (migration 51)
--
-- O identificador nas lojas de aplicativos, o número do app na Apple e o nome.
-- Só o servidor escreve, pela função que confere e credita quem pediu; o
-- identificador tem o formato das duas lojas, é único entre os apps da
-- Storefy e não muda depois de chegar a uma delas. Duas empresas novas, com
-- uma loja cada, para a trava não depender do que os grupos anteriores
-- deixaram nos apps (e cada empresa em teste só tem direito a uma loja).

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('id-dono@teste.local',  '{"company_name":"Empresa da Identidade"}'::jsonb, now()),
  ('id-apple@teste.local', '{"company_name":"Empresa da Apple"}'::jsonb,      now());

insert into public.stores (org_id, name, primary_url)
select m.org_id, 'Loja da Identidade', 'https://identidade.teste'
  from public.memberships m join auth.users u on u.id = m.user_id
 where u.email = 'id-dono@teste.local';
insert into public.stores (org_id, name, primary_url)
select m.org_id, 'Loja da Apple', 'https://naapple.teste'
  from public.memberships m join auth.users u on u.id = m.user_id
 where u.email = 'id-apple@teste.local';

drop table if exists tests.identidade;
create table tests.identidade as
select
  (select id from auth.users where email = 'id-dono@teste.local') as u_dono,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja da Identidade') as app,
  (select s.id from public.stores s where s.name = 'Loja da Identidade') as loja,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja da Apple') as app_apple;
grant select on tests.identidade to anon, authenticated, service_role;

select tests.login('id-dono@teste.local');
set role authenticated;

select tests.ok('identidade',
  tests.erro($q$update public.apps set bundle_id_ios = 'br.com.direto.app'
                where id = (select app from tests.identidade)$q$),
  'o dono NÃO grava o identificador direto: só pela função do servidor');

select tests.ok('identidade',
  tests.erro($q$update public.apps set display_name = 'Outro nome'
                where id = (select app from tests.identidade)$q$),
  'nem o nome do app');

select tests.ok('identidade',
  tests.erro($q$update public.apps set expo_project_id = 'projeto-de-outro'
                where id = (select app from tests.identidade)$q$),
  'nem o projeto do Expo, que decide onde o binário é gerado');

select tests.ok('identidade',
  tests.erro($q$update public.apps set onesignal_app_id = 'app-de-outro'
                where id = (select app from tests.identidade)$q$),
  'nem o app do OneSignal');

select tests.ok('identidade',
  tests.erro($q$insert into public.apps (store_id, display_name)
                values ((select loja from tests.identidade), 'Segundo app')$q$),
  'nem cria app por fora: o app nasce com a loja');

select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app from tests.identidade), (select u_dono from tests.identidade),
                 'br.com.x.app')$q$),
  'o dono NÃO chama a função do identificador por conta própria');

select tests.ok('identidade',
  tests.erro($q$select public.renomear_app(
                 (select app from tests.identidade), (select u_dono from tests.identidade), 'Nome')$q$),
  'nem a do nome');

select tests.ok('identidade',
  tests.erro($q$select public.registrar_app_na_apple(
                 (select app from tests.identidade), (select u_dono from tests.identidade),
                 '6478123456')$q$),
  'nem a do número na Apple, que só vale depois de a Apple responder');

reset role;
set role service_role;

select public.definir_identificador_do_app(
  (select app from tests.identidade), (select u_dono from tests.identidade),
  '  BR.com.Identidade.app ');

reset role;

select tests.ok('identidade',
  (select bundle_id_ios = 'br.com.identidade.app' and package_android = 'br.com.identidade.app'
     from public.apps where id = (select app from tests.identidade)),
  'a função grava o mesmo identificador nas duas lojas, em minúsculas e sem espaço');

select tests.ok('identidade',
  exists (select 1 from public.audit_logs
           where entity = 'apps' and entity_id = (select app from tests.identidade)
             and actor_id = (select u_dono from tests.identidade)
             and diff ? 'bundle_id_ios'),
  'e a trilha credita quem pediu');

set role service_role;

select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app from tests.identidade), null, 'br.com.loja-x.app')$q$),
  'hífen é recusado: o Google não aceita');

select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app from tests.identidade), null, 'semponto')$q$),
  'identificador de uma parte só é recusado');

select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app_apple from tests.identidade), null, 'br.com.identidade.app')$q$),
  'o mesmo identificador em dois apps da Storefy é recusado');

select tests.ok('identidade',
  tests.erro($q$select public.registrar_app_na_apple(
                 (select app from tests.identidade), null, 'abc123')$q$),
  'número de app da Apple fora do formato é recusado');

select tests.ok('identidade',
  tests.erro($q$select public.renomear_app((select app from tests.identidade), null, '   ')$q$),
  'nome vazio é recusado');

select tests.ok('identidade',
  tests.erro($q$select public.renomear_app(
                 (select app from tests.identidade), null, repeat('a', 31))$q$),
  'nome acima de 30 caracteres é recusado: a App Store cortaria');

select public.renomear_app(
  (select app from tests.identidade), (select u_dono from tests.identidade), '  Minha   Loja  ');

reset role;

select tests.ok('identidade',
  (select display_name = 'Minha Loja'
     from public.apps where id = (select app from tests.identidade)),
  'o nome é gravado sem os espaços sobrando');

-- Um build que morreu antes de gerar o binário não trava nada.
insert into public.builds (app_id, platform, profile, status)
select app, 'ios', 'production', 'errored' from tests.identidade;

set role service_role;
select tests.ok('identidade',
  tests.permitido($q$select public.definir_identificador_do_app(
                     (select app from tests.identidade), null, 'br.com.identidade.loja')$q$),
  'antes de o app chegar a uma loja, o identificador ainda troca');
reset role;

-- O binário gerado para o iPhone, sim: dali em diante o app é daquele identificador.
insert into public.builds (app_id, platform, profile, status)
select app, 'ios', 'production', 'finished' from tests.identidade;

set role service_role;
select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app from tests.identidade), null, 'br.com.outro.app')$q$),
  'depois do binário gerado, o identificador não muda mais');
reset role;

select tests.ok('identidade',
  tests.erro($q$update public.apps set bundle_id_ios = 'br.com.outro.app'
                where id = (select app from tests.identidade)$q$),
  'a trava vale para qualquer um, até para quem escreve direto no banco');

-- O app criado na Apple também trava, mesmo sem build nenhum.
set role service_role;
select public.definir_identificador_do_app(
  (select app_apple from tests.identidade), null, 'br.com.naapple.app');
select public.registrar_app_na_apple(
  (select app_apple from tests.identidade), (select u_dono from tests.identidade), '6478123456');
select tests.ok('identidade',
  tests.erro($q$select public.definir_identificador_do_app(
                 (select app_apple from tests.identidade), null, 'br.com.outronome.app')$q$),
  'com o app criado no App Store Connect, o identificador não muda mais');
reset role;

select tests.ok('identidade',
  (select ios_asc_app_id = '6478123456'
     from public.apps where id = (select app_apple from tests.identidade)),
  'o número do app na Apple fica guardado para o envio e o banner');

select tests.logout();
delete from public.stores where name in ('Loja da Identidade', 'Loja da Apple');
drop table tests.identidade;

-- ============================== grupo: o status da loja (migration 53)
--
-- O status vem dos builds do app, por gatilho; a sessão não o escreve. Uma
-- empresa nova por caso, porque cada empresa em teste só tem uma loja.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('st-dono@teste.local',  '{"company_name":"Empresa do Status"}'::jsonb,  now()),
  ('st-pausa@teste.local', '{"company_name":"Empresa Pausada"}'::jsonb,    now());

insert into public.stores (org_id, name, primary_url)
select m.org_id, 'Loja do Status', 'https://status.teste'
  from public.memberships m join auth.users u on u.id = m.user_id
 where u.email = 'st-dono@teste.local';
insert into public.stores (org_id, name, primary_url)
select m.org_id, 'Loja Pausada', 'https://pausada.teste'
  from public.memberships m join auth.users u on u.id = m.user_id
 where u.email = 'st-pausa@teste.local';

drop table if exists tests.status;
create table tests.status as
select
  (select s.id from public.stores s where s.name = 'Loja do Status') as loja,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja do Status') as app,
  (select s.id from public.stores s where s.name = 'Loja Pausada') as loja_pausada,
  (select a.id from public.apps a join public.stores s on s.id = a.store_id
    where s.name = 'Loja Pausada') as app_pausado;
grant select on tests.status to anon, authenticated, service_role;

select tests.ok('status da loja',
  (select status = 'draft' from public.stores where id = (select loja from tests.status)),
  'loja nova, sem build, é rascunho');

select tests.login('st-dono@teste.local');
set role authenticated;
select tests.ok('status da loja',
  tests.erro($q$update public.stores set status = 'live'
                where id = (select loja from tests.status)$q$),
  'o dono NÃO se declara "No ar" pela API');
reset role;
select tests.logout();

insert into public.builds (app_id, platform, profile, status)
select app, 'ios', 'production', 'queued' from tests.status;
select tests.ok('status da loja',
  (select status = 'building' from public.stores where id = (select loja from tests.status)),
  'com um build na fila, gerando app');

update public.builds set status = 'submitted', submitted_at = now()
 where app_id = (select app from tests.status);
select tests.ok('status da loja',
  (select status = 'in_review' from public.stores where id = (select loja from tests.status)),
  'enviado à loja de aplicativos, em revisão');

update public.builds set status = 'rejected'
 where app_id = (select app from tests.status);
select tests.ok('status da loja',
  (select status = 'rejected' from public.stores where id = (select loja from tests.status)),
  'recusado, e nada novo em curso: revisão recusada');

insert into public.builds (app_id, platform, profile, status)
select app, 'ios', 'production', 'building' from tests.status;
select tests.ok('status da loja',
  (select status = 'building' from public.stores where id = (select loja from tests.status)),
  'um build novo depois da recusa: gerando app de novo');

update public.builds set status = 'approved'
 where app_id = (select app from tests.status) and status = 'building';
select tests.ok('status da loja',
  (select status = 'live' from public.stores where id = (select loja from tests.status)),
  'aprovado: no ar');

insert into public.builds (app_id, platform, profile, status, submitted_at)
select app, 'android', 'production', 'submitted', now() from tests.status;
select tests.ok('status da loja',
  (select status = 'live' from public.stores where id = (select loja from tests.status)),
  'uma atualização em revisão não tira do ar o que já está aprovado');

select tests.ok('status da loja',
  exists (select 1 from public.audit_logs
           where entity = 'stores' and entity_id = (select loja from tests.status)
             and diff ? 'status'),
  'cada mudança de status fica na trilha');

-- A pausa é decisão de pessoa: o gatilho não a desfaz.
update public.stores set status = 'paused' where id = (select loja_pausada from tests.status);
insert into public.builds (app_id, platform, profile, status)
select app_pausado, 'ios', 'production', 'approved' from tests.status;
select tests.ok('status da loja',
  (select status = 'paused' from public.stores where id = (select loja_pausada from tests.status)),
  'loja pausada continua pausada, mesmo com o app aprovado');

select tests.ok('status da loja',
  public.status_da_loja_pelos_builds((select app_pausado from tests.status)) = 'live',
  'mas o cálculo diz o que os builds dizem');

delete from public.stores where name in ('Loja do Status', 'Loja Pausada');
drop table tests.status;

-- ============================== grupo: A12 — quem fez (migration 54)
--
-- O e-mail de quem fez cada ação mora em `auth.users`: só a equipe da
-- plataforma o recebe, e só dos ids pedidos.

reset role;
select tests.login('forasteiro@teste.local');
set role authenticated;

select tests.ok('auditoria',
  tests.erro($q$select * from public.admin_autores_da_auditoria(
                 array[(select u_a_owner from tests.ids)])$q$),
  'usuário comum NÃO lê quem fez as ações');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('auditoria',
  (select email = 'a-owner@teste.local' and not equipe
     from public.admin_autores_da_auditoria(array[(select u_a_owner from tests.ids)])),
  'a equipe lê o e-mail de quem fez, e vê que não é da equipe');

select tests.ok('auditoria',
  (select equipe from public.admin_autores_da_auditoria(
     array[(select u_equipe from tests.ids)])),
  'e sabe quando quem fez é da equipe da plataforma');

select tests.ok('auditoria',
  (select count(*) from public.admin_autores_da_auditoria(null)) = 0,
  'sem ids pedidos, nada volta');

reset role;
select tests.logout();

-- ============================== grupo: A01 — o segundo fator da equipe (migration 55)
--
-- A senha sozinha não faz ninguém ser da equipe: sem `aal2` na sessão, quem
-- está em `platform_admins` é, para a RLS, um usuário como outro qualquer. É
-- o que impede uma senha vazada de ler todos os clientes pela API direto —
-- a tela guardada não alcança quem nem passa por ela.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sf-suporte@teste.local', '{"company_name":"SF Suporte"}'::jsonb, now()),
  ('sf-alvo@teste.local',    '{"company_name":"SF Alvo"}'::jsonb,    now());

drop table if exists tests.sf;
create table tests.sf as
select
  (select id from auth.users where email = 'sf-suporte@teste.local') as u_suporte,
  (select id from auth.users where email = 'sf-alvo@teste.local')    as u_alvo,
  (select count(*) from public.memberships m
    where m.user_id = (select u_equipe from tests.ids))::integer      as orgs_da_equipe,
  (select count(*) from public.organizations)::integer                as orgs_todas;
grant select on tests.sf to anon, authenticated, service_role;

insert into public.platform_admins (user_id, role)
select u_suporte, 'support'::public.platform_admin_role from tests.sf
union all
select u_alvo, 'support'::public.platform_admin_role from tests.sf;

select tests.login('equipe@teste.local', 'aal1');
set role authenticated;

select tests.ok('segundo fator',
  (select public.is_platform_admin()) = false,
  'da equipe, mas só com a senha (aal1): is_platform_admin() é falso');

select tests.ok('segundo fator',
  tests.contar('select count(*) from public.organizations') = (select orgs_da_equipe from tests.sf),
  'só com a senha, a equipe enxerga apenas as próprias organizações, e não as dos clientes');

select tests.ok('segundo fator',
  tests.contar('select count(*) from public.platform_admins') = 1,
  'mas enxerga a própria linha em platform_admins: é com ela que a tela manda verificar');

select tests.ok('segundo fator',
  tests.erro('select * from public.admin_equipe()'),
  'só com a senha, não lê a equipe');

select tests.ok('segundo fator',
  tests.erro('select * from public.resumo_do_admin()'),
  'só com a senha, não lê o resumo da plataforma');

reset role;
select tests.login('equipe@teste.local', null);
set role authenticated;

select tests.ok('segundo fator',
  (select public.is_platform_admin()) = false,
  'sessão sem nível nenhum no JWT também não vale como equipe');

reset role;
select tests.login('equipe@teste.local', 'aal2');
set role authenticated;

select tests.ok('segundo fator',
  (select public.is_platform_admin()) = true,
  'com o segundo fator (aal2), a equipe volta a ser equipe');

select tests.ok('segundo fator',
  tests.contar('select count(*) from public.organizations') = (select orgs_todas from tests.sf),
  'e enxerga todas as organizações');

select tests.ok('segundo fator',
  (select not segundo_fator from public.admin_equipe()
    where user_id = (select u_alvo from tests.sf)),
  'a A11 mostra quem ainda não tem o segundo fator');

-- Um fator cadastrado e não confirmado não conta; o confirmado conta.
reset role;
insert into auth.mfa_factors (user_id, factor_type, status, friendly_name)
select u_alvo, 'totp', 'unverified', 'Rascunho' from tests.sf;
set role authenticated;

select tests.ok('segundo fator',
  (select not segundo_fator from public.admin_equipe()
    where user_id = (select u_alvo from tests.sf)),
  'fator começado e não confirmado ainda não é segundo fator');

reset role;
insert into auth.mfa_factors (user_id, factor_type, status, friendly_name)
select u_alvo, 'totp', 'verified', 'Storefy Admin' from tests.sf;
insert into auth.sessions (user_id, aal)
select u_alvo, 'aal2'::auth.aal_level from tests.sf
union all
select u_alvo, 'aal1'::auth.aal_level from tests.sf;
set role authenticated;

select tests.ok('segundo fator',
  (select segundo_fator from public.admin_equipe()
    where user_id = (select u_alvo from tests.sf)),
  'com o fator confirmado, a A11 mostra o segundo fator ativo');

-- Redefinir é só do servidor: nem o superadmin logado chama pelo navegador.
select tests.ok('segundo fator',
  tests.erro(format('select public.admin_redefinir_segundo_fator(%L, %L)',
    (select u_equipe from tests.ids), (select u_alvo from tests.sf))),
  'redefinir o segundo fator NÃO é chamável pela sessão do navegador');

reset role;
set role service_role;

select tests.ok('segundo fator',
  tests.erro_com(format('select public.admin_redefinir_segundo_fator(%L, %L)',
    (select u_suporte from tests.sf), (select u_alvo from tests.sf)),
    'Só um superadmin'),
  'quem é do suporte não redefine o segundo fator de ninguém');

select tests.ok('segundo fator',
  tests.erro_com(format('select public.admin_redefinir_segundo_fator(%L, %L)',
    (select u_equipe from tests.ids), (select u_equipe from tests.ids)),
    'sua própria'),
  'ninguém redefine o próprio segundo fator');

select tests.ok('segundo fator',
  tests.erro_com(format('select public.admin_redefinir_segundo_fator(%L, %L)',
    (select u_equipe from tests.ids), (select u_a_owner from tests.ids)),
    'não está mais na equipe'),
  'e só de quem é da equipe');

select tests.ok('segundo fator',
  tests.erro_com(format('select public.admin_redefinir_segundo_fator(%L, %L)',
    (select u_equipe from tests.ids), (select u_suporte from tests.sf)),
    'ainda não ativou'),
  'quem não tem o segundo fator não tem o que redefinir');

select tests.ok('segundo fator',
  (select public.admin_redefinir_segundo_fator(
     (select u_equipe from tests.ids), (select u_alvo from tests.sf))) = 2,
  'o superadmin redefine: os dois fatores (o confirmado e o começado) saem');

reset role;

select tests.ok('segundo fator',
  not exists (select 1 from auth.mfa_factors
               where user_id = (select u_alvo from tests.sf))
  and not exists (select 1 from auth.sessions
                   where user_id = (select u_alvo from tests.sf)),
  'e as sessões abertas da pessoa acabam junto: o celular perdido perde o acesso agora');

select tests.ok('segundo fator',
  exists (
    select 1 from public.audit_logs
     where entity = 'platform_admins'
       and entity_id = (select u_alvo from tests.sf)
       and actor_id = (select u_equipe from tests.ids)
       and org_id is null
       and diff ->> 'segundo_fator' = 'redefinido'
       and (diff ->> 'sessoes_encerradas')::integer = 2),
  'a redefinição fica na auditoria, com quem fez e quantas sessões acabaram');

delete from public.platform_admins
 where user_id in (select u_suporte from tests.sf union all select u_alvo from tests.sf);
select tests.logout();

-- ============================== grupo: C08 — imagem e público da campanha (migration 56)
--
-- A imagem é um arquivo do bucket, da loja da campanha; o público é um dos que
-- o painel oferece. E a imagem que ninguém usa volta para o job apagar.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('img-dono@teste.local',   '{"company_name":"Img Dono"}'::jsonb,   now()),
  ('img-outro@teste.local',  '{"company_name":"Img Outro"}'::jsonb,  now()),
  ('img-membro@teste.local', '{"company_name":"Img Membro"}'::jsonb, now());

drop table if exists tests.img;
create table tests.img as
select
  (select id from auth.users where email = 'img-dono@teste.local')   as u_dono,
  (select id from auth.users where email = 'img-membro@teste.local') as u_membro,
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'img-dono@teste.local')  as org_dono,
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'img-outro@teste.local') as org_outro,
  extensions.gen_random_uuid() as arquivo_usado,
  extensions.gen_random_uuid() as arquivo_velho,
  extensions.gen_random_uuid() as arquivo_novo;

insert into public.memberships (org_id, user_id, role)
select org_dono, u_membro, 'member' from tests.img;

insert into public.stores (org_id, name, primary_url)
select org_dono, 'Loja Img', 'https://loja-img.com.br' from tests.img;
insert into public.stores (org_id, name, primary_url)
select org_outro, 'Loja Img Outra', 'https://loja-img-outra.com.br' from tests.img;

alter table tests.img add column loja uuid, add column loja_outra uuid, add column app uuid;
update tests.img set
  loja = (select id from public.stores where name = 'Loja Img'),
  loja_outra = (select id from public.stores where name = 'Loja Img Outra');
update tests.img set app = (select a.id from public.apps a where a.store_id = tests.img.loja);
grant select on tests.img to anon, authenticated, service_role;

select tests.login('img-dono@teste.local');
set role authenticated;

select tests.ok('push',
  tests.permitido($q$insert into public.push_campaigns (app_id, title, body, image_path)
    select app, 'Com imagem', 'Da própria loja',
           loja::text || '/' || arquivo_usado::text || '.jpg' from tests.img$q$),
  'a campanha usa uma imagem da própria loja');

select tests.ok('push',
  tests.erro_com($q$insert into public.push_campaigns (app_id, title, body, image_path)
    select app, 'Imagem alheia', 'De outra loja',
           loja_outra::text || '/' || arquivo_novo::text || '.jpg' from tests.img$q$,
    'A imagem é de outra loja.'),
  'mas NÃO a imagem de outra loja, nem sabendo o caminho');

select tests.ok('push',
  tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, image_path)
    select app, 'Imagem de fora', 'URL qualquer', 'https://exemplo.com/foto.jpg' from tests.img$q$),
  'nem um endereço de fora do bucket');

select tests.ok('push',
  tests.permitido($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'Compradores', 'Público', '{"publico":"compradores"}'::jsonb from tests.img$q$)
  and tests.permitido($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'Sumidos', 'Público', '{"publico":"inativos","dias":14}'::jsonb from tests.img$q$),
  'os públicos do painel são aceitos, com e sem prazo');

select tests.ok('push',
  tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"inativos"}'::jsonb from tests.img$q$)
  and tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"vip"}'::jsonb from tests.img$q$)
  and tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"ativos","dias":0}'::jsonb from tests.img$q$)
  and tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"ativos","dias":7.5}'::jsonb from tests.img$q$)
  and tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"ativos","dias":"7"}'::jsonb from tests.img$q$)
  and tests.bloqueado($q$insert into public.push_campaigns (app_id, title, body, segment)
    select app, 'x', 'x', '{"publico":"compradores","tag":"vip"}'::jsonb from tests.img$q$),
  'público desconhecido, sem prazo, com prazo fora de 1 a 365 ou com campo a mais é recusado');

select tests.ok('push',
  tests.erro_com($q$update public.push_campaigns
    set image_path = (select loja_outra::text || '/' || arquivo_novo::text || '.jpg' from tests.img)
    where title = 'Com imagem'$q$,
    'A imagem é de outra loja.'),
  'trocar depois pela imagem de outra loja também é recusado');

select tests.ok('push',
  tests.permitido($q$insert into storage.objects (bucket_id, name)
    select 'push-imagens', loja::text || '/' || arquivo_usado::text || '.jpg' from tests.img$q$),
  'o dono envia imagem de push para a pasta da própria loja');

select tests.ok('push',
  tests.bloqueado($q$insert into storage.objects (bucket_id, name)
    select 'push-imagens', loja_outra::text || '/intrusa.jpg' from tests.img$q$),
  'mas não para a pasta de outra loja');

reset role;
select tests.login('img-membro@teste.local');
set role authenticated;

select tests.ok('papéis',
  tests.bloqueado($q$insert into storage.objects (bucket_id, name)
    select 'push-imagens', loja::text || '/do-membro.jpg' from tests.img$q$),
  'member NÃO envia imagem de push');

select tests.ok('push',
  tests.contar($q$select count(*) from storage.objects where bucket_id = 'push-imagens'$q$) = 1,
  'mas enxerga as imagens da loja dele');

reset role;
select tests.login('img-outro@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar($q$select count(*) from storage.objects where bucket_id = 'push-imagens'$q$) = 0,
  'a outra organização não lista as imagens de push desta loja');

reset role;
select tests.logout();
set role anon;

select tests.ok('push',
  tests.contar($q$select count(*) from storage.objects where bucket_id = 'push-imagens'$q$) = 0,
  'anon não lista imagem nenhuma: o link público não abre a listagem');

reset role;

select tests.ok('push',
  (select public and file_size_limit = 1048576 and allowed_mime_types = array['image/jpeg']
     from storage.buckets where id = 'push-imagens'),
  'o bucket é público (a OneSignal baixa sozinha), só JPEG e até 1 MB');

-- Uma imagem velha sem campanha, uma velha em uso e uma nova sem campanha.
insert into storage.objects (bucket_id, name, created_at)
select 'push-imagens', loja::text || '/' || arquivo_velho::text || '.jpg', now() - interval '2 days'
  from tests.img
union all
select 'push-imagens', loja::text || '/' || arquivo_novo::text || '.jpg', now()
  from tests.img;
update storage.objects set created_at = now() - interval '2 days'
 where bucket_id = 'push-imagens'
   and name = (select loja::text || '/' || arquivo_usado::text || '.jpg' from tests.img);

select tests.login('img-dono@teste.local');
set role authenticated;

select tests.ok('push',
  tests.erro('select * from public.imagens_de_push_sem_campanha()'),
  'a lista de imagens órfãs não é chamável pelo navegador');

reset role;
set role service_role;

select tests.ok('push',
  (select array_agg(caminho) from public.imagens_de_push_sem_campanha())
    = array[(select loja::text || '/' || arquivo_velho::text || '.jpg' from tests.img)],
  'o job recebe só a imagem velha que nenhuma campanha usa — não a em uso, nem a recém-enviada');

reset role;

-- O despacho leva a imagem até o job.
insert into public.push_campaigns (app_id, title, body, image_path, segment, status, scheduled_at)
select app, 'Sai agora', 'Com imagem e público',
       loja::text || '/' || arquivo_usado::text || '.jpg',
       '{"publico":"com_carrinho"}'::jsonb, 'scheduled', now() - interval '1 minute'
  from tests.img;

set role service_role;

select tests.ok('push',
  exists (
    select 1 from public.reservar_campanhas(100) r
     where r.title = 'Sai agora'
       and r.image_path = (select loja::text || '/' || arquivo_usado::text || '.jpg' from tests.img)
       and r.segment = '{"publico":"com_carrinho"}'::jsonb),
  'o despacho devolve a imagem e o público da campanha para o job');

reset role;
select tests.logout();

-- ============================== grupo: C07/C09/C10 — a receita do push (migration 57)
--
-- A origem do push chega num atributo de carrinho, que qualquer um escreve:
-- o pedido só leva o crédito de uma campanha (ou automação) do MESMO app, e
-- só se o pedido for do app. E a soma passa pela RLS: ninguém soma a receita
-- de outra loja, nem sabendo o id da campanha.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('rec-dono@teste.local',  '{"company_name":"Rec Dono"}'::jsonb,  now()),
  ('rec-outro@teste.local', '{"company_name":"Rec Outro"}'::jsonb, now());

drop table if exists tests.rec;
create table tests.rec as
select
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'rec-dono@teste.local')  as org_dono,
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'rec-outro@teste.local') as org_outro;

insert into public.stores (org_id, name, primary_url)
select org_dono, 'Loja Rec', 'https://loja-rec.com.br' from tests.rec;
insert into public.stores (org_id, name, primary_url)
select org_outro, 'Loja Rec Outra', 'https://loja-rec-outra.com.br' from tests.rec;

alter table tests.rec
  add column app uuid, add column app_outro uuid, add column aparelho uuid,
  add column campanha uuid, add column campanha_outra uuid, add column automacao uuid;
update tests.rec set
  app = (select a.id from public.apps a join public.stores s on s.id = a.store_id
          where s.name = 'Loja Rec'),
  app_outro = (select a.id from public.apps a join public.stores s on s.id = a.store_id
                where s.name = 'Loja Rec Outra');

insert into public.push_campaigns (app_id, title, body, status)
select app, 'Campanha que vende', 'Texto', 'sent' from tests.rec;
insert into public.push_campaigns (app_id, title, body, status)
select app_outro, 'Campanha da outra loja', 'Texto', 'sent' from tests.rec;
insert into public.push_automations (app_id, type, enabled, title, body)
select app, 'abandoned_cart', true, 'Esqueceu algo?', 'Seu carrinho' from tests.rec;
insert into public.devices (app_id, onesignal_subscription_id, platform)
select app, 'rec-aparelho', 'ios' from tests.rec;

update tests.rec set
  campanha = (select id from public.push_campaigns where title = 'Campanha que vende'),
  campanha_outra = (select id from public.push_campaigns where title = 'Campanha da outra loja'),
  automacao = (select id from public.push_automations where app_id = tests.rec.app),
  aparelho = (select id from public.devices where onesignal_subscription_id = 'rec-aparelho');
grant select on tests.rec to anon, authenticated, service_role;

-- Dois envios da automação: um na janela de 30 dias, outro de dois meses atrás.
insert into public.automation_runs (automation_id, device_id, status, scheduled_for, sent_at)
select automacao, aparelho, 'sent'::public.automation_run_status,
       now() - interval '2 days', now() - interval '2 days' from tests.rec
union all
select automacao, aparelho, 'sent'::public.automation_run_status,
       now() - interval '60 days', now() - interval '60 days' from tests.rec;

set role service_role;

select tests.ok('receita do push',
  (select public.registrar_pedido(app, 'rec-1', 'app', 15000, now(), '#1001', 'BRL', null,
                                  campanha, null) from tests.rec)
  and (select public.registrar_pedido(app, 'rec-2', 'app', 5000, now(), '#1002', 'BRL', null,
                                      campanha, null) from tests.rec)
  and (select public.registrar_pedido(app, 'rec-3', 'app', 7000, now(), '#1003', 'BRL', null,
                                      null, automacao) from tests.rec)
  and (select public.registrar_pedido(app, 'rec-velho', 'app', 3000, now() - interval '45 days',
                                      '#0900', 'BRL', null, null, automacao) from tests.rec),
  'o pedido registra a campanha ou a automação que trouxe o cliente');

-- A conferência vai numa instrução à parte: dentro da mesma, a leitura não
-- enxerga o que a função acabou de gravar.
select tests.ok('receita do push',
  (select count(*) = 2 from public.shop_orders
    where push_campaign_id = (select campanha from tests.rec))
  and (select count(*) = 2 from public.shop_orders
        where push_automation_id = (select automacao from tests.rec)),
  'e o crédito fica gravado no pedido');

select public.registrar_pedido(app, 'rec-4', 'app', 99900, now(), '#1004', 'BRL', null,
                               campanha_outra, null) from tests.rec;
select public.registrar_pedido(app, 'rec-5', 'app', 1000, now(), '#1005', 'BRL', null,
                               extensions.gen_random_uuid(), null) from tests.rec;
select public.registrar_pedido(app, 'rec-6', 'site', 4000, now(), '#1006', 'BRL', null,
                               campanha, null) from tests.rec;

select tests.ok('receita do push',
  (select push_campaign_id is null from public.shop_orders where shopify_order_id = 'rec-4'),
  'campanha de OUTRA loja no atributo forjado: o pedido entra, mas sem o crédito');

select tests.ok('receita do push',
  (select push_campaign_id is null from public.shop_orders where shopify_order_id = 'rec-5'),
  'campanha que não existe também não leva crédito');

select tests.ok('receita do push',
  (select push_campaign_id is null and source = 'site'
     from public.shop_orders where shopify_order_id = 'rec-6'),
  'pedido do site não leva o crédito do push, mesmo com a campanha certa');

select tests.ok('receita do push',
  not (select public.registrar_pedido(app, 'rec-1', 'app', 15000, now(), '#1001', 'BRL', null,
                                      campanha, null) from tests.rec),
  'a reentrega do mesmo pedido continua sem duplicar');

reset role;

select tests.ok('receita do push',
  tests.bloqueado($q$insert into public.shop_orders
      (app_id, shopify_order_id, source, ordered_at, push_campaign_id, push_automation_id)
    select app, 'rec-dupla', 'app', now(), campanha, automacao from tests.rec$q$),
  'um pedido não leva o crédito de uma campanha E de uma automação ao mesmo tempo');

select tests.ok('receita do push',
  tests.bloqueado($q$insert into public.shop_orders
      (app_id, shopify_order_id, source, ordered_at, push_campaign_id)
    select app, 'rec-site', 'site', now(), campanha from tests.rec$q$),
  'e o banco recusa receita de push em pedido do site, por onde quer que entre');

select tests.login('rec-dono@teste.local');
set role authenticated;

select tests.ok('receita do push',
  (select pedidos = 2 and receita_cents = 20000
     from public.receita_das_campanhas(array[(select campanha from tests.rec)])),
  'o dono soma os pedidos e a receita da campanha');

select tests.ok('receita do push',
  (select envios = 1 and pedidos = 1 and receita_cents = 7000
     from public.resultado_das_automacoes((select app from tests.rec), 30)
    where automacao_id = (select automacao from tests.rec)),
  'e o resultado da automação só dentro da janela: o envio e o pedido antigos ficam de fora');

select tests.ok('receita do push',
  (select pedidos = 3 and receita_cents = 27000
     from public.receita_do_push((select app from tests.rec), 30)),
  'o total do topo soma campanhas e automações da janela, e nada do site');

select tests.ok('receita do push',
  tests.bloqueado($q$update public.shop_orders set push_campaign_id = null
    where shopify_order_id = 'rec-1'$q$),
  'o lojista não mexe no crédito dos pedidos pela API');

reset role;
select tests.login('rec-outro@teste.local');
set role authenticated;

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.receita_das_campanhas(
    array[(select campanha from tests.rec)])$q$) = 0,
  'outra organização não soma a receita da campanha alheia, nem sabendo o id');

select tests.ok('isolamento',
  tests.contar($q$select count(*) from public.resultado_das_automacoes(
    (select app from tests.rec), 30)$q$) = 0,
  'nem o resultado das automações de outra loja');

select tests.ok('isolamento',
  (select pedidos = 0 and receita_cents = 0
     from public.receita_do_push((select app from tests.rec), 30)),
  'e o total do topo de outra loja volta zerado');

reset role;
select tests.logout();
set role anon;

select tests.ok('receita do push',
  tests.erro($q$select * from public.receita_das_campanhas(array[]::uuid[])$q$)
  and tests.erro($q$select * from public.resultado_das_automacoes(extensions.gen_random_uuid(), 30)$q$)
  and tests.erro($q$select * from public.receita_do_push(extensions.gen_random_uuid(), 30)$q$),
  'anon não chama a soma da receita');

reset role;
select tests.logout();

-- ============================== grupo: domínio da Shopify protegido (migration 58)
--
-- O `.myshopify.com` é a identidade da loja nos webhooks. O painel não troca o
-- de uma loja conectada, e o `shop/redact` apaga os dados de TODO cadastro
-- com aquele domínio — inclusive quando outra organização pôs o mesmo
-- domínio no dela.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('dom-dono@teste.local',   '{"company_name":"Dom Dono"}'::jsonb,   now()),
  ('dom-intruso@teste.local', '{"company_name":"Dom Intruso"}'::jsonb, now());

drop table if exists tests.dom;
create table tests.dom as
select
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'dom-dono@teste.local')    as org_dono,
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'dom-intruso@teste.local') as org_intruso;

insert into public.stores (org_id, name, primary_url, shop_domain)
select org_dono, 'Loja Dom', 'https://loja-dom.com.br', 'loja-dom.myshopify.com' from tests.dom;
insert into public.stores (org_id, name, primary_url, shop_domain)
select org_intruso, 'Loja do Intruso', 'https://intruso.com.br', 'intruso.com.br' from tests.dom;

-- A loja do dono está conectada: o token existe (gravado pela service role na vida real).
update public.stores
   set shopify_access_token_enc = 'v1.token.cifrado.aqui', shopify_scopes = array['read_orders']
 where name = 'Loja Dom';

alter table tests.dom add column loja uuid, add column intrusa uuid,
  add column app uuid, add column app_intruso uuid;
update tests.dom set
  loja = (select id from public.stores where name = 'Loja Dom'),
  intrusa = (select id from public.stores where name = 'Loja do Intruso');
update tests.dom set
  app = (select id from public.apps where store_id = tests.dom.loja),
  app_intruso = (select id from public.apps where store_id = tests.dom.intrusa);
grant select on tests.dom to anon, authenticated, service_role;

select tests.login('dom-dono@teste.local');
set role authenticated;

select tests.ok('domínio da shopify',
  tests.erro_com($q$update public.stores set shop_domain = 'outra.myshopify.com'
    where id = (select loja from tests.dom)$q$, 'dominio_da_loja_conectada'),
  'o painel não troca o domínio de uma loja conectada — é por ele que os webhooks a acham');

select tests.ok('domínio da shopify',
  tests.contar($q$with feito as (
      update public.stores set name = 'Loja Dom Nova', support_email = 'oi@loja-dom.com.br'
       where id = (select loja from tests.dom) returning 1)
    select count(*) from feito$q$) = 1
  and (select shop_domain = 'loja-dom.myshopify.com' from public.stores
        where id = (select loja from tests.dom)),
  'e editar o resto da loja conectada continua livre, com o domínio intacto');

select tests.ok('domínio da shopify',
  tests.contar($q$with feito as (
      update public.stores set shop_domain = 'loja-dom.myshopify.com'
       where id = (select loja from tests.dom) returning 1)
    select count(*) from feito$q$) = 1,
  'regravar o MESMO domínio (a reconexão) passa');

reset role;
select tests.logout();
set role service_role;

select tests.ok('domínio da shopify',
  tests.contar($q$with feito as (
      update public.stores set shop_domain = 'loja-dom-2.myshopify.com'
       where id = (select loja from tests.dom) returning 1)
    select count(*) from feito$q$) = 1,
  'a conexão (service role) troca o domínio junto com o token');

update public.stores set shop_domain = 'loja-dom.myshopify.com'
 where id = (select loja from tests.dom);

reset role;

-- O intruso põe no cadastro dele o domínio da loja do dono (pelo painel, que deixa).
select tests.login('dom-intruso@teste.local');
set role authenticated;

select tests.ok('domínio da shopify',
  tests.contar($q$with feito as (
      update public.stores set shop_domain = 'intruso-novo.com.br'
       where id = (select intrusa from tests.dom) returning 1)
    select count(*) from feito$q$) = 1,
  'numa loja que não está conectada, o domínio provisório acompanha o endereço');

select tests.ok('domínio da shopify',
  tests.contar($q$with feito as (
      update public.stores set shop_domain = 'loja-dom.myshopify.com'
       where id = (select intrusa from tests.dom) returning 1)
    select count(*) from feito$q$) = 1,
  'outra organização consegue pôr o mesmo domínio num cadastro desconectado...');

reset role;
select tests.logout();

select tests.ok('domínio da shopify',
  (select count(*) = 1 from public.app_da_loja_shopify('loja-dom.myshopify.com'))
  and (select app_id = (select app from tests.dom)
         from public.app_da_loja_shopify('loja-dom.myshopify.com')),
  '...mas o webhook continua achando só a loja conectada');

insert into public.shop_orders (app_id, shopify_order_id, source, ordered_at)
select app, 'dom-1', 'app'::public.origem_do_pedido, now() from tests.dom
union all
select app_intruso, 'dom-2', 'site'::public.origem_do_pedido, now() from tests.dom;

set role service_role;
select public.apagar_dados_da_shopify('loja-dom.myshopify.com');
reset role;

select tests.ok('domínio da shopify',
  not exists (select 1 from public.shop_orders
               where app_id in ((select app from tests.dom), (select app_intruso from tests.dom))),
  'o shop/redact apaga os dados de TODO cadastro com o domínio: o intruso não protege os da loja certa');

select tests.ok('domínio da shopify',
  (select shopify_access_token_enc is null from public.stores
    where id = (select loja from tests.dom)),
  'e desconecta a loja');

reset role;
select tests.logout();

-- ============================== grupo: plataforma da loja (migration 59)
--
-- A plataforma é escolhida no painel. Loja conectada à Shopify é Shopify: o
-- banco recusa marcá-la como outra, o que desligaria a atribuição com os
-- pedidos chegando.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('plat-dono@teste.local',   '{"company_name":"Plat Dono"}'::jsonb,   now()),
  ('plat-membro@teste.local', '{"company_name":"Plat Membro"}'::jsonb, now());

drop table if exists tests.plat;
create table tests.plat as
select
  (select m.org_id from public.memberships m
     join auth.users u on u.id = m.user_id where u.email = 'plat-dono@teste.local') as org,
  (select id from auth.users where email = 'plat-membro@teste.local') as u_membro;

insert into public.memberships (org_id, user_id, role)
select org, u_membro, 'member' from tests.plat;
grant select on tests.plat to anon, authenticated, service_role;

select tests.login('plat-dono@teste.local');
set role authenticated;

select tests.ok('plataforma da loja',
  tests.contar($q$with feita as (
      insert into public.stores (org_id, name, primary_url, platform)
      select org, 'Loja Nuvem', 'https://loja-nuvem.com.br', 'other' from tests.plat
      returning 1)
    select count(*) from feita$q$) = 1,
  'o dono cadastra a loja como outra plataforma');

select tests.ok('plataforma da loja',
  tests.contar($q$with feito as (
      update public.stores set platform = 'shopify' where name = 'Loja Nuvem' returning 1)
    select count(*) from feito$q$) = 1,
  'e troca a plataforma na edição');

reset role;
select tests.logout();
select tests.login('plat-membro@teste.local');
set role authenticated;

select tests.ok('plataforma da loja',
  tests.bloqueado($q$update public.stores set platform = 'other' where name = 'Loja Nuvem'$q$),
  'quem é só membro não troca a plataforma');

reset role;
select tests.logout();

-- Conectada à Shopify (a service role grava o token na vida real).
update public.stores
   set shopify_access_token_enc = 'v1.token.cifrado', shopify_scopes = array['read_orders']
 where name = 'Loja Nuvem';

select tests.login('plat-dono@teste.local');
set role authenticated;

select tests.ok('plataforma da loja',
  tests.erro_com($q$update public.stores set platform = 'other' where name = 'Loja Nuvem'$q$,
    'stores_conectada_e_shopify'),
  'loja conectada à Shopify não vira outra plataforma');

reset role;
select tests.logout();

select tests.ok('plataforma da loja',
  tests.erro_com($q$update public.stores set platform = 'other' where name = 'Loja Nuvem'$q$,
    'stores_conectada_e_shopify'),
  'nem pela service role: é regra da loja, e não do painel');

-- ============================== grupo: A03 — clientes com etapa e saúde (migration 60)
--
-- A lista do admin calcula a etapa do começo e a saúde de cada cliente, e
-- filtra por elas antes de paginar. Só a equipe, com o segundo fator.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('saude-a@teste.local', '{"company_name":"Saude Alfa"}'::jsonb, now()),
  ('saude-b@teste.local', '{"company_name":"Saude Beta"}'::jsonb, now()),
  ('saude-c@teste.local', '{"company_name":"Saude Gama"}'::jsonb, now());

drop table if exists tests.saude;
create table tests.saude as
select
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'saude-a@teste.local') as org_a,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'saude-b@teste.local') as org_b,
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'saude-c@teste.local') as org_c;
grant select on tests.saude to anon, authenticated, service_role;

-- A: o teste acabou ontem e ninguém assinou; nenhuma loja.
update public.organizations set trial_ends_at = now() - interval '1 day'
 where id = (select org_a from tests.saude);

-- B: o app foi recusado na revisão.
insert into public.stores (org_id, name, primary_url)
select org_b, 'Loja Saude Beta', 'https://saude-beta.com.br' from tests.saude;
update public.stores set status = 'rejected' where name = 'Loja Saude Beta';

-- C: o app foi publicado no painel, e nada foi às lojas.
insert into public.stores (org_id, name, primary_url)
select org_c, 'Loja Saude Gama', 'https://saude-gama.com.br' from tests.saude;
update public.apps set current_config_version = 1
 where store_id = (select id from public.stores where name = 'Loja Saude Gama');

select tests.login('saude-a@teste.local');
set role authenticated;

select tests.ok('A03 clientes',
  tests.erro($q$select * from public.admin_organizacoes()$q$),
  'cliente não chama a lista de clientes do admin');

reset role;
select tests.login('equipe@teste.local', 'aal1');
set role authenticated;

select tests.ok('A03 clientes',
  tests.erro($q$select * from public.admin_organizacoes()$q$),
  'nem a equipe só com a senha (aal1)');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('A03 clientes',
  (select etapa = 'sem_loja' and saude = 'critica' and 'teste_acabou' = any(motivos)
          and plano is null
     from public.admin_organizacoes(p_busca => 'Saude Alfa')),
  'teste acabado sem assinatura: crítica, e a etapa é "sem loja"');

select tests.ok('A03 clientes',
  (select etapa = 'enviado' and saude = 'atencao' and motivos = array['revisao_recusada']
          and lojas = 1
     from public.admin_organizacoes(p_busca => 'Saude Beta')),
  'app recusado: atenção, com o motivo, e a etapa "enviado"');

select tests.ok('A03 clientes',
  (select etapa = 'publicado' and saude = 'boa' and cardinality(motivos) = 0
     from public.admin_organizacoes(p_busca => 'Saude Gama')),
  'publicado no painel e sem pendência: saúde boa');

select tests.ok('A03 clientes',
  (select count(*) = 1 and bool_and(nome = 'Saude Alfa')
     from public.admin_organizacoes(p_busca => 'Saude', p_saude => 'critica'))
  and (select count(*) = 1 and bool_and(nome = 'Saude Gama')
         from public.admin_organizacoes(p_busca => 'Saude', p_etapa => 'publicado'))
  and (select count(*) = 3
         from public.admin_organizacoes(p_busca => 'Saude', p_plano => 'teste'))
  and (select count(*) = 1 and bool_and(nome = 'Saude Beta')
         from public.admin_organizacoes(p_busca => 'Saude', p_situacao => 'trialing',
                                        p_etapa => 'enviado')),
  'os filtros de saúde, etapa, plano e situação valem juntos com a busca');

select tests.ok('A03 clientes',
  (select count(*) = 1 and bool_and(total = 3)
     from public.admin_organizacoes(p_busca => 'Saude', p_limite => 1))
  and (select count(*) = 1
         from public.admin_organizacoes(p_busca => 'Saude', p_limite => 1, p_deslocamento => 2))
  and (select count(*) = 0
         from public.admin_organizacoes(p_busca => 'Saude', p_limite => 1, p_deslocamento => 3)),
  'a paginação corta depois de filtrar, e o total é o dos filtrados');

select tests.ok('A03 clientes',
  (select count(*) = 0 from public.admin_organizacoes(p_busca => '%'))
  and (select count(*) = 0 from public.admin_organizacoes(p_busca => 'Saude_Alfa')),
  '% e _ digitados na busca são letras, e não curingas');

reset role;
select tests.logout();

-- ============================== grupo: A07 — a equipe revalida credenciais (migration 61)
--
-- O resultado da revalidação é gravado pela sessão da equipe, e a auditoria
-- registra quem conferiu. Cliente não grava; a equipe só com o segundo fator.

reset role;
select tests.logout();

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('reval@teste.local', '{"company_name":"Reval"}'::jsonb, now());

drop table if exists tests.reval;
create table tests.reval as
select
  (select m.org_id from public.memberships m join auth.users u on u.id = m.user_id
    where u.email = 'reval@teste.local') as org,
  (select id from auth.users where email = 'equipe@teste.local') as u_equipe;

insert into public.developer_accounts (org_id, platform, status, verified_at, notes)
select org, 'google'::public.developer_platform, 'verified'::public.developer_account_status,
       now(), 'conta@exemplo.iam.gserviceaccount.com' from tests.reval
union all
select org, 'apple'::public.developer_platform, 'pending'::public.developer_account_status,
       null, null from tests.reval;

alter table tests.reval add column google uuid, add column apple uuid;
update tests.reval set
  google = (select id from public.developer_accounts where org_id = tests.reval.org and platform = 'google'),
  apple = (select id from public.developer_accounts where org_id = tests.reval.org and platform = 'apple');
grant select on tests.reval to anon, authenticated, service_role;

select tests.login('reval@teste.local');
set role authenticated;

select tests.ok('A07 revalidar',
  tests.erro($q$select public.admin_gravar_revalidacao(
    (select google from tests.reval), true, 'forjado')$q$),
  'o dono da conta não grava o resultado de uma revalidação');

reset role;
select tests.login('equipe@teste.local', 'aal1');
set role authenticated;

select tests.ok('A07 revalidar',
  tests.erro($q$select public.admin_gravar_revalidacao(
    (select google from tests.reval), false, 'x')$q$),
  'nem a equipe só com a senha (aal1)');

reset role;
select tests.login('equipe@teste.local');
set role authenticated;

select public.admin_gravar_revalidacao(
  (select google from tests.reval), false, 'A Google recusou a conta de serviço.');

reset role;

select tests.ok('A07 revalidar',
  (select status = 'error' and verified_at is null
          and notes = 'A Google recusou a conta de serviço.'
     from public.developer_accounts where id = (select google from tests.reval)),
  'a equipe grava a recusa, com o motivo');

select tests.ok('A07 revalidar',
  exists (select 1 from public.audit_logs
           where entity = 'developer_accounts'
             and entity_id = (select google from tests.reval)
             and action = 'update'
             and actor_id = (select u_equipe from tests.reval)
             and diff -> 'status' ->> 'para' = 'error'),
  'e a auditoria registra quem da equipe conferiu');

select tests.login('equipe@teste.local');
set role authenticated;

select tests.ok('A07 revalidar',
  tests.erro_com($q$select public.admin_gravar_revalidacao(
    (select apple from tests.reval), true, null)$q$, 'conta_nao_encontrada'),
  'conta sem credencial (pendente) não vira verificada por aqui');

reset role;
select tests.logout();

-- ============================== grupo: o tema da loja (A10, migration 63)
--
-- O tema da Shopify lido da página da loja, para o editor sugerir o preset.
-- O dono e o administrador gravam; o membro lê e não muda; outra empresa nem
-- vê. O formato é conferido no banco: é texto que vem de um site de fora.

select tests.login('a-owner@teste.local');
set role authenticated;

update public.stores set shopify_theme = 'Dawn' where id = (select loja_a from tests.lojas);

select tests.ok('A10 tema',
  (select shopify_theme = 'Dawn' from public.stores where id = (select loja_a from tests.lojas)),
  'o dono grava o tema da loja');

select tests.ok('A10 tema',
  tests.bloqueado($q$update public.stores set shopify_theme = E'Dawn\x01'
                      where id = (select loja_a from tests.lojas)$q$),
  'tema com caractere de controle é recusado');

select tests.ok('A10 tema',
  tests.bloqueado($q$update public.stores set shopify_theme = repeat('x', 81)
                      where id = (select loja_a from tests.lojas)$q$),
  'tema com mais de 80 caracteres é recusado');

reset role;
select tests.login('a-member@teste.local');
set role authenticated;

update public.stores set shopify_theme = 'Impulse' where id = (select loja_a from tests.lojas);

select tests.ok('A10 tema',
  (select shopify_theme = 'Dawn' from public.stores where id = (select loja_a from tests.lojas)),
  'o membro lê o tema, e não muda');

reset role;
select tests.login('b-owner@teste.local');
set role authenticated;

update public.stores set shopify_theme = 'Impulse' where id = (select loja_a from tests.lojas);

select tests.ok('A10 tema',
  tests.contar($q$select count(*) from public.stores
                   where id = (select loja_a from tests.lojas)$q$) = 0,
  'outra empresa nem vê a loja');

reset role;

select tests.ok('A10 tema',
  (select shopify_theme = 'Dawn' from public.stores where id = (select loja_a from tests.lojas)),
  'e não muda o tema dela');

update public.stores set shopify_theme = null where id = (select loja_a from tests.lojas);
select tests.logout();

-- ============================== grupo: varredura de segurança (Fase 8)
--
-- Duas travas que valem para o schema inteiro, e não para uma tabela: uma
-- tabela nova sem RLS, ou uma política escrita sem `to authenticated`, abre os
-- dados de todos os clientes para quem tiver a chave anônima — que está no
-- navegador de todo mundo.

reset role;

select tests.ok('varredura',
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ),
  'TODA tabela do schema public tem RLS ligada');

select tests.ok('varredura',
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and (roles @> array['public']::name[] or roles @> array['anon']::name[])
  ),
  'nenhuma política vale para o anônimo: toda regra de leitura e escrita exige sessão');

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
