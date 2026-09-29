-- A plataforma da loja passa a ser escolhida no painel (C02): a detecção lê o
-- site e sugere, o lojista confirma no cadastro e pode trocar na edição.
--
-- `platform` decide coisas que o lojista vê: se o app marca o carrinho para
-- separar a venda do app da do site, e se os links do app saem pela Shopify
-- ou pelos arquivos no site. Uma loja CONECTADA à Shopify é Shopify — os
-- pedidos chegam pelos webhooks dela —, e marcá-la como "outra" desligaria a
-- marcação do carrinho com a conexão de pé: pedidos chegando, todos como
-- "do site". O banco recusa a combinação; a conexão (OAuth e app da loja)
-- grava `shopify` junto com o token, e o painel trava o campo enquanto a loja
-- está conectada.

update public.stores
   set platform = 'shopify'
 where shopify_access_token_enc is not null
   and platform <> 'shopify';

alter table public.stores
  add constraint stores_conectada_e_shopify
    check (shopify_access_token_enc is null or platform = 'shopify');

comment on constraint stores_conectada_e_shopify on public.stores is
  'Loja conectada à Shopify é Shopify: marcá-la como outra plataforma desligaria a atribuição com os pedidos chegando.';
