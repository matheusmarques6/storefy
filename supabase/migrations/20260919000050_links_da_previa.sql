-- A13 — onde baixar o app Storefy Preview.
--
-- O app que lê o QR da prévia (C04 e C06) é da Storefy e sai uma vez só, na
-- conta dela (seção 9.4 do plano). Sem o link na tela, o lojista gerava o
-- código e não tinha onde lê-lo. Duas chaves novas, com o mesmo desenho das
-- outras: só a service role grava, depois de a ação do servidor conferir o
-- superadmin, e a trilha guarda cada mudança com o antes e o depois.

alter table public.platform_settings drop constraint platform_settings_chave_check;

alter table public.platform_settings add constraint platform_settings_chave_check
  check (chave in ('cadastro_aberto', 'aviso_no_painel', 'previa_no_iphone', 'previa_no_android'));
