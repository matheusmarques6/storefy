-- Publicar com atualização obrigatória só para uma versão que existe.
--
-- `minSupportedBuild` faz o app mostrar "Atualize o app" para quem tem um build
-- mais antigo. Ele era inalcançável (nenhuma tela o gravava) e agora o editor
-- o grava — e com isso aparece o jeito de errar feio: exigir um número que
-- ainda não passou pela Apple ou pela Google. O app de todo cliente da loja
-- travaria na tela de atualizar, sem atualização para baixar.
--
-- A tela já não oferece esse número. A trava mora TAMBÉM aqui porque a RPC é
-- chamável direto pela API com a sessão do lojista, e porque "restaurar" uma
-- versão antiga pode trazer de volta um número que deixou de valer.
--
-- O resto da função é o mesmo de `20260919000002`.

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
  v_minimo integer;
  v_disponivel integer;
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

  /*
   * A atualização obrigatória só pode exigir uma versão que JÁ ESTÁ nas lojas.
   * Exigir uma que não está trava o app de todo cliente da loja: a tela
   * "Atualize o app" aparece, e não há atualização nenhuma para baixar.
   *
   * O limite é o MENOR entre os últimos builds aprovados de cada plataforma:
   * o contador é por app, então o número mais novo do Android pode não existir
   * no iPhone.
   */
  v_minimo := coalesce((v_rascunho.config ->> 'minSupportedBuild')::integer, 1);
  if v_minimo > 1 then
    select min(t.maximo) into v_disponivel
      from (
        select max(b.build_number) as maximo
          from public.builds b
         where b.app_id = p_app_id
           and b.status = 'approved'
           and b.build_number is not null
         group by b.platform
      ) t;

    if v_disponivel is null or v_minimo > v_disponivel then
      raise exception 'A atualização obrigatória pede uma versão que ainda não está nas lojas. Escolha a versão que já foi aprovada, ou desligue a atualização obrigatória.';
    end if;
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

