-- C08: a campanha de push ganha imagem e público.
--
-- As colunas já existiam (`image_path` e `segment`), mas nenhuma tela as
-- preenchia: toda campanha ia sem imagem e para todo mundo. Esta migration
-- dá a elas regra — onde a imagem mora, de que loja ela é, que públicos
-- existem — e leva a imagem até o job que fala com a OneSignal.

-- ----------------------------------------------------------- o bucket

/*
 * PÚBLICO, ao contrário do `app-assets`. A OneSignal e o celular de cada
 * cliente baixam a imagem sozinhos, na hora da entrega — que pode ser dias
 * depois do envio, para quem estava sem sinal —, e um link assinado venceria
 * no meio do caminho. O que protege a imagem de uma promoção ainda não
 * lançada é o NOME: um uuid aleatório por arquivo, que ninguém adivinha. A
 * listagem continua fechada (sem policy de leitura para quem não é da loja).
 *
 * Só JPEG e no máximo 1 MB: o servidor reprocessa toda imagem antes de
 * guardar (gira pela câmera, reduz para 1440 px, tira a transparência), e o
 * que sai de lá tem uns 200 KB. Qualquer outra coisa aqui chegou por fora.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('push-imagens', 'push-imagens', true, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O caminho é sempre `<store_id>/<uuid>.jpg`: a primeira pasta diz de quem é.
create policy "membros leem as imagens de push da própria loja"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'push-imagens'
    and public.is_store_member(((storage.foldername(name))[1])::uuid)
  );

create policy "owner e admin enviam imagens de push da própria loja"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'push-imagens'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create policy "owner e admin apagam imagens de push da própria loja"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'push-imagens'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

-- ------------------------------------------------------ a campanha

/*
 * A imagem é SEMPRE um arquivo do bucket, no formato que o servidor grava.
 * Nada de URL de fora: a notificação mostraria uma imagem que o lojista não
 * controla, e que poderia trocar depois do envio.
 */
alter table public.push_campaigns
  add constraint push_campaigns_imagem_do_bucket
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');

/*
 * O público é um dos que o painel oferece — e só isso. `{}` é todo mundo, como
 * sempre foi. `not valid`: campanhas antigas não são revalidadas (todas têm
 * `{}`, mas a migration não aposta nisso); daqui para a frente, vale.
 *
 * O `coalesce(…, false)` não é enfeite: um CHECK que dá NULO PASSA. Sem ele,
 * `{"publico":"inativos"}` sem o prazo comparava nulo com número, dava nulo, e
 * entrava — uma campanha para "quem sumiu há ? dias".
 */
alter table public.push_campaigns
  add constraint push_campaigns_publico_conhecido
  check (
    coalesce(
      segment = '{}'::jsonb
      or (
        segment ->> 'publico' in ('compradores', 'sem_compra', 'com_carrinho')
        and segment - 'publico' = '{}'::jsonb
      )
      or (
        segment ->> 'publico' in ('inativos', 'ativos')
        and jsonb_typeof(segment -> 'dias') = 'number'
        and (segment ->> 'dias')::numeric between 1 and 365
        and (segment ->> 'dias')::numeric = trunc((segment ->> 'dias')::numeric)
        and segment - 'publico' - 'dias' = '{}'::jsonb
      ),
      false
    )
  ) not valid;

/*
 * A imagem é da loja da campanha. O caminho vem do servidor, que já confere
 * isso — a trava aqui é para o dia em que alguém chamar a API direto com o
 * caminho da imagem de outra loja: a campanha de um cliente não pode exibir,
 * nem manter viva, a imagem de outro.
 */
create or replace function public.push_campaigns_imagem_da_loja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Fora do formato do bucket, quem recusa é a trava de formato, com o
  -- próprio nome: "de outra loja" não descreve um endereço da internet.
  if new.image_path is not null
     and new.image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
     and split_part(new.image_path, '/', 1) is distinct from (
       select a.store_id::text from public.apps a where a.id = new.app_id
     ) then
    raise exception 'A imagem é de outra loja.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.push_campaigns_imagem_da_loja() from public, anon, authenticated;

create trigger push_campaigns_imagem_da_loja
  before insert or update of image_path, app_id on public.push_campaigns
  for each row execute function public.push_campaigns_imagem_da_loja();

-- --------------------------------------------------------- o despacho

/*
 * O mesmo `reservar_campanhas` da cobrança (migration 44), devolvendo também
 * a imagem. O tipo de retorno muda, então a função é recriada.
 */
drop function public.reservar_campanhas(integer);

create function public.reservar_campanhas(p_limite integer default 20)
returns table (
  id uuid,
  app_id uuid,
  title text,
  body text,
  deep_link text,
  segment jsonb,
  image_path text,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.push_campaigns c
     set status = 'failed',
         stats = coalesce(c.stats, '{}'::jsonb) || jsonb_build_object(
           'erro',
           'Não saiu: a assinatura da empresa não estava em dia na hora do envio. Veja em Configurações › Plano e cobrança.'
         )
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = c.app_id
     and c.status = 'scheduled'
     and c.scheduled_at is not null
     and c.scheduled_at <= now()
     and not public.org_em_dia(s.org_id);

  return query
  with reservadas as (
    update public.push_campaigns c
       set status = 'sending', updated_at = now()
     where c.id in (
       select c2.id
         from public.push_campaigns c2
        where c2.status = 'scheduled'
          and c2.scheduled_at is not null
          and c2.scheduled_at <= now()
        order by c2.scheduled_at
        limit greatest(coalesce(p_limite, 20), 1)
        -- Duas execuções do cron ao mesmo tempo: a segunda pula as linhas que
        -- a primeira já pegou, em vez de esperar por elas e mandar de novo.
        for update skip locked
     )
    returning c.id, c.app_id, c.title, c.body, c.deep_link, c.segment, c.image_path
  )
  select r.id, r.app_id, r.title, r.body, r.deep_link, r.segment, r.image_path,
         a.onesignal_app_id, a.onesignal_api_key_enc
    from reservadas r
    join public.apps a on a.id = r.app_id;
end;
$$;

comment on function public.reservar_campanhas is
  'Reserva as campanhas vencidas para o job de envio, com a imagem e a chave da loja.';

revoke execute on function public.reservar_campanhas(integer) from public, anon, authenticated;
grant execute on function public.reservar_campanhas(integer) to service_role;

/*
 * Imagens que nenhuma campanha usa, enviadas há mais de um dia: o formulário
 * que subiu a imagem e nunca foi salvo, a imagem trocada numa edição, a
 * campanha excluída. O job apaga pelo Storage — apagar a linha daqui deixaria
 * o arquivo órfão no disco.
 *
 * Um dia de folga porque o formulário pode estar aberto: quem enviou a imagem
 * agora há pouco e ainda não salvou não pode perdê-la no meio do caminho.
 */
create or replace function public.imagens_de_push_sem_campanha(p_limite integer default 200)
returns table (caminho text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'push-imagens'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1 from public.push_campaigns c where c.image_path = o.name
     )
   order by o.created_at
   limit greatest(coalesce(p_limite, 200), 1);
$$;

comment on function public.imagens_de_push_sem_campanha is
  'C08: imagens de push que ninguém usa, para o job apagar. Só service_role.';

revoke all on function public.imagens_de_push_sem_campanha(integer) from public, anon, authenticated;
grant execute on function public.imagens_de_push_sem_campanha(integer) to service_role;
