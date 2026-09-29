-- Um estado a mais para a loja: a revisão da Apple ou do Google recusou o app.
--
-- Fica numa migration só dela porque um valor novo de enum não pode ser usado
-- na mesma transação em que nasce — e a 53, que calcula o status das lojas,
-- grava este valor no preenchimento das lojas que já existem.
--
-- "Rascunho" para um app recusado esconderia o que aconteceu; "Em revisão"
-- mentiria. Recusado pede uma ação do lojista, e o painel precisa dizer isso.
alter type public.store_status add value if not exists 'rejected' after 'in_review';
