-- Publicar e restaurar versões da AppConfig (seção 4 do plano, fase 2).
--
-- POR QUE EM FUNÇÃO, E NÃO EM TRÊS QUERIES NO SERVIDOR WEB: publicar são quatro
-- escritas que só fazem sentido juntas — arquivar a antiga, promover o
-- rascunho, apontar `apps.current_config_version` e abrir o próximo rascunho.
-- Uma falha de rede no meio deixaria o app da loja sem nenhuma config publicada
-- e o endpoint público devolvendo 404 para todos os clientes dela.
--
-- POR QUE `security invoker`: a autorização continua sendo a RLS. A função não
-- ganha privilégio nenhum; cada `update` aqui passa pelas mesmas policies de
-- `app_configs` e `apps`, e a contagem de linhas afetadas é conferida para que
-- "a policy filtrou" não passe por "deu certo".

create or replace function public.publicar_config(p_app_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rascunho public.app_configs%rowtype;
  v_proxima integer;
  v_linhas integer;
begin
  -- O rascunho de trabalho é a maior versão ainda não publicada.
  select * into v_rascunho
    from public.app_configs
   where app_id = p_app_id and status = 'draft'
   order by version desc
   limit 1;

  if v_rascunho.id is null then
    raise exception 'Nenhum rascunho para publicar neste app.' using errcode = 'P0002';
  end if;

  -- A publicada de agora vira histórico. Sem isto, o índice único
  -- `app_configs_one_published_per_app` recusaria a promoção abaixo.
  update public.app_configs
     set status = 'archived'
   where app_id = p_app_id and status = 'published';

  update public.app_configs
     set status = 'published',
         published_at = now(),
         published_by = auth.uid(),
         -- O `version` de dentro do JSON é o que o app compara para decidir se
         -- a config da rede é mais nova que a do cache. Deixar os dois
         -- divergirem faria o app ignorar a publicação.
         config = jsonb_set(config, '{version}', to_jsonb(version))
   where id = v_rascunho.id;

  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception 'Sem permissão para publicar a configuração deste app.'
      using errcode = '42501';
  end if;

  update public.apps
     set current_config_version = v_rascunho.version
   where id = p_app_id;

  -- Um rascunho novo, já na próxima versão, para o lojista seguir editando sem
  -- mexer no que está no ar.
  v_proxima := v_rascunho.version + 1;
  insert into public.app_configs (app_id, version, config, status)
  values (
    p_app_id,
    v_proxima,
    jsonb_set(v_rascunho.config, '{version}', to_jsonb(v_proxima)),
    'draft'
  );

  return v_rascunho.version;
end;
$$;

comment on function public.publicar_config is
  'Promove o rascunho a publicada, arquiva a anterior e abre o próximo rascunho. Devolve a versão publicada.';

-- ---------------------------------------------------------------- restaurar

create or replace function public.restaurar_config(p_app_id uuid, p_version integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config jsonb;
  v_rascunho public.app_configs%rowtype;
  v_linhas integer;
begin
  select config into v_config
    from public.app_configs
   where app_id = p_app_id and version = p_version;

  if v_config is null then
    raise exception 'Versão % não existe neste app.', p_version using errcode = 'P0002';
  end if;

  select * into v_rascunho
    from public.app_configs
   where app_id = p_app_id and status = 'draft'
   order by version desc
   limit 1;

  if v_rascunho.id is null then
    raise exception 'Este app não tem rascunho para receber a restauração.'
      using errcode = 'P0002';
  end if;

  /*
   * Restaurar CARREGA a versão antiga no rascunho; não publica.
   * Voltar direto ao ar uma config de semanas atrás, sem ninguém olhar, é o
   * tipo de botão que derruba a loja de um cliente num clique errado.
   */
  update public.app_configs
     set config = jsonb_set(v_config, '{version}', to_jsonb(v_rascunho.version))
   where id = v_rascunho.id;

  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    raise exception 'Sem permissão para restaurar a configuração deste app.'
      using errcode = '42501';
  end if;

  return v_rascunho.version;
end;
$$;

comment on function public.restaurar_config is
  'Copia a config de uma versão antiga para o rascunho atual. Não publica.';

-- Ninguém sem sessão tem o que fazer com estas funções.
revoke execute on function public.publicar_config(uuid) from public, anon;
revoke execute on function public.restaurar_config(uuid, integer) from public, anon;
grant execute on function public.publicar_config(uuid) to authenticated;
grant execute on function public.restaurar_config(uuid, integer) to authenticated;
