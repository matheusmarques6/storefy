-- Conectar a Shopify pelo app que o LOJISTA cria na conta dele.
--
-- Até aqui só havia um caminho: o OAuth do app público da Storefy. Ele é o
-- melhor caminho — um clique para o lojista — mas depende de uma revisão da
-- Shopify que leva semanas, e antes dela NENHUMA loja conecta. O produto
-- inteiro da Fase 5 (receita separada do app, aviso de envio, "voltou ao
-- estoque") fica parado esperando um terceiro.
--
-- O segundo caminho é o app personalizado: o lojista cria um app na conta
-- Shopify dele, instala na própria loja e nos entrega Client ID e Client
-- Secret. Com eles, `grant_type=client_credentials` devolve um token de
-- acesso. Não passa por revisão nenhuma, e funciona hoje.
--
-- TRÊS DIFERENÇAS QUE O BANCO PRECISA GUARDAR:
--
--   1. O token morre em 24 horas (`expires_in` 86399), contra o token de
--      OAuth que vale até a desinstalação. Por isso `shopify_token_expires_at`:
--      sem ela, a única forma de saber que o token venceu seria uma chamada
--      falhando na cara do lojista.
--
--   2. Quem assina os webhooks passa a ser o segredo DAQUELE app, e não o
--      `SHOPIFY_API_SECRET` da Storefy. Cada loja tem o seu. Por isso
--      `shopify_client_secret_enc` — cifrada, como todo segredo de cliente.
--
--   3. As duas formas de conectar coexistem, e o resto do código precisa
--      saber qual é qual para renovar token só de quem tem token que vence.
--      Por isso `shopify_conexao`.
--
-- O Client ID NÃO é segredo (ele viaja em toda URL de autorização), então ele
-- é legível pelo painel: mostrar ao lojista qual app está conectado é o que
-- deixa ele conferir que colou o app certo, em vez de adivinhar.

create type public.shopify_conexao as enum ('oauth', 'manual');

comment on type public.shopify_conexao is
  'oauth: app público da Storefy. manual: app personalizado do próprio lojista.';

alter table public.stores
  add column shopify_conexao public.shopify_conexao,
  add column shopify_client_id text,
  add column shopify_client_secret_enc text,
  add column shopify_token_expires_at timestamptz;

comment on column public.stores.shopify_conexao is
  'Como esta loja conectou. Nulo quando nunca conectou.';
comment on column public.stores.shopify_client_id is
  'Client ID do app personalizado do lojista. Não é segredo.';
comment on column public.stores.shopify_client_secret_enc is
  'Client Secret do app do lojista, cifrado. Assina os webhooks DESTA loja e renova o token.';
comment on column public.stores.shopify_token_expires_at is
  'Quando o token vence. Só a conexão manual tem prazo; no OAuth fica nulo.';

-- Uma conexão manual sem as duas credenciais é uma loja que não renova o
-- token e não confere assinatura de webhook: ela pararia de funcionar sozinha
-- em 24 horas, e o sintoma seria "os pedidos sumiram" dias depois. Melhor o
-- banco recusar a linha do que o lojista descobrir assim.
alter table public.stores
  add constraint stores_conexao_manual_completa check (
    shopify_conexao is distinct from 'manual'
    or (shopify_client_id is not null and shopify_client_secret_enc is not null)
  );

-- COLUNA NOVA NASCE SEM GRANT, e é isso que queremos para a `_enc`: nem o
-- dono da organização escreve ou lê o segredo do app do cliente. As outras
-- três entram no SELECT porque a tela mostra o estado da conexão, e ficam
-- FORA do insert/update porque quem as grava é sempre a service role, depois
-- de ter falado com a Shopify.
grant select (shopify_conexao, shopify_client_id, shopify_token_expires_at)
  on public.stores to authenticated;

-- A conexão morre junto com o app, e a limpeza tem UM lugar só.
--
-- `desconectar_shopify` já é chamada pelo `app/uninstalled` e, de dentro de
-- `apagar_dados_da_shopify`, pelo `shop/redact`. Acrescentar as colunas aqui
-- cobre os dois caminhos de uma vez; apagar só em `apagar_dados_da_shopify`
-- deixaria o segredo do app do cliente guardado nas 48 horas entre a
-- desinstalação e o redact — e para sempre, se o redact nunca chegasse.
create or replace function public.desconectar_shopify(p_shop_domain text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update public.stores
     set shopify_access_token_enc = null,
         shopify_scopes = null,
         shopify_conexao = null,
         shopify_client_id = null,
         shopify_client_secret_enc = null,
         shopify_token_expires_at = null
   where shop_domain = lower(trim(p_shop_domain));

  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
end;
$$;

comment on function public.desconectar_shopify(text) is
  'Apaga o token e as credenciais da loja quando o app Shopify é desinstalado. Só service role.';

revoke all on function public.desconectar_shopify(text) from public, anon, authenticated;
grant execute on function public.desconectar_shopify(text) to service_role;
