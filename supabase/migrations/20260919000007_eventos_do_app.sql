-- O que o app escreve, e como (seção 6 do plano).
--
-- Duas funções concentram tudo que chega dos endpoints públicos. Estão no
-- banco, e não no servidor web, por dois motivos:
--
--   registrar um evento de carrinho DISPARA a automação de abandono, e as duas
--   coisas precisam acontecer juntas — um carrinho gravado sem o agendamento
--   vira um push que nunca sai, e um agendamento sem o evento vira um push sem
--   motivo;
--
--   o limite de requisições é conferido na mesma ida ao banco. Fosse uma
--   chamada separada, seriam duas viagens por evento, e um app movimentado faz
--   milhares por minuto.

-- Fuso da loja: a janela de silêncio do push é no horário DELA, não no nosso.
alter table public.stores
  add column if not exists timezone text not null default 'America/Sao_Paulo';

comment on column public.stores.timezone is
  'Fuso para a janela de silêncio do push. O lojista ajusta; o padrão atende o Brasil.';

-- `stores` tem grant coluna a coluna (migration 5), e o Postgres NÃO estende o
-- grant para colunas criadas depois. Sem esta linha o painel simplesmente não
-- enxergaria o fuso que ele mesmo precisa editar — e sem erro nenhum, porque o
-- PostgREST só devolveria a coluna faltando.
grant select (timezone) on public.stores to authenticated;

-- Segredo com que o app assina as requisições. Único por app e revogável.
alter table public.apps
  add column if not exists device_secret_enc text;

comment on column public.apps.device_secret_enc is
  'Segredo HMAC do app, criptografado. Viaja no binário: o que ele garante é que um vazamento fica contido numa loja.';

-- ------------------------------------------------------- limite de uso

create table public.rate_limits (
  chave text primary key,
  janela timestamptz not null,
  contagem integer not null default 0
);

comment on table public.rate_limits is
  'Contador por chave e janela de tempo, para os endpoints públicos.';

-- A tabela não cresce: a chave é fixa por app (`aparelhos:<id>`, `eventos:<id>`)
-- e a linha é reaproveitada a cada janela. Por isso não há índice de limpeza.
--
-- RLS ligada e nenhuma policy: no PostgREST toda tabela de `public` é uma rota,
-- e esta não é do painel nem do app. O caminho é a service role, que ignora RLS.
-- Sem isto, qualquer visitante leria quantas requisições cada app faz por minuto.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

/**
 * Consome uma unidade do limite. Devolve `true` quando ainda cabe.
 *
 * A janela é fixa e não deslizante: a conta é de quantas chamadas houve NESTE
 * minuto, e não nos últimos sessenta segundos. Uma janela deslizante exigiria
 * guardar cada chamada, e o custo disso é maior do que o problema que resolve
 * — na virada do minuto, o pior caso é o dobro do limite.
 */
create or replace function public.consumir_limite(
  p_chave text,
  p_maximo integer,
  p_janela_segundos integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_janela timestamptz;
  v_contagem integer;
begin
  v_janela := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_janela_segundos) * p_janela_segundos
  );

  insert into public.rate_limits (chave, janela, contagem)
  values (p_chave, v_janela, 1)
  on conflict (chave) do update
    set contagem = case
          when public.rate_limits.janela = excluded.janela
            then public.rate_limits.contagem + 1
          else 1
        end,
        janela = excluded.janela
  returning contagem into v_contagem;

  return v_contagem <= p_maximo;
end;
$$;

comment on function public.consumir_limite is
  'Conta chamadas por chave numa janela fixa. False quando o limite estourou.';

-- -------------------------------------------------- janela de silêncio

/**
 * Empurra um horário para fora da madrugada, no fuso da loja.
 *
 * Push às três da manhã acorda o cliente e rende desinstalação, que é o
 * prejuízo mais caro que uma notificação pode causar. Entre 22h e 8h o envio
 * espera até as 8h daquele fuso.
 */
create or replace function public.fora_do_silencio(p_quando timestamptz, p_fuso text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp;
  v_hora integer;
begin
  begin
    v_local := p_quando at time zone p_fuso;
  exception when invalid_parameter_value then
    -- Fuso inválido no cadastro não pode impedir o push de existir.
    return p_quando;
  end;

  v_hora := extract(hour from v_local)::integer;
  if v_hora >= 8 and v_hora < 22 then
    return p_quando;
  end if;

  -- Antes das 8h é hoje mesmo; das 22h em diante é amanhã.
  if v_hora < 8 then
    return (date_trunc('day', v_local) + interval '8 hours') at time zone p_fuso;
  end if;
  return (date_trunc('day', v_local) + interval '1 day 8 hours') at time zone p_fuso;
end;
$$;

comment on function public.fora_do_silencio is
  'Adia um horário que caia entre 22h e 8h do fuso informado para as 8h.';

-- --------------------------------------------------- registrar aparelho

/**
 * Registra ou atualiza o aparelho que abriu o app.
 *
 * O mesmo aparelho reabrindo não cria linha nova — é o que o índice único
 * (app_id, onesignal_subscription_id) garante, e o que faz a contagem de
 * instalações significar alguma coisa.
 */
create or replace function public.registrar_aparelho(
  p_app_id uuid,
  p_subscription text,
  p_platform public.device_platform,
  p_app_version text default null,
  p_external_id text default null,
  p_email_hash text default null
)
returns table (device_id uuid, limitado boolean, novo boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_novo boolean;
  v_cabe boolean;
begin
  -- 600 por minuto por app: um app com muitos usuários abrindo ao mesmo tempo
  -- passa; um laço tentando inflar a contagem de instalações, não.
  v_cabe := public.consumir_limite('aparelhos:' || p_app_id::text, 600);
  if not v_cabe then
    return query select null::uuid, true, false;
    return;
  end if;

  insert into public.devices (
    app_id, onesignal_subscription_id, platform, app_version, external_id,
    customer_email_hash, last_seen_at
  )
  values (
    p_app_id, p_subscription, p_platform, p_app_version, p_external_id,
    p_email_hash, now()
  )
  on conflict (app_id, onesignal_subscription_id) do update
    set app_version = coalesce(excluded.app_version, public.devices.app_version),
        -- O cliente pode sair da conta: `external_id` nulo não apaga o que
        -- havia, mas um valor novo substitui.
        external_id = coalesce(excluded.external_id, public.devices.external_id),
        customer_email_hash = coalesce(
          excluded.customer_email_hash, public.devices.customer_email_hash
        ),
        last_seen_at = now()
  returning id, (xmax = 0) into v_id, v_novo;

  return query select v_id, false, v_novo;
end;
$$;

comment on function public.registrar_aparelho is
  'Upsert do aparelho pelo id de inscrição do OneSignal, com limite por app.';

-- ------------------------------------------- registrar evento de carrinho

/**
 * Grava um evento de carrinho e mexe na automação de abandono.
 *
 * As duas coisas juntas de propósito: carrinho gravado sem agendamento vira
 * push que nunca sai, e agendamento sem evento vira push sem motivo.
 *
 * O teto de um push de carrinho a cada 24 horas por aparelho é conferido AQUI
 * e de novo no envio. Aqui, para não encher a fila de agendamento que seria
 * descartado; no envio, porque entre agendar e enviar passa uma hora, e nesse
 * meio-tempo outro envio pode ter acontecido.
 */
create or replace function public.registrar_evento_de_carrinho(
  p_app_id uuid,
  p_subscription text,
  p_event public.cart_event_type,
  p_item_count integer,
  p_cart_token text default null,
  p_value_cents integer default null,
  p_currency text default null
)
returns table (event_id uuid, limitado boolean, agendou boolean, cancelou integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_device uuid;
  v_evento uuid;
  v_automacao public.push_automations%rowtype;
  v_fuso text;
  v_quando timestamptz;
  v_agendou boolean := false;
  v_cancelou integer := 0;
  v_ja_recebeu boolean;
begin
  if not public.consumir_limite('eventos:' || p_app_id::text, 3000) then
    return query select null::uuid, true, false, 0;
    return;
  end if;

  select id into v_device
    from public.devices
   where app_id = p_app_id and onesignal_subscription_id = p_subscription;

  insert into public.cart_events (
    app_id, device_id, cart_token, item_count, value_cents, currency, event
  )
  values (p_app_id, v_device, p_cart_token, p_item_count, p_value_cents, p_currency, p_event)
  returning id into v_evento;

  -- Sem aparelho conhecido não há para quem mandar push; o evento fica
  -- gravado mesmo assim, porque ele ainda conta para a análise.
  if v_device is null then
    return query select v_evento, false, false, 0;
    return;
  end if;

  select * into v_automacao
    from public.push_automations
   where app_id = p_app_id and type = 'abandoned_cart' and enabled;

  -- Compra cancela o que estava agendado, mesmo com a automação desligada:
  -- ela pode ter sido desligada no meio do caminho.
  --
  -- Cancela TODOS os agendamentos do aparelho, não só os do carrinho que
  -- converteu. A Shopify troca o token do carrinho no checkout, então casar por
  -- token deixaria passar justamente o agendamento que virou venda — e
  -- "você esqueceu algo no carrinho" logo depois da compra é o pior push que
  -- existe. Se a pessoa montar outro carrinho, o evento seguinte reagenda.
  if p_event = 'purchased' then
    update public.automation_runs r
       set status = 'canceled', canceled_reason = 'compra concluída'
     where r.device_id = v_device
       and r.status = 'scheduled'
       and exists (
         select 1 from public.push_automations a
          where a.id = r.automation_id and a.type = 'abandoned_cart'
       );
    get diagnostics v_cancelou = row_count;
    return query select v_evento, false, false, v_cancelou;
    return;
  end if;

  -- Carrinho esvaziado não é abandono.
  if p_item_count <= 0 then
    update public.automation_runs r
       set status = 'canceled', canceled_reason = 'carrinho esvaziado'
     where r.device_id = v_device
       and r.status = 'scheduled'
       and exists (
         select 1 from public.push_automations a
          where a.id = r.automation_id and a.type = 'abandoned_cart'
       );
    get diagnostics v_cancelou = row_count;
    return query select v_evento, false, false, v_cancelou;
    return;
  end if;

  if v_automacao.id is null then
    return query select v_evento, false, false, 0;
    return;
  end if;

  select exists (
    select 1 from public.automation_runs r
     where r.automation_id = v_automacao.id
       and r.device_id = v_device
       and r.status = 'sent'
       and r.sent_at > now() - interval '24 hours'
  ) into v_ja_recebeu;

  if v_ja_recebeu then
    return query select v_evento, false, false, 0;
    return;
  end if;

  select s.timezone into v_fuso
    from public.apps a join public.stores s on s.id = a.store_id
   where a.id = p_app_id;

  v_quando := public.fora_do_silencio(
    now() + make_interval(mins => v_automacao.delay_minutes),
    coalesce(v_fuso, 'America/Sao_Paulo')
  );

  -- Mexer no carrinho de novo REAGENDA em vez de criar outro run: cada toque
  -- viraria um push, e o cliente receberia cinco por um carrinho só.
  update public.automation_runs
     set scheduled_for = v_quando,
         trigger_ref = coalesce(p_cart_token, trigger_ref)
   where automation_id = v_automacao.id
     and device_id = v_device
     and status = 'scheduled';

  if not found then
    insert into public.automation_runs (automation_id, device_id, trigger_ref, scheduled_for)
    values (v_automacao.id, v_device, p_cart_token, v_quando);
  end if;

  v_agendou := true;
  return query select v_evento, false, v_agendou, 0;
end;
$$;

comment on function public.registrar_evento_de_carrinho is
  'Grava o evento e agenda, reagenda ou cancela o push de carrinho abandonado.';

-- Estas funções são o caminho dos endpoints públicos, que usam a service role.
-- O grant é explícito porque o `revoke ... from public` tira o padrão do
-- Postgres, e depender do default privilege do Supabase deixaria a permissão
-- diferente aqui e no banco local — o tipo de diferença que só aparece em
-- produção.
revoke execute on function public.consumir_limite(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consumir_limite(text, integer, integer) to service_role;

-- `fora_do_silencio` não toca em dado nenhum, mas no PostgREST toda função de
-- `public` vira uma rota POST. Rota que ninguém usa é superfície de ataque de
-- graça, e o dia em que a função passar a ler o fuso da loja sozinha, o fecho
-- já estará feito.
revoke execute on function public.fora_do_silencio(timestamptz, text) from public, anon, authenticated;
grant execute on function public.fora_do_silencio(timestamptz, text) to service_role;

revoke execute on function public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_aparelho(uuid, text, public.device_platform, text, text, text)
  to service_role;

revoke execute on function public.registrar_evento_de_carrinho(uuid, text, public.cart_event_type, integer, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.registrar_evento_de_carrinho(uuid, text, public.cart_event_type, integer, text, integer, text)
  to service_role;
