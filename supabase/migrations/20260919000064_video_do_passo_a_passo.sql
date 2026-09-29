-- =============================================================================
-- C13 — o vídeo do passo a passo de cada conta
-- =============================================================================
--
-- O plano pede "wizards passo a passo com vídeo" para conectar a Apple e o
-- Google. O vídeo é gravado pela equipe e publicado no YouTube, no Vimeo ou
-- no Loom; a A13 guarda o link (já no endereço de incorporar), e a tela de
-- contas o mostra. Sem link, a tela fica só com os passos escritos.
--
-- Duas chaves novas, com o mesmo desenho das outras: só a service role
-- grava, depois de a ação do servidor conferir o superadmin, e a trilha
-- guarda cada mudança com o antes e o depois.
-- =============================================================================

alter table public.platform_settings drop constraint platform_settings_chave_check;

alter table public.platform_settings add constraint platform_settings_chave_check
  check (chave in (
    'cadastro_aberto', 'aviso_no_painel', 'previa_no_iphone', 'previa_no_android',
    'video_da_apple', 'video_do_google'
  ));
