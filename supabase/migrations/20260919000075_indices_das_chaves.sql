-- Dois índices que faltavam em chaves estrangeiras de tabelas que crescem com
-- o uso — achados por uma consulta ao catálogo (toda chave estrangeira sem
-- índice que comece por ela), e não por lentidão: com pouco dado, nada disso
-- aparece. O resto da lista aponta para `auth.users` (quem criou, quem
-- respondeu) ou para tabelas pequenas, e fica como está.
--
-- 1. `shop_orders.device_id` é `on delete set null`. A cada aparelho apagado,
--    o Postgres procura os pedidos que apontam para ele — e, sem índice, lê a
--    tabela de pedidos INTEIRA, de todas as lojas. Excluir uma loja apaga os
--    aparelhos dela um a um: com milhares de aparelhos e milhões de pedidos,
--    a exclusão viraria horas de leitura e cairia no tempo limite.
--
-- 2. `billing_events` é lido por empresa, do mais novo para o mais velho (a
--    cobrança do cliente, na A04). O único índice era por data: para achar os
--    cinco avisos de uma empresa, o banco percorria os de todas até juntar
--    cinco — e uma empresa com poucos avisos custava a tabela toda.
--
-- Parciais: o nulo (pedido sem aparelho, aviso sem empresa) nunca é procurado
-- por igualdade, e fica de fora do índice.

create index if not exists shop_orders_device_idx
  on public.shop_orders (device_id)
  where device_id is not null;

create index if not exists billing_events_org_recebido_idx
  on public.billing_events (org_id, recebido_em desc)
  where org_id is not null;
