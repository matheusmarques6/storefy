-- Um domínio da Shopify conectado a UMA loja da Storefy por vez.
--
-- `stores.shop_domain` nunca teve índice único. Com o OAuth isso quase não
-- aparecia: conectar exigia o lojista autorizar numa tela da Shopify, e quem
-- fazia isso duas vezes percebia. Com o app personalizado é só colar as mesmas
-- credenciais em duas lojas do painel — e nada avisava.
--
-- O ESTRAGO É NO WEBHOOK, e é silencioso:
--
--   `segredoDoWebhook` busca a loja pelo domínio com `maybeSingle()`. Duas
--   linhas viram erro, a rota responde 503 a todo webhook daquela loja, e uma
--   sequência de erros faz a Shopify DESATIVAR o webhook depois de alguns
--   dias. O sintoma que chega é "os pedidos pararam de aparecer", uma semana
--   depois, sem nada ter mudado;
--
--   `app_da_loja_shopify` resolve o empate com `limit 1`. Os pedidos daquela
--   loja passam a cair num dos dois apps, escolhido pelo plano de execução do
--   Postgres — quer dizer, em qualquer um.
--
-- O índice é PARCIAL, e é isso que o deixa correto: a trava vale só para quem
-- está conectado. Uma loja desconectada mantém o `shop_domain` — é o que
-- preenche o campo na hora de reconectar — e duas desconectadas podem ter o
-- mesmo domínio sem incomodar ninguém. O que não pode existir são duas
-- CONECTADAS, porque aí sim há dúvida sobre de quem é o webhook.
--
-- A trava é global de propósito, e não por organização: a pergunta que o
-- webhook faz é "de quem é esta mensagem?", e ela não tem organização junto.

create unique index stores_shop_domain_conectada_key
  on public.stores (shop_domain)
  where shopify_access_token_enc is not null;

comment on index public.stores_shop_domain_conectada_key is
  'Um domínio Shopify conectado a uma loja por vez. Parcial: desconectadas podem repetir.';
