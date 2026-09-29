-- O token do carrinho sem a chave secreta.
--
-- Desde julho de 2025, o `/cart.js` da Shopify devolve o token no formato
-- `<token>?key=<segredo>`. A chave dá acesso aos dados particulares do
-- comprador no carrinho (e-mail, endereço), e a própria Shopify manda tratá-la
-- como senha: nunca guardar, nunca expor. O app a mandava inteira, e ela ia
-- parar em `cart_events`.
--
-- Além do vazamento, havia o defeito: o `cart_token` do pedido, que chega pelo
-- webhook `orders/create`, vem SEM a chave. Com ela gravada de um lado só, o
-- pedido nunca casava com o aparelho, e o push de "seu pedido saiu" não tinha
-- para quem ir.
--
-- O app novo já manda o token limpo; o servidor limpa de novo; e esta trava
-- garante que nada que chegue por outro caminho — app antigo, chamada direta —
-- fique guardado com a chave.

create or replace function public.token_do_carrinho_sem_chave()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cart_token is not null then
    new.cart_token := nullif(btrim(split_part(new.cart_token, '?', 1)), '');
  end if;
  return new;
end;
$$;

comment on function public.token_do_carrinho_sem_chave() is
  'Tira a chave secreta (`?key=`) do token do carrinho antes de gravar.';

revoke all on function public.token_do_carrinho_sem_chave() from public, anon, authenticated;

create trigger cart_events_token_sem_chave
  before insert or update of cart_token on public.cart_events
  for each row execute function public.token_do_carrinho_sem_chave();

create trigger shop_orders_token_sem_chave
  before insert or update of cart_token on public.shop_orders
  for each row execute function public.token_do_carrinho_sem_chave();

-- O que já foi gravado com a chave perde a chave agora.
update public.cart_events
   set cart_token = cart_token
 where cart_token like '%?%';

update public.shop_orders
   set cart_token = cart_token
 where cart_token like '%?%';
