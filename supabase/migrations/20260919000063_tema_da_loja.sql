-- =============================================================================
-- A10: o tema da Shopify que a loja usa
-- =============================================================================
--
-- Os presets de tema (A10) só poupam trabalho se o lojista achar o dele. O
-- tema é lido da própria página da loja — toda loja Shopify publica
-- `Shopify.theme = {"schema_name":"Dawn",…}` — no cadastro (C02) e, depois,
-- quando o lojista pede no editor. Com ele, o editor põe o preset feito para
-- aquele tema em primeiro, marcado.
--
-- É uma dica, e não uma regra: nada é aplicado sozinho, e o lojista continua
-- podendo escolher qualquer preset.
-- =============================================================================

alter table public.stores add column shopify_theme text;

alter table public.stores
  add constraint stores_shopify_theme_formato check (
    shopify_theme is null
    or (char_length(shopify_theme) between 1 and 80 and shopify_theme !~ '[[:cntrl:]]')
  );

comment on column public.stores.shopify_theme is
  'O tema da Shopify da loja (schema_name da página), para sugerir o preset (A10).';

-- Coluna nova nasce sem grant nesta tabela (ver migrations 5 e 23).
grant select (shopify_theme), insert (shopify_theme), update (shopify_theme)
  on public.stores to authenticated;
