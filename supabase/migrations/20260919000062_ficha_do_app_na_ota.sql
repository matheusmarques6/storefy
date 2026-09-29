-- =============================================================================
-- M11: a correção OTA leva o número do app na App Store
-- =============================================================================
--
-- A atualização obrigatória (M11) abre a ficha do app na App Store pelo
-- número dele (`apps.ios_asc_app_id`): a Apple não tem link pelo bundle ID.
-- O build de loja já o grava no binário; os binários gerados ANTES disso
-- só o recebem pela correção OTA — e o pacote da correção é montado com o
-- que esta função devolve.
--
-- O tipo de retorno muda, e o Postgres não troca o retorno de uma função com
-- `create or replace`: ela é recriada, com as mesmas permissões — só a
-- service role executa (a rota interna do OTA, depois de conferir o segredo
-- do workflow).
-- =============================================================================

drop function public.dados_da_ota(uuid);

create function public.dados_da_ota(p_store_id uuid)
returns table (
  app_id uuid,
  store_id uuid,
  nome_do_app text,
  bundle_id_ios text,
  package_android text,
  ios_asc_app_id text,
  expo_project_id text,
  onesignal_app_id text,
  device_secret_enc text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, s.id, a.display_name, a.bundle_id_ios, a.package_android,
         a.ios_asc_app_id, a.expo_project_id, a.onesignal_app_id, a.device_secret_enc
    from public.stores s
    join public.apps a on a.store_id = s.id
   where s.id = p_store_id
     and a.expo_project_id is not null;
$$;

comment on function public.dados_da_ota(uuid) is
  'Variáveis do pacote OTA de uma loja. Só service role.';

revoke all on function public.dados_da_ota(uuid) from public, anon, authenticated;
grant execute on function public.dados_da_ota(uuid) to service_role;
