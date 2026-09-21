-- O contato de suporte da loja (seção 7 do plano, metadados da ficha).
--
-- Duas coisas exigem este campo, e nenhuma delas é nossa:
--
--   a política de privacidade precisa dizer a quem o cliente final escreve
--   para pedir seus dados de volta — é o que a LGPD chama de canal de
--   atendimento do controlador;
--   a App Store Connect e o Play Console pedem um contato de suporte na ficha
--   do app, e recusam a submissão sem ele.
--
-- Fica em `stores` e não em `organizations` porque uma organização pode ter
-- várias lojas, cada uma com o próprio atendimento — e é o e-mail da LOJA que
-- o cliente final vê.

alter table public.stores add column support_email text;

comment on column public.stores.support_email is
  'E-mail de atendimento da loja. Aparece na política de privacidade e na ficha do app.';

/*
 * O painel lê e escreve esta coluna, então ela entra no grant coluna a coluna.
 *
 * O Postgres NÃO estende grant de coluna para colunas criadas depois: sem esta
 * linha, o campo existiria no banco e seria invisível para o painel — que é
 * exatamente o defeito que `stores.timezone` teve quando foi criada.
 */
grant select (support_email), update (support_email) on public.stores to authenticated;
