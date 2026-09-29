/*
 * A10 — presets de configuração por tema da Shopify.
 *
 * O PROBLEMA QUE RESOLVE: cada tema (Dawn, Impulse, Prestige…) esconde o
 * cabeçalho e o rodapé com seletores diferentes. Descobrir quais são, loja por
 * loja, é o passo mais lento do onboarding — e é um trabalho que já foi feito
 * na primeira loja daquele tema.
 *
 * O PRESET NASCE DE UMA LOJA QUE JÁ FUNCIONA, e não de um editor próprio no
 * admin. Duas razões: um segundo editor de abas seria uma cópia do C06 que
 * envelheceria em paralelo, e um preset escrito à mão é um palpite — um
 * copiado de loja no ar já foi conferido por alguém olhando a tela.
 *
 * QUEM LÊ: os lojistas também, e isso é de propósito. O preset é conteúdo do
 * produto, não dado de cliente: saber que a Storefy tem um preset para Dawn
 * não conta nada sobre ninguém. Por isso a policy libera os ATIVOS para
 * qualquer autenticado — sem isso o lojista não teria como aplicar o preset, e
 * a tela do admin viraria dado que ninguém consome.
 */
create table public.config_presets (
  id uuid primary key default extensions.gen_random_uuid(),
  /** Como aparece na lista do lojista: "Dawn — padrão", "Impulse — sem busca". */
  nome text not null,
  /** O tema da Shopify a que ele serve. Texto livre: a Shopify não tem lista fechada. */
  tema text not null,
  descricao text,
  /**
   * As abas, no formato de `TabSchema`. O banco confere só a FORMA (array de
   * 2 a 5); o conteúdo é validado pelo Zod ao aplicar, que é onde o schema
   * mora de verdade. Duplicar as regras do Zod aqui em SQL criaria dois
   * lugares para manter e um deles ficaria para trás.
   */
  tabs jsonb not null,
  /** Os seletores que somem no app. É a parte que muda de tema para tema. */
  hide_selectors jsonb not null default '[]'::jsonb,
  custom_css text not null default '',
  /**
   * Desligado some da lista do lojista, mas continua existindo. Apagar um
   * preset que já foi aplicado não desfaz nada — e tirar do caminho um que
   * ficou ruim é mais comum do que querer perdê-lo de vez.
   */
  ativo boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint config_presets_nome_tamanho check (length(btrim(nome)) between 2 and 80),
  constraint config_presets_tema_tamanho check (length(btrim(tema)) between 2 and 60),
  constraint config_presets_css_tamanho check (length(custom_css) <= 20000),
  -- A mesma faixa do `AppConfigSchema`: menos de 2 abas não é tab bar, mais
  -- de 5 não cabe na tela. Um preset fora disso seria recusado só na hora de
  -- aplicar, depois de o lojista escolher.
  constraint config_presets_tabs_forma check (
    jsonb_typeof(tabs) = 'array'
    and jsonb_array_length(tabs) between 2 and 5
  ),
  constraint config_presets_seletores_forma check (jsonb_typeof(hide_selectors) = 'array')
);

comment on table public.config_presets is
  'A10: presets de abas e CSS por tema da Shopify. Lidos por lojistas, escritos só pela equipe.';

create index config_presets_ativos on public.config_presets (ativo, tema, nome);

-- ------------------------------------------------------------------ RLS

alter table public.config_presets enable row level security;

/*
 * Os ativos, para qualquer autenticado; todos, para a equipe.
 *
 * A parte do lojista NÃO é descuido: sem ela ele não consegue listar os
 * presets para aplicar, e a curadoria do admin viraria dado morto. O que
 * vaza aqui é a lista de temas que a Storefy suporta — conteúdo do produto,
 * não dado de cliente.
 */
create policy "presets ativos são visíveis para quem for aplicar"
  on public.config_presets for select to authenticated
  using (ativo or public.is_platform_admin());

comment on policy "presets ativos são visíveis para quem for aplicar" on public.config_presets is
  'Lojista vê os ativos para aplicar; a equipe vê todos. Escrever é caminho de servidor.';

revoke all on public.config_presets from anon;
grant select on public.config_presets to authenticated;

-- ------------------------------------------ copiar a config publicada de uma loja

/*
 * O pedaço reaproveitável da config publicada de um app.
 *
 * Devolve só o que um preset carrega — abas, seletores e CSS —, e não a config
 * inteira: nome da loja, cores e domínio são daquele cliente, e copiá-los para
 * outro seria vazar a identidade de um na tela do outro.
 *
 * `security definer` porque quem chama é o admin criando o preset, e a config
 * pertence a outra organização. A guarda no topo é o que substitui a policy.
 */
create or replace function public.admin_config_para_preset(p_app_id uuid)
returns table (tabs jsonb, hide_selectors jsonb, custom_css text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    coalesce(c.config -> 'tabs', '[]'::jsonb),
    coalesce(c.config -> 'webview' -> 'hideSelectors', '[]'::jsonb),
    coalesce(c.config -> 'webview' ->> 'customCss', '')
  from public.app_configs c
  where c.app_id = p_app_id and c.status = 'published'
  limit 1;
end
$$;

comment on function public.admin_config_para_preset is
  'Abas, seletores e CSS da config PUBLICADA de um app, para virar preset. Só platform_admin.';

revoke all on function public.admin_config_para_preset(uuid) from public, anon;
grant execute on function public.admin_config_para_preset(uuid) to authenticated;
