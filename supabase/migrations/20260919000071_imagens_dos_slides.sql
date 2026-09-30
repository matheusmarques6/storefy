-- C06d: a imagem dos slides de boas-vindas ganha envio, conferência e limpeza.
--
-- Até aqui o campo era um endereço digitado: uma imagem de outro site, que o
-- lojista não controla, podia ser um `http://` que o iPhone recusa, e sumia
-- do app no dia em que aquele site saísse do ar. Agora a imagem é enviada
-- pelo painel, reprocessada pelo servidor e guardada aqui.

-- ----------------------------------------------------------- o bucket

/*
 * PÚBLICO, como o `push-imagens`: o app de cada cliente baixa a imagem na
 * primeira abertura, sem sessão nenhuma, e um link assinado venceria dentro
 * da config publicada. O nome é um uuid aleatório por arquivo; a listagem
 * continua fechada.
 *
 * JPEG ou PNG: o servidor mantém a transparência de quem tem (PNG), para a
 * imagem não ganhar um fundo branco sobre um app de fundo escuro, e regrava o
 * resto em JPEG. O que sai de lá tem no máximo 1080 px de lado.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens-do-app', 'imagens-do-app', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O caminho é sempre `<store_id>/<uuid>.<jpg|png>`: a primeira pasta diz de quem é.
create policy "membros leem as imagens do app da própria loja"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'imagens-do-app'
    and public.is_store_member(((storage.foldername(name))[1])::uuid)
  );

create policy "owner e admin enviam imagens do app da própria loja"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'imagens-do-app'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create policy "owner e admin apagam imagens do app da própria loja"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'imagens-do-app'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

-- ------------------------------------------------------------ a limpeza

/*
 * As imagens que nenhuma versão da config usa, para o job apagar.
 *
 * "Nenhuma versão" e não "o rascunho": o histórico (C06f) restaura versões
 * antigas, e a imagem de uma delas precisa estar lá quando voltar. O que sobra
 * é o que foi enviado e nunca entrou numa versão (a imagem trocada antes de
 * salvar) e o que era de uma loja excluída — as versões dela foram junto.
 *
 * Um dia de folga, como no push: quem enviou agora há pouco pode ainda não
 * ter salvo o rascunho.
 */
create or replace function public.imagens_do_app_sem_uso(p_limite integer default 200)
returns table (caminho text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'imagens-do-app'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1
         from public.app_configs c
         join public.apps a on a.id = c.app_id
        where a.store_id::text = split_part(o.name, '/', 1)
          and strpos(c.config::text, o.name) > 0
     )
   order by o.created_at
   limit greatest(coalesce(p_limite, 200), 1);
$$;

comment on function public.imagens_do_app_sem_uso is
  'C06d: imagens dos slides que nenhuma versão da config usa, para o job apagar. Só service_role.';

revoke all on function public.imagens_do_app_sem_uso(integer) from public, anon, authenticated;
grant execute on function public.imagens_do_app_sem_uso(integer) to service_role;
