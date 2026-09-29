-- O domínio `.myshopify.com` é a identidade da loja nos webhooks. Três furos
-- em volta dele.
--
-- 1. Editar a loja no painel regravava `shop_domain` com o host do endereço
--    do site. Numa loja conectada, o domínio da Shopify virava
--    `minhaloja.com.br`, e os webhooks — que chegam dizendo
--    `minha-loja.myshopify.com` — paravam de encontrar a loja. Os pedidos
--    sumiam do painel depois de uma troca de e-mail de atendimento. O painel
--    foi corrigido (`dominioAoEditar`); a trava abaixo garante que nenhum
--    caminho do painel volte a fazer isso numa loja conectada.
--
-- 2. `shop_domain` é gravável pelo painel, e nada impedia uma organização de
--    pôr no próprio cadastro o domínio da loja de OUTRO cliente. A busca do
--    segredo do webhook lia por domínio com `maybeSingle()`: duas linhas viram
--    erro, a rota responde 503 a todo webhook da loja vítima, e a Shopify
--    DESATIVA o webhook dela depois de alguns dias. A busca passou a olhar só
--    a loja conectada (única, pelo índice da migration 30); a desconectada
--    com o mesmo domínio deixou de ter efeito.
--
-- 3. `apagar_dados_da_shopify` (o `shop/redact`, que a Shopify manda 48 horas
--    depois da desinstalação e que a LGPD exige cumprir) apagava os dados de
--    UM app com aquele domínio, escolhido por `limit 1`. Com duas linhas, os
--    dados da loja certa podiam ficar. Agora apaga os de todas: tudo que a
--    Storefy guardou daquela loja da Shopify, esteja em que cadastro estiver.

create or replace function public.dominio_conectado_nao_muda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  /*
   * Só o painel é barrado. A conexão e a desconexão (callback do OAuth,
   * conexão manual, webhook de desinstalação) passam pela service role, e o
   * domínio muda com o token junto.
   */
  if coalesce(auth.role(), '') = 'authenticated'
     and old.shopify_access_token_enc is not null
     and new.shop_domain is distinct from old.shop_domain then
    raise exception 'dominio_da_loja_conectada'
      using errcode = '42501',
            hint = 'Desconecte a Shopify antes de trocar o domínio da loja.';
  end if;
  return new;
end;
$$;

comment on function public.dominio_conectado_nao_muda() is
  'O painel não troca o domínio .myshopify.com de uma loja conectada: é por ele que os webhooks a encontram.';

create trigger stores_dominio_conectado
  before update of shop_domain on public.stores
  for each row execute function public.dominio_conectado_nao_muda();

create or replace function public.apagar_dados_da_shopify(p_shop_domain text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
  v_apagados integer := 0;
  v_parcial integer;
begin
  for v_app in
    select a.id
      from public.stores s
      join public.apps a on a.store_id = s.id
     where s.shop_domain = lower(trim(p_shop_domain))
  loop
    delete from public.shop_orders where app_id = v_app;
    get diagnostics v_parcial = row_count;
    v_apagados := v_apagados + v_parcial;

    delete from public.cart_events where app_id = v_app;
    get diagnostics v_parcial = row_count;
    v_apagados := v_apagados + v_parcial;

    delete from public.device_days where app_id = v_app;
    get diagnostics v_parcial = row_count;
    v_apagados := v_apagados + v_parcial;

    delete from public.back_in_stock_subs where app_id = v_app;
    get diagnostics v_parcial = row_count;
    v_apagados := v_apagados + v_parcial;

    delete from public.analytics_daily where app_id = v_app;
    get diagnostics v_parcial = row_count;
    v_apagados := v_apagados + v_parcial;
  end loop;

  perform public.desconectar_shopify(p_shop_domain);

  return v_apagados;
end;
$$;

comment on function public.apagar_dados_da_shopify is
  'Atende shop/redact: apaga pedidos, carrinho, atividade, avisos e números de TODO app com o domínio. Só service role.';

revoke all on function public.apagar_dados_da_shopify(text) from public, anon, authenticated;
grant execute on function public.apagar_dados_da_shopify(text) to service_role;
