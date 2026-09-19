-- Histórico de configs precisa de um terceiro estado.
--
-- Até aqui `app_config_status` só tinha `draft` e `published`, com um índice
-- único garantindo uma publicada por app. Publicar a versão 4 obrigaria a
-- versão 3 a virar `draft` de novo — e aí o editor não saberia mais qual das
-- duas é o rascunho de trabalho. `archived` é o que a versão antiga vira.
--
-- Esta migration faz SÓ isto. O Postgres aceita `add value` dentro de uma
-- transação, mas não deixa USAR o valor novo na mesma — então quem usa vem no
-- arquivo seguinte.

alter type public.app_config_status add value if not exists 'archived';
