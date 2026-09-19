-- Onde ficam o ícone e a tela de abertura de cada loja (C06a e seção 7).
--
-- Um bucket PRIVADO. O ícone de um app que ainda não foi publicado é
-- informação do cliente: ele pode estar testando três desenhos, ou o app pode
-- ser de uma marca que ainda não anunciou. Bucket público entregaria tudo isso
-- a quem adivinhasse o id da loja.
--
-- O caminho é sempre `<store_id>/<arquivo>`, e é dele que as policies tiram de
-- quem é o arquivo. O painel lê por URL assinada, de validade curta; o
-- workflow de build também.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-assets',
  'app-assets',
  false,
  -- 8 MB. Um ícone de 1024×1024 tem uns 200 KB; acima disto é arquivo errado.
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * No Supabase, `storage.objects` já vem com RLS ligada e pertence a outro
 * papel — `alter table` ali responde "must be owner of table objects". No
 * banco local de teste, a tabela é um stub e precisa da linha. Por isso a
 * tentativa é tolerante: o que não pode é ficar sem RLS em lugar nenhum, e a
 * asserção do teste cobra isso dos dois lados.
 */
do $$
begin
  alter table storage.objects enable row level security;
exception
  when insufficient_privilege then
    raise notice 'storage.objects já tem RLS ligada e é de outro dono; seguindo.';
end
$$;

/**
 * Quem pode mexer nos arquivos de uma loja.
 *
 * A primeira pasta do caminho é o `store_id`, e `is_store_member` é a mesma
 * função que decide o resto do produto — não há uma segunda regra aqui para
 * divergir da primeira.
 */
create policy "membros leem os assets da própria loja"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'app-assets'
    and public.is_store_member(((storage.foldername(name))[1])::uuid)
  );

-- Enviar e trocar o ícone é decisão de marca, e fica com quem responde pela
-- organização — o mesmo critério de publicar o app.
create policy "owner e admin enviam assets da própria loja"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'app-assets'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create policy "owner e admin trocam assets da própria loja"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'app-assets'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create policy "owner e admin apagam assets da própria loja"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'app-assets'
    and public.has_store_role(
      ((storage.foldername(name))[1])::uuid,
      array['owner', 'admin']::public.membership_role[]
    )
  );
