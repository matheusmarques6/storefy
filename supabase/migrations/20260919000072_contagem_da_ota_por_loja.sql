-- A-OTA: a contagem da rodada passa a ser por loja.
--
-- Cada loja da matriz conta como foi numa chamada à Storefy. Essa chamada não
-- tentava de novo: se o servidor piscasse naquele instante, a conta nunca
-- fechava, a rodada ficava "publicando" para sempre, e a trava de "uma de
-- cada vez" impedia qualquer correção depois dela.
--
-- O workflow agora tenta de novo — e, para isso, a conta precisa aguentar a
-- mesma loja chegando duas vezes. Com a loja na chamada:
--
--   a mesma loja contada de novo, com o mesmo desfecho, não soma;
--   a loja que falhou e deu certo depois (o job reexecutado no GitHub) passa
--   de falha para concluída;
--   as lojas que falharam ficam guardadas, e o admin sabe quais foram.
--
-- Sem a loja (o workflow de antes desta migration), soma como sempre somou.

alter table public.ota_updates
  add column lojas_contadas uuid[] not null default '{}',
  add column lojas_com_falha uuid[] not null default '{}';

comment on column public.ota_updates.lojas_contadas is
  'Lojas que já contaram nesta rodada. A mesma loja de novo (o workflow tentou outra vez) não soma.';
comment on column public.ota_updates.lojas_com_falha is
  'Lojas em que a publicação falhou, para o admin saber quais. Sai daqui a que der certo depois.';

drop function public.contar_ota(uuid, boolean);

create function public.contar_ota(p_id uuid, p_ok boolean, p_store_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contada boolean;
  v_falhou boolean;
begin
  if p_store_id is null then
    update public.ota_updates
       set concluidas = concluidas + (case when p_ok then 1 else 0 end),
           falhas = falhas + (case when p_ok then 0 else 1 end),
           status = case when status = 'queued' then 'running' else status end,
           started_at = coalesce(started_at, now())
     where id = p_id;
    return;
  end if;

  /*
   * A linha fica travada até o fim: duas lojas terminando juntas esperam uma
   * pela outra, e a segunda lê a lista que a primeira acabou de gravar.
   */
  select p_store_id = any (lojas_contadas), p_store_id = any (lojas_com_falha)
    into v_contada, v_falhou
    from public.ota_updates
   where id = p_id
   for update;

  if not found then
    return;
  end if;

  if not v_contada then
    update public.ota_updates
       set concluidas = concluidas + (case when p_ok then 1 else 0 end),
           falhas = falhas + (case when p_ok then 0 else 1 end),
           lojas_contadas = array_append(lojas_contadas, p_store_id),
           lojas_com_falha = case when p_ok then lojas_com_falha
                                  else array_append(lojas_com_falha, p_store_id) end,
           status = case when status = 'queued' then 'running' else status end,
           started_at = coalesce(started_at, now())
     where id = p_id;
  elsif v_falhou and p_ok then
    update public.ota_updates
       set concluidas = concluidas + 1,
           falhas = falhas - 1,
           lojas_com_falha = array_remove(lojas_com_falha, p_store_id)
     where id = p_id;
  end if;
  /*
   * Contada de novo com o mesmo desfecho, ou uma falha depois de ter dado
   * certo: nada muda. O canal da loja continua com a correção que já recebeu.
   */
end;
$$;

comment on function public.contar_ota(uuid, boolean, uuid) is
  'Conta uma loja na rodada, uma vez por loja; a falha que dá certo depois vira concluída. Sem a loja, soma como antes.';

revoke all on function public.contar_ota(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.contar_ota(uuid, boolean, uuid) to service_role;
