-- C14: os avisos (webhooks) da Shopify de cada loja, conferidos e refeitos.
--
-- Os avisos são registrados uma vez, na conexão, e a Storefy nunca mais
-- olhava para eles. Só que a Shopify APAGA a inscrição depois de entregas que
-- falham seguidas (a Storefy fora do ar por algumas horas basta), e um aviso
-- que não se registrou na conexão também ficava para trás. Sem `orders/create`
-- a loja para de contar vendas pelo app; sem `products/update`, o "me avise
-- quando voltar" nunca avisa — em silêncio, com a tela dizendo "conectada".
--
-- Agora cada loja guarda o que faltou na última conferência, e um job de hora
-- em hora confere e refaz o que a Shopify apagou. Quem grava é sempre o
-- servidor, depois de falar com a Shopify: a coluna nova nasce sem grant de
-- escrita (migrations 5 e 23), e a leitura é concedida para a tela.

alter table public.stores
  add column shopify_avisos_faltando text[],
  add column shopify_avisos_conferidos_em timestamptz,
  add column shopify_acesso_recusado_em timestamptz;

comment on column public.stores.shopify_avisos_faltando is
  'Os avisos da Shopify que faltaram na última conferência. Vazio: todos de pé. Nulo: nunca conferidos.';
comment on column public.stores.shopify_avisos_conferidos_em is
  'Quando os avisos da Shopify desta loja foram conferidos pela última vez.';
comment on column public.stores.shopify_acesso_recusado_em is
  'A Shopify recusou o token da loja na última conferência (app desinstalado ou acesso revogado).';

grant select (shopify_avisos_faltando, shopify_avisos_conferidos_em, shopify_acesso_recusado_em)
  on public.stores to authenticated;

-- A conexão morre junto com o que se sabe dela: um lugar só para a limpeza.
create or replace function public.desconectar_shopify(p_shop_domain text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update public.stores
     set shopify_access_token_enc = null,
         shopify_scopes = null,
         shopify_conexao = null,
         shopify_client_id = null,
         shopify_client_secret_enc = null,
         shopify_token_expires_at = null,
         shopify_avisos_faltando = null,
         shopify_avisos_conferidos_em = null,
         shopify_acesso_recusado_em = null
   where shop_domain = lower(trim(p_shop_domain));

  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

comment on function public.desconectar_shopify(text) is
  'Apaga o token, as credenciais e o estado dos avisos quando o app Shopify é desinstalado. Só service role.';

revoke all on function public.desconectar_shopify(text) from public, anon, authenticated;
grant execute on function public.desconectar_shopify(text) to service_role;

alter table public.job_heartbeats drop constraint job_heartbeats_job_check;
alter table public.job_heartbeats add constraint job_heartbeats_job_check
  check (job in (
    'dispatch-push', 'push-stats', 'review-status', 'analytics', 'inactive-devices',
    'invoice-sync', 'shopify-webhooks'
  ));
