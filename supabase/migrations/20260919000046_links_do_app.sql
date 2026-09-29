-- Links da loja abrindo no app: Universal Links (iPhone) e App Links (Android).
--
-- O app já declara o domínio da loja; o domínio precisa publicar que aceita o
-- app. Numa loja Shopify, quem publica é a Shopify, a partir do cadastro feito
-- pela API de "Mobile Platform Applications" (ver `lib/links-do-app.ts`).
--
-- Para o Android, a publicação leva a impressão digital SHA-256 do certificado
-- que assina o app — a que o Play Console mostra em "Integridade do app". Não é
-- segredo: é a parte pública do certificado, e vai parar num arquivo aberto no
-- site da loja. Quem a cola é o lojista (dono ou administrador).
--
-- As datas de vínculo e o último erro são gravados SÓ pelo servidor, depois de
-- a Shopify responder: se o painel pudesse gravá-los, "vinculado" viraria uma
-- palavra que qualquer membro escreve.

create or replace function public.impressoes_sha256_validas(p_impressoes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    bool_and(impressao ~ '^([0-9A-F]{2}:){31}[0-9A-F]{2}$'),
    true
  )
  from unnest(p_impressoes) as impressao;
$$;

comment on function public.impressoes_sha256_validas(text[]) is
  'Todas as impressões no formato AA:BB:… de uma SHA-256 (32 pares), como o Play Console mostra.';

-- A trava abaixo a chama na escrita de quem edita o app; anônimo não edita nada.
revoke all on function public.impressoes_sha256_validas(text[]) from public, anon;
grant execute on function public.impressoes_sha256_validas(text[]) to authenticated, service_role;

alter table public.apps
  add column android_cert_fingerprints text[] not null default '{}',
  add column ios_links_linked_at timestamptz,
  add column android_links_linked_at timestamptz,
  add column links_error text;

alter table public.apps
  add constraint apps_impressoes_do_android_validas
    check (
      cardinality(android_cert_fingerprints) <= 5
      and public.impressoes_sha256_validas(android_cert_fingerprints)
    ),
  add constraint apps_erro_dos_links_curto
    check (links_error is null or char_length(links_error) <= 500);

comment on column public.apps.android_cert_fingerprints is
  'SHA-256 do certificado que assina o app no Android (parte pública), para os App Links.';
comment on column public.apps.ios_links_linked_at is
  'Quando a Shopify confirmou o app no domínio da loja para os Universal Links. Só o servidor grava.';
comment on column public.apps.android_links_linked_at is
  'Quando a Shopify confirmou o app no domínio da loja para os App Links. Só o servidor grava.';
comment on column public.apps.links_error is
  'O que a Shopify respondeu na última tentativa que falhou, em português. Só o servidor grava.';

/*
 * Trocar a impressão desfaz o vínculo do Android: o que está publicado no
 * domínio é a impressão antiga, e dizer "vinculado" seria mentira até a
 * próxima publicação.
 */
create or replace function public.apps_impressao_nova_desvincula()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.android_cert_fingerprints is distinct from old.android_cert_fingerprints then
    new.android_links_linked_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.apps_impressao_nova_desvincula() from public, anon, authenticated;

create trigger apps_impressao_nova_desvincula
  before update of android_cert_fingerprints on public.apps
  for each row execute function public.apps_impressao_nova_desvincula();

-- Leitura para quem já lê o app; escrita, só da impressão.
grant select (
  android_cert_fingerprints, ios_links_linked_at, android_links_linked_at, links_error
) on public.apps to authenticated;

grant insert (android_cert_fingerprints), update (android_cert_fingerprints)
  on public.apps to authenticated;

/*
 * O resultado da conversa com a Shopify, gravado pelo servidor.
 *
 * `p_ios` e `p_android`: 'vinculado', 'falhou' ou nulo (não tentado). Uma
 * falha NÃO apaga um vínculo anterior: o que a Shopify já publica continua
 * publicado, e a tela mostra o erro ao lado da data.
 *
 * `p_ator` é quem pediu, conferido pelo servidor. Ele vira o autor da sessão
 * só nesta transação, para a trilha de auditoria (o gatilho de `apps`) creditar
 * a pessoa, e não "o sistema".
 */
create or replace function public.registrar_links_do_app(
  p_app_id uuid,
  p_ator uuid,
  -- Opcionais no fim, com `default null`: é o que deixa o tipo gerado dizer
  -- que "não tentado" é um valor legítimo.
  p_ios text default null,
  p_android text default null,
  p_erro text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_ios, 'vinculado') not in ('vinculado', 'falhou')
     or coalesce(p_android, 'vinculado') not in ('vinculado', 'falhou') then
    raise exception 'Resultado desconhecido: use vinculado, falhou ou nulo.';
  end if;

  if p_ator is not null then
    perform set_config('request.jwt.claim.sub', p_ator::text, true);
  end if;

  update public.apps
     set ios_links_linked_at =
           case when p_ios = 'vinculado' then now() else ios_links_linked_at end,
         android_links_linked_at =
           case when p_android = 'vinculado' then now() else android_links_linked_at end,
         links_error = nullif(left(btrim(coalesce(p_erro, '')), 500), '')
   where id = p_app_id;

  if not found then
    raise exception 'App não encontrado.';
  end if;
end;
$$;

comment on function public.registrar_links_do_app(uuid, uuid, text, text, text) is
  'Grava o resultado do vínculo do app no domínio da loja. Só service role, depois de conferir quem pediu.';

revoke all on function public.registrar_links_do_app(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_links_do_app(uuid, uuid, text, text, text)
  to service_role;

/*
 * Loja desconectada da Shopify: o vínculo deixa de ser nosso para afirmar.
 *
 * Não há como conferir se a Shopify mantém o cadastro depois que o app sai, e
 * a tela não pode continuar dizendo "a Shopify publica os links desde…" por
 * inércia. Reconectada, um "Vincular de novo" refaz o cadastro (a chamada é
 * idempotente). Um lugar só para os três caminhos de desconexão — o botão do
 * painel, o `app/uninstalled` e o `shop/redact` —, que é a coluna de escopos
 * voltando a nula.
 *
 * SECURITY DEFINER porque quem desconecta pelo painel é o dono, e as datas de
 * vínculo não são graváveis pela sessão (só o servidor as escreve).
 */
create or replace function public.stores_desconectada_desvincula()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.shopify_scopes is not null and new.shopify_scopes is null then
    update public.apps
       set ios_links_linked_at = null,
           android_links_linked_at = null,
           links_error = null
     where store_id = new.id
       and (ios_links_linked_at is not null
            or android_links_linked_at is not null
            or links_error is not null);
  end if;
  return new;
end;
$$;

revoke all on function public.stores_desconectada_desvincula() from public, anon, authenticated;

create trigger stores_desconectada_desvincula
  after update of shopify_scopes on public.stores
  for each row execute function public.stores_desconectada_desvincula();
