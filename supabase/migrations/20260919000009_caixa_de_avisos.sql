-- A caixa de avisos do app (M07 do plano).
--
-- "Lista as campanhas enviadas pela API da Storefy e controla lidas/não lidas
-- localmente." O que é lido fica no aparelho; o que foi ENVIADO vem daqui.
--
-- Duas regras moram nesta função, e as duas são sobre não mostrar o que não é
-- daquele cliente:
--
--   só campanhas enviadas DEPOIS de o aparelho existir. Quem instalou hoje não
--   tem por que ver a promoção do mês passado, que já acabou;
--
--   só campanhas que foram para todo mundo. Uma campanha com segmento foi para
--   um recorte de clientes, e a Storefy não guarda quem estava nele — a
--   segmentação acontece dentro do OneSignal. Mostrá-la a todos colocaria na
--   caixa de um cliente uma oferta que não era para ele, muitas vezes com
--   preço diferente. O painel avisa o lojista disso ao escolher um segmento.

create or replace function public.caixa_de_avisos(
  p_app_id uuid,
  p_subscription text,
  p_limite integer default 50
)
returns table (
  id uuid,
  title text,
  body text,
  deep_link text,
  image_path text,
  sent_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_desde timestamptz;
begin
  if not public.consumir_limite('avisos:' || p_app_id::text, 600) then
    return;
  end if;

  select d.created_at into v_desde
    from public.devices d
   where d.app_id = p_app_id and d.onesignal_subscription_id = p_subscription;

  -- Sem aparelho conhecido não há caixa: devolver a lista cheia aqui faria do
  -- endpoint uma forma de ler as campanhas de qualquer loja sem ter o app.
  if v_desde is null then
    return;
  end if;

  return query
  select c.id, c.title, c.body, c.deep_link, c.image_path, c.sent_at
    from public.push_campaigns c
   where c.app_id = p_app_id
     and c.status = 'sent'
     and c.sent_at is not null
     and c.sent_at >= v_desde
     and c.segment = '{}'::jsonb
   order by c.sent_at desc
   limit least(greatest(coalesce(p_limite, 50), 1), 100);
end;
$$;

comment on function public.caixa_de_avisos is
  'Campanhas que este aparelho pode ver na caixa de avisos do app.';

revoke execute on function public.caixa_de_avisos(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.caixa_de_avisos(uuid, text, integer) to service_role;
