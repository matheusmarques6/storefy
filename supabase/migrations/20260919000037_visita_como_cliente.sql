-- "Ver como cliente" (A04): a equipe abre o painel de um cliente, só para ler.
--
-- A visita é auditada no começo e no fim, e com AÇÕES PRÓPRIAS na trilha — e
-- não com `create`/`delete` numa entidade inventada. Quem lê a A12 daqui a seis
-- meses precisa ver "abriu o painel do cliente" escrito, e não deduzir de
-- "Criou visita" que alguém da equipe esteve lá dentro.
--
-- Nada mais muda no banco: a visita não ganha permissão nenhuma. O admin
-- continua lendo pelas policies de sempre (`or is_platform_admin()`) e
-- continua SEM policy de escrita nas tabelas do cliente — conferido no
-- `pg_policies`. O "somente leitura" é do banco, e não só da tela.

alter type public.audit_action add value if not exists 'view_as_start';
alter type public.audit_action add value if not exists 'view_as_end';

comment on type public.audit_action is
  'create/update/delete para dados; view_as_start/view_as_end para a equipe abrindo e fechando o painel de um cliente.';
