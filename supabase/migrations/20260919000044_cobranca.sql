-- Fase 7 — cobrança: planos (A09), assinatura e faturas (C15), limites e o
-- bloqueio suave.
--
-- O QUE A COBRANÇA LIBERA É UMA DATA, e não um status. `liberado_ate` é o
-- maior entre o fim do teste e o fim do período pago, mais 7 dias de
-- tolerância enquanto houver assinatura viva (o boleto leva dias para
-- compensar, e ninguém deve ser travado no dia em que pagou). Por ser
-- calculado das faturas, e não empilhado evento a evento, a regra não depende
-- da ordem em que a Asaas entrega os avisos, e um aviso repetido não muda nada.
--
-- BLOQUEIO SUAVE. Passada a data, o app da loja CONTINUA funcionando para os
-- clientes dela — config no ar, abas, automações. O que para é o que custa:
-- loja nova, campanha, publicar mudança no app e gerar versão nova para as
-- lojas de aplicativos. A trava mora aqui, em gatilhos, porque essas quatro
-- coisas têm mais de uma porta (tela, API com a sessão do lojista, reexecução
-- do admin), e a tela só explica.
--
-- PLANOS SEM SEED. Preço é decisão de negócio: nenhum plano nasce aqui. A
-- equipe cria os planos na A09; até lá o lojista vê que os planos ainda não
-- foram publicados, e o teste segue valendo.
--
-- ASAAS. A cobrança é pela Asaas (boleto, Pix e cartão, no Brasil). O enum do
-- provedor nasce só com ela: um provedor novo entra junto com o código que o
-- atende, e não antes.

-- ---------------------------------------------- 1. a empresa só muda o nome
--
-- FALHA CORRIGIDA: a policy "owner e admin editam a organização" liberava a
-- LINHA inteira, e com ela `status`, `trial_ends_at`, `plan` e `slug`. Um
-- administrador podia esticar o próprio teste para 2099 ou marcar a empresa
-- como "active" pela API, com a sessão do painel. Com a cobrança valendo, isso
-- seria assinar de graça. A policy continua; o que a pessoa pode escrever
-- passa a ser só a coluna do nome.
revoke update on public.organizations from anon, authenticated;
grant update (name) on public.organizations to authenticated;

-- `plan` era um texto solto ("trial") que ninguém mantinha. O plano agora é o
-- da assinatura, com preço e limites; duas fontes para a mesma resposta
-- acabam discordando.
alter table public.organizations drop column plan;

-- Empresa sem data de fim de teste não teria como ficar em dia. Nenhum
-- caminho do produto cria assim, mas uma linha antiga não pode travar sozinha.
update public.organizations
   set trial_ends_at = created_at + interval '14 days'
 where trial_ends_at is null;

alter table public.organizations alter column trial_ends_at set not null;

-- ------------------------------------------------------------ 2. planos (A09)

create table public.plans (
  id uuid primary key default extensions.gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 40),
  descricao text not null default '' check (char_length(descricao) <= 200),
  -- Mensal, em centavos. A Asaas não emite cobrança abaixo de R$ 5,00.
  preco_centavos integer not null check (preco_centavos between 500 and 10000000),
  -- Nulo é "sem limite".
  limite_lojas integer check (limite_lojas is null or limite_lojas between 1 and 1000),
  limite_aparelhos integer
    check (limite_aparelhos is null or limite_aparelhos between 1 and 100000000),
  limite_campanhas_mes integer
    check (limite_campanhas_mes is null or limite_campanhas_mes between 1 and 100000),
  -- Aparece para quem vai assinar. Desligar não mexe em quem já assina.
  disponivel boolean not null default true,
  -- Os limites deste plano valem durante o teste. No máximo um.
  vale_no_teste boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plans is
  'A09: planos e limites. Criados pela equipe; nenhum nasce por migration.';

create unique index plans_nome_unico on public.plans (lower(btrim(nome)));
create unique index plans_um_so_no_teste on public.plans (vale_no_teste) where vale_no_teste;

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;

-- Preço não é segredo, e quem assina precisa ver o plano mesmo depois de ele
-- sair da vitrine.
create policy "quem está logado lê os planos"
  on public.plans for select to authenticated
  using (true);

create policy "o superadmin cria planos"
  on public.plans for insert to authenticated
  with check (public.is_platform_superadmin());

create policy "o superadmin edita planos"
  on public.plans for update to authenticated
  using (public.is_platform_superadmin())
  with check (public.is_platform_superadmin());

create policy "o superadmin exclui planos"
  on public.plans for delete to authenticated
  using (public.is_platform_superadmin());

revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;
grant all on public.plans to service_role;

-- ------------------------------------------- 3. quem paga (dados de cobrança)

create type public.billing_provider as enum ('asaas');

-- O CPF ou CNPJ vai para a Asaas, que precisa dele para emitir a cobrança, e
-- NÃO fica aqui: guardamos só o tipo e os quatro últimos dígitos, para a tela
-- mostrar "CNPJ final 0190". Menos dado pessoal parado (LGPD, art. 6º, III).
create table public.billing_customers (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  provider public.billing_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 100),
  nome text not null check (char_length(btrim(nome)) between 2 and 120),
  documento_tipo text not null check (documento_tipo in ('cpf', 'cnpj')),
  documento_final text not null check (documento_final ~ '^[0-9A-Z]{4}$'),
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

comment on table public.billing_customers is
  'C15: quem paga a assinatura da empresa. O documento inteiro fica só na Asaas.';

create trigger billing_customers_set_updated_at
  before update on public.billing_customers
  for each row execute function public.set_updated_at();

alter table public.billing_customers enable row level security;

create policy "dono, administrador e equipe leem quem paga"
  on public.billing_customers for select to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[])
    or public.is_platform_admin()
  );

-- Escrita só pelo servidor, depois de a Asaas aceitar os dados.
revoke all on public.billing_customers from anon, authenticated;
grant select on public.billing_customers to authenticated;
grant all on public.billing_customers to service_role;

-- --------------------------------------------------------- 4. a assinatura

create type public.subscription_status as enum ('pending', 'active', 'past_due', 'canceled');

create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  provider public.billing_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 100),
  plan_id uuid not null references public.plans (id),
  -- O valor CONTRATADO: mudar o preço do plano vale para quem assinar depois.
  valor_centavos integer not null check (valor_centavos > 0),
  -- Calculados por `recalcular_cobranca`, a partir das faturas.
  status public.subscription_status not null default 'pending',
  pago_ate date,
  inadimplente_desde date,
  cancelada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

comment on table public.subscriptions is
  'C15: a assinatura da empresa na Asaas. Uma por empresa; cancelada, a próxima reaproveita a linha.';
comment on column public.subscriptions.pago_ate is
  'Último dia coberto pela fatura paga mais recente (vencimento + 1 mês - 1 dia).';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "a empresa e a equipe leem a assinatura"
  on public.subscriptions for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

-- ----------------------------------------------------------- 5. as faturas

create type public.invoice_status as enum ('pending', 'paid', 'overdue', 'refunded', 'canceled');

create table public.invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider public.billing_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 100),
  -- A assinatura de que a fatura é. Faturas de uma assinatura cancelada
  -- continuam aqui, como histórico.
  assinatura_externa text,
  valor_centavos integer not null check (valor_centavos >= 0),
  status public.invoice_status not null,
  vencimento date not null,
  paga_em date,
  -- A página da Asaas onde se paga (Pix, boleto ou cartão) ou se vê o recibo.
  link text check (link is null or link ~ '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

comment on table public.invoices is
  'C15: as faturas da assinatura, como a Asaas contou pelo webhook.';

create index invoices_org_idx on public.invoices (org_id, vencimento desc);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

-- Valor e link de pagamento: de quem responde pela empresa.
create policy "dono, administrador e equipe leem as faturas"
  on public.invoices for select to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.membership_role[])
    or public.is_platform_admin()
  );

revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
grant all on public.invoices to service_role;

-- ------------------------------------------------ 6. os avisos da Asaas

-- Um aviso só vale uma vez: a Asaas reenvia quando não recebe 200, e pode
-- reenviar o que já tinha chegado. A linha é gravada na MESMA transação que
-- aplica o aviso — se a aplicação falha, o registro some junto e o reenvio
-- aplica de novo.
create table public.billing_events (
  provider public.billing_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 100),
  tipo text not null check (char_length(tipo) between 1 and 80),
  org_id uuid references public.organizations (id) on delete set null,
  resultado text not null check (char_length(resultado) between 1 and 200),
  recebido_em timestamptz not null default now(),
  primary key (provider, external_id)
);

comment on table public.billing_events is
  'Avisos recebidos da Asaas, para não aplicar o mesmo duas vezes e para a equipe ver se chegam.';

create index billing_events_recebido_idx on public.billing_events (recebido_em desc);

alter table public.billing_events enable row level security;

create policy "a equipe lê os avisos da cobrança"
  on public.billing_events for select to authenticated
  using (public.is_platform_admin());

revoke all on public.billing_events from anon, authenticated;
grant select on public.billing_events to authenticated;
grant all on public.billing_events to service_role;

-- ------------------------------------------------ 7. o que está liberado

create or replace function public.hoje_em_brasilia()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.hoje_em_brasilia is
  'A data de hoje no horário de Brasília: é nela que o lojista lê "teste até" e "vence em".';

/*
 * A cobrança de uma empresa, sem conferir quem pergunta: é a base dos
 * gatilhos e da versão pública abaixo. Não é exposta.
 *
 * Os limites que valem: os do plano assinado enquanto a assinatura vive (ou
 * enquanto o período pago não acabou); fora disso, os do plano marcado para o
 * teste; sem nenhum, não há limite.
 */
create or replace function public.cobranca_da_org(p_org_id uuid)
returns table (
  em_dia boolean,
  liberado_ate date,
  teste_ate date,
  assinatura public.subscription_status,
  plano_id uuid,
  plano_nome text,
  valor_centavos integer,
  pago_ate date,
  inadimplente_desde date,
  cancelada_em timestamptz,
  limites_do_teste boolean,
  limite_lojas integer,
  limite_aparelhos integer,
  limite_campanhas_mes integer,
  -- O "hoje" que decidiu tudo acima, para a tela contar os dias com a mesma
  -- régua.
  hoje date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.hoje_em_brasilia();
  v_teste date;
  v_sub public.subscriptions%rowtype;
  v_base date;
  v_liberado date;
  v_vigente uuid;
  v_do_teste boolean := false;
  v_plano public.plans%rowtype;
  v_nome_assinado text;
begin
  select (o.trial_ends_at at time zone 'America/Sao_Paulo')::date
    into v_teste
    from public.organizations o
   where o.id = p_org_id;
  if not found then
    return;
  end if;

  select * into v_sub from public.subscriptions s where s.org_id = p_org_id;

  v_base := greatest(v_teste, v_sub.pago_ate);
  v_liberado := case
    when v_sub.org_id is not null and v_sub.status <> 'canceled' then v_base + 7
    else v_base
  end;

  if v_sub.org_id is not null
     and (v_sub.status <> 'canceled' or coalesce(v_sub.pago_ate >= v_hoje, false)) then
    v_vigente := v_sub.plan_id;
  else
    select p.id into v_vigente from public.plans p where p.vale_no_teste;
    v_do_teste := v_vigente is not null;
  end if;

  if v_vigente is not null then
    select * into v_plano from public.plans p where p.id = v_vigente;
  end if;
  if v_sub.org_id is not null then
    select p.nome into v_nome_assinado from public.plans p where p.id = v_sub.plan_id;
  end if;

  return query select
    v_liberado is not null and v_hoje <= v_liberado,
    v_liberado,
    v_teste,
    v_sub.status,
    v_sub.plan_id,
    v_nome_assinado,
    v_sub.valor_centavos,
    v_sub.pago_ate,
    v_sub.inadimplente_desde,
    v_sub.cancelada_em,
    v_do_teste,
    v_plano.limite_lojas,
    v_plano.limite_aparelhos,
    v_plano.limite_campanhas_mes,
    v_hoje;
end;
$$;

revoke all on function public.cobranca_da_org(uuid) from public, anon, authenticated;
grant execute on function public.cobranca_da_org(uuid) to service_role;

-- A mesma leitura, para a empresa e para a equipe.
create or replace function public.situacao_da_cobranca(p_org_id uuid)
returns table (
  em_dia boolean,
  liberado_ate date,
  teste_ate date,
  assinatura public.subscription_status,
  plano_id uuid,
  plano_nome text,
  valor_centavos integer,
  pago_ate date,
  inadimplente_desde date,
  cancelada_em timestamptz,
  limites_do_teste boolean,
  limite_lojas integer,
  limite_aparelhos integer,
  limite_campanhas_mes integer,
  -- O "hoje" que decidiu tudo acima, para a tela contar os dias com a mesma
  -- régua.
  hoje date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_org_member(p_org_id) or public.is_platform_admin()) then
    raise exception 'Empresa não encontrada.' using errcode = '42501';
  end if;
  return query select * from public.cobranca_da_org(p_org_id);
end;
$$;

revoke all on function public.situacao_da_cobranca(uuid) from public, anon;
grant execute on function public.situacao_da_cobranca(uuid) to authenticated, service_role;

create or replace function public.org_em_dia(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.em_dia from public.cobranca_da_org(p_org_id) c), false);
$$;

revoke all on function public.org_em_dia(uuid) from public, anon, authenticated;
grant execute on function public.org_em_dia(uuid) to service_role;

/*
 * Quanto a empresa usa, do jeito que os limites contam:
 *  - lojas cadastradas;
 *  - aparelhos distintos que abriram algum app dela nos últimos 30 dias — o
 *    MAU, a mesma conta da C11, e é por ele que a OneSignal cobra;
 *  - campanhas que saem neste mês (agendadas, saindo ou enviadas), no mês de
 *    Brasília. Automação não conta: ela é disparada pelo cliente da loja.
 */
create or replace function public.uso_da_org_interno(p_org_id uuid)
returns table (lojas integer, aparelhos_30d integer, campanhas_no_mes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.stores s where s.org_id = p_org_id)::integer,
    (select count(distinct dd.device_id)
       from public.device_days dd
       join public.apps a on a.id = dd.app_id
       join public.stores s on s.id = a.store_id
      where s.org_id = p_org_id
        and dd.day >= public.hoje_em_brasilia() - 29)::integer,
    (select count(*)
       from public.push_campaigns c
       join public.apps a on a.id = c.app_id
       join public.stores s on s.id = a.store_id
      where s.org_id = p_org_id
        and c.status in ('scheduled', 'sending', 'sent')
        and date_trunc('month', c.scheduled_at at time zone 'America/Sao_Paulo')
          = date_trunc('month', now() at time zone 'America/Sao_Paulo'))::integer;
$$;

revoke all on function public.uso_da_org_interno(uuid) from public, anon, authenticated;
grant execute on function public.uso_da_org_interno(uuid) to service_role;

create or replace function public.uso_da_org(p_org_id uuid)
returns table (lojas integer, aparelhos_30d integer, campanhas_no_mes integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_org_member(p_org_id) or public.is_platform_admin()) then
    raise exception 'Empresa não encontrada.' using errcode = '42501';
  end if;
  return query select * from public.uso_da_org_interno(p_org_id);
end;
$$;

revoke all on function public.uso_da_org(uuid) from public, anon;
grant execute on function public.uso_da_org(uuid) to authenticated, service_role;

-- Os aparelhos ativos de cada loja: o plano pede o MAU por app, que é como a
-- OneSignal cobra, e a C15 mostra quando a empresa tem mais de uma loja.
create or replace function public.aparelhos_por_loja(p_org_id uuid)
returns table (store_id uuid, nome text, aparelhos_30d integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_org_member(p_org_id) or public.is_platform_admin()) then
    raise exception 'Empresa não encontrada.' using errcode = '42501';
  end if;
  return query
  select s.id, s.name,
         (select count(distinct dd.device_id)
            from public.device_days dd
            join public.apps a on a.id = dd.app_id
           where a.store_id = s.id
             and dd.day >= public.hoje_em_brasilia() - 29)::integer
    from public.stores s
   where s.org_id = p_org_id
   order by s.created_at;
end;
$$;

revoke all on function public.aparelhos_por_loja(uuid) from public, anon;
grant execute on function public.aparelhos_por_loja(uuid) to authenticated, service_role;

-- A frase que o lojista lê quando o que ele tentou está travado.
create or replace function public.mensagem_de_bloqueio(p_org_id uuid, p_para text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions s where s.org_id = p_org_id;
  if v_sub.org_id is null then
    return format(
      'O período de teste acabou. Assine um plano em Configurações › Plano e cobrança para %s. O app continua funcionando para os seus clientes.',
      p_para);
  elsif v_sub.status = 'canceled' then
    return format(
      'A assinatura foi cancelada. Assine de novo em Configurações › Plano e cobrança para %s.',
      p_para);
  elsif v_sub.status = 'pending' then
    return format(
      'A primeira fatura ainda não foi paga. Pague em Configurações › Plano e cobrança para %s.',
      p_para);
  else
    return format(
      'Há uma fatura em atraso. Pague em Configurações › Plano e cobrança para %s.',
      p_para);
  end if;
end;
$$;

revoke all on function public.mensagem_de_bloqueio(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------- 8. as travas no que custa

-- Loja nova: empresa em dia e dentro do limite do plano.
create or replace function public.conferir_cobranca_da_loja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_lojas integer;
begin
  -- Duas abas criando loja ao mesmo tempo passariam juntas pelo limite. A
  -- trava na linha da empresa põe uma atrás da outra.
  perform 1 from public.organizations o where o.id = new.org_id for update;

  select * into v from public.cobranca_da_org(new.org_id);
  if not coalesce(v.em_dia, false) then
    raise exception '%', public.mensagem_de_bloqueio(new.org_id, 'cadastrar lojas')
      using errcode = 'P0001';
  end if;

  if v.limite_lojas is not null then
    select count(*) into v_lojas from public.stores s where s.org_id = new.org_id;
    if v_lojas >= v.limite_lojas then
      raise exception '%', format(
        '%s até %s %s. Troque de plano em Configurações › Plano e cobrança para cadastrar mais.',
        case when v.limites_do_teste then 'Durante o teste, dá para ter' else 'O seu plano permite' end,
        v.limite_lojas,
        case when v.limite_lojas = 1 then 'loja' else 'lojas' end
      ) using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.conferir_cobranca_da_loja() from public, anon, authenticated;

create trigger stores_cobranca
  before insert on public.stores
  for each row execute function public.conferir_cobranca_da_loja();

/*
 * Campanha que vai sair: empresa em dia e dentro das campanhas do mês.
 *
 * Só quando a campanha ENTRA na fila (nova agendada, rascunho ou cancelada
 * sendo agendada) ou muda de mês. `sending` voltando para `scheduled` é o job
 * devolvendo à fila o que ficou preso — não é o lojista agendando.
 */
create or replace function public.conferir_cobranca_da_campanha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v record;
  v_no_mes integer;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'sending' then
      return new;
    end if;
    if old.status = 'scheduled'
       and date_trunc('month', old.scheduled_at at time zone 'America/Sao_Paulo')
         = date_trunc('month', new.scheduled_at at time zone 'America/Sao_Paulo') then
      return new;
    end if;
  end if;

  select s.org_id into v_org
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = new.app_id;

  perform 1 from public.organizations o where o.id = v_org for update;

  select * into v from public.cobranca_da_org(v_org);
  if not coalesce(v.em_dia, false) then
    raise exception '%', public.mensagem_de_bloqueio(v_org, 'enviar campanhas')
      using errcode = 'P0001';
  end if;

  if v.limite_campanhas_mes is not null then
    select count(*) into v_no_mes
      from public.push_campaigns c
      join public.apps a on a.id = c.app_id
      join public.stores s on s.id = a.store_id
     where s.org_id = v_org
       and c.id <> new.id
       and c.status in ('scheduled', 'sending', 'sent')
       and date_trunc('month', c.scheduled_at at time zone 'America/Sao_Paulo')
         = date_trunc('month', new.scheduled_at at time zone 'America/Sao_Paulo');
    if v_no_mes >= v.limite_campanhas_mes then
      raise exception '%', format(
        '%s %s %s por mês, e o mês desta campanha já tem %s. Troque de plano em Configurações › Plano e cobrança, ou agende para o mês seguinte.',
        case when v.limites_do_teste then 'Durante o teste, dá para enviar' else 'O seu plano permite' end,
        v.limite_campanhas_mes,
        case when v.limite_campanhas_mes = 1 then 'campanha' else 'campanhas' end,
        v_no_mes
      ) using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.conferir_cobranca_da_campanha() from public, anon, authenticated;

create trigger push_campaigns_cobranca
  before insert or update of status, scheduled_at on public.push_campaigns
  for each row execute function public.conferir_cobranca_da_campanha();

-- Publicar mudança no app (`publicar_config`).
create or replace function public.conferir_cobranca_da_publicacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.status <> 'published' or old.status = 'published' then
    return new;
  end if;

  select s.org_id into v_org
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = new.app_id;

  if not public.org_em_dia(v_org) then
    raise exception '%', public.mensagem_de_bloqueio(v_org, 'publicar mudanças no app')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.conferir_cobranca_da_publicacao() from public, anon, authenticated;

create trigger app_configs_cobranca
  before update of status on public.app_configs
  for each row execute function public.conferir_cobranca_da_publicacao();

-- Versão nova para as lojas de aplicativos: é o que mais custa (minutos de
-- build na EAS). Vale também para a reexecução do admin: para ajudar um
-- cliente travado, a equipe estende o teste antes (A04).
create or replace function public.conferir_cobranca_do_build()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.status <> 'queued' then
    return new;
  end if;

  select s.org_id into v_org
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = new.app_id;

  if not public.org_em_dia(v_org) then
    raise exception '%', public.mensagem_de_bloqueio(v_org, 'gerar uma versão nova do app')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.conferir_cobranca_do_build() from public, anon, authenticated;

create trigger builds_cobranca
  before insert on public.builds
  for each row execute function public.conferir_cobranca_do_build();

-- Empresa com assinatura viva não some sem cancelar na Asaas antes: a
-- cobrança continuaria saindo no cartão de quem já foi embora. O servidor
-- cancela na Asaas antes de excluir a conta; isto é a rede, se algo pular.
create or replace function public.conferir_assinatura_antes_de_excluir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.subscriptions s
     where s.org_id = old.id and s.cancelada_em is null
  ) then
    raise exception 'Cancele a assinatura da empresa antes de excluí-la.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.conferir_assinatura_antes_de_excluir() from public, anon, authenticated;

create trigger organizations_assinatura_antes_de_excluir
  before delete on public.organizations
  for each row execute function public.conferir_assinatura_antes_de_excluir();

-- Campanha agendada quando a empresa estava em dia, e que vence com ela
-- travada, NÃO sai — e diz por quê. Sair dias depois, quando a fatura for
-- paga, mandaria uma promoção que já acabou.
create or replace function public.reservar_campanhas(p_limite integer default 20)
returns table (
  id uuid,
  app_id uuid,
  title text,
  body text,
  deep_link text,
  segment jsonb,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.push_campaigns c
     set status = 'failed',
         stats = coalesce(c.stats, '{}'::jsonb) || jsonb_build_object(
           'erro',
           'Não saiu: a assinatura da empresa não estava em dia na hora do envio. Veja em Configurações › Plano e cobrança.'
         )
    from public.apps a
    join public.stores s on s.id = a.store_id
   where a.id = c.app_id
     and c.status = 'scheduled'
     and c.scheduled_at is not null
     and c.scheduled_at <= now()
     and not public.org_em_dia(s.org_id);

  return query
  with reservadas as (
    update public.push_campaigns c
       set status = 'sending', updated_at = now()
     where c.id in (
       select c2.id
         from public.push_campaigns c2
        where c2.status = 'scheduled'
          and c2.scheduled_at is not null
          and c2.scheduled_at <= now()
        order by c2.scheduled_at
        limit greatest(coalesce(p_limite, 20), 1)
        -- Duas execuções do cron ao mesmo tempo: a segunda pula as linhas que
        -- a primeira já pegou, em vez de esperar por elas e mandar de novo.
        for update skip locked
     )
    returning c.id, c.app_id, c.title, c.body, c.deep_link, c.segment
  )
  select r.id, r.app_id, r.title, r.body, r.deep_link, r.segment,
         a.onesignal_app_id, a.onesignal_api_key_enc
    from reservadas r
    join public.apps a on a.id = r.app_id;
end;
$$;

-- ------------------------------------------- 9. escrever a cobrança (servidor)
--
-- Tudo pela service role, que o servidor só usa depois de a Asaas responder:
-- uma assinatura escrita pela API com a sessão do lojista seria uma
-- assinatura sem cobrança. Quem pediu vai como `p_ator`, para a trilha.

/*
 * Refaz a situação da assinatura e da empresa a partir das faturas.
 *
 *  - pago até: a fatura paga mais recente de QUALQUER assinatura da empresa
 *    (quem cancelou e voltou não perde o que já pagou);
 *  - em atraso desde: a fatura vencida mais antiga da assinatura atual;
 *  - a situação: cancelada > em atraso > ativa (pagou) > aguardando.
 *
 * O status da empresa acompanha, para a A02 e a A03 contarem; o que libera ou
 * trava é `cobranca_da_org`.
 */
create or replace function public.recalcular_cobranca(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_ultima_paga date;
  v_atraso date;
  v_pago date;
  v_status public.subscription_status;
  v_org_status public.org_status;
begin
  select * into v_sub from public.subscriptions s where s.org_id = p_org_id for update;
  if not found then
    update public.organizations set status = 'trialing'
     where id = p_org_id and status <> 'trialing';
    return;
  end if;

  select max(i.vencimento) into v_ultima_paga
    from public.invoices i
   where i.org_id = p_org_id and i.status = 'paid';

  select min(i.vencimento) into v_atraso
    from public.invoices i
   where i.org_id = p_org_id
     and i.assinatura_externa = v_sub.external_id
     and i.status = 'overdue';

  v_pago := case
    when v_ultima_paga is null then null
    else (v_ultima_paga + interval '1 month')::date - 1
  end;

  v_status := case
    when v_sub.cancelada_em is not null then 'canceled'
    when v_atraso is not null then 'past_due'
    when exists (
      select 1 from public.invoices i
       where i.org_id = p_org_id
         and i.assinatura_externa = v_sub.external_id
         and i.status = 'paid'
    ) then 'active'
    else 'pending'
  end::public.subscription_status;

  update public.subscriptions
     set status = v_status,
         pago_ate = v_pago,
         inadimplente_desde = case when v_status = 'past_due' then v_atraso else null end
   where org_id = p_org_id
     and (status, pago_ate, inadimplente_desde)
       is distinct from (v_status, v_pago, case when v_status = 'past_due' then v_atraso else null end);

  v_org_status := case v_status
    when 'active' then 'active'
    when 'past_due' then 'past_due'
    when 'canceled' then 'canceled'
    else 'trialing'
  end::public.org_status;

  update public.organizations set status = v_org_status
   where id = p_org_id and status <> v_org_status;
end;
$$;

revoke all on function public.recalcular_cobranca(uuid) from public, anon, authenticated;
grant execute on function public.recalcular_cobranca(uuid) to service_role;

-- Quem paga: gravado depois de a Asaas aceitar os dados.
create or replace function public.salvar_quem_paga(
  p_org_id uuid,
  p_provider public.billing_provider,
  p_cliente text,
  p_nome text,
  p_documento_tipo text,
  p_documento_final text,
  p_email text,
  p_ator uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.billing_customers%rowtype;
begin
  select * into v_antes from public.billing_customers b where b.org_id = p_org_id;

  insert into public.billing_customers
    (org_id, provider, external_id, nome, documento_tipo, documento_final, email)
  values
    (p_org_id, p_provider, p_cliente, btrim(p_nome), p_documento_tipo, p_documento_final,
     lower(btrim(p_email)))
  on conflict (org_id) do update
     set provider = excluded.provider,
         external_id = excluded.external_id,
         nome = excluded.nome,
         documento_tipo = excluded.documento_tipo,
         documento_final = excluded.documento_final,
         email = excluded.email;

  -- Na trilha, o que mudou — sem o documento, que nem inteiro fica aqui.
  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    p_ator,
    p_org_id,
    case when v_antes.org_id is null then 'create' else 'update' end::public.audit_action,
    'billing_customers',
    p_org_id,
    public.audit_diff(
      case when v_antes.org_id is null then null
           else jsonb_build_object('nome', v_antes.nome, 'email', v_antes.email,
                                   'documento', v_antes.documento_tipo) end,
      jsonb_build_object('nome', btrim(p_nome), 'email', lower(btrim(p_email)),
                         'documento', p_documento_tipo)
    )
  );
end;
$$;

revoke all on function public.salvar_quem_paga(uuid, public.billing_provider, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.salvar_quem_paga(uuid, public.billing_provider, text, text, text, text, text, uuid)
  to service_role;

-- Assinatura nova (ou de novo, depois de cancelada).
create or replace function public.registrar_assinatura(
  p_org_id uuid,
  p_provider public.billing_provider,
  p_assinatura text,
  p_plan_id uuid,
  p_valor_centavos integer,
  p_ator uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
begin
  select p.nome into v_nome from public.plans p where p.id = p_plan_id;
  if v_nome is null then
    raise exception 'Plano não encontrado.' using errcode = 'P0001';
  end if;

  insert into public.subscriptions (org_id, provider, external_id, plan_id, valor_centavos)
  values (p_org_id, p_provider, p_assinatura, p_plan_id, p_valor_centavos)
  on conflict (org_id) do update
     set provider = excluded.provider,
         external_id = excluded.external_id,
         plan_id = excluded.plan_id,
         valor_centavos = excluded.valor_centavos,
         status = 'pending',
         inadimplente_desde = null,
         cancelada_em = null
   where public.subscriptions.cancelada_em is not null;

  if not found then
    raise exception 'A empresa já tem uma assinatura. Para mudar, troque de plano.'
      using errcode = 'P0001';
  end if;

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (p_ator, p_org_id, 'create', 'subscriptions', p_org_id,
          jsonb_build_object(
            'plano', jsonb_build_object('de', null, 'para', v_nome),
            'valor_centavos', jsonb_build_object('de', null, 'para', p_valor_centavos)));

  perform public.recalcular_cobranca(p_org_id);
end;
$$;

revoke all on function public.registrar_assinatura(uuid, public.billing_provider, text, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_assinatura(uuid, public.billing_provider, text, uuid, integer, uuid)
  to service_role;

create or replace function public.trocar_plano_da_assinatura(
  p_org_id uuid,
  p_plan_id uuid,
  p_valor_centavos integer,
  p_ator uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_valor_antes integer;
  v_depois text;
begin
  select p.nome, s.valor_centavos into v_antes, v_valor_antes
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
   where s.org_id = p_org_id and s.cancelada_em is null
   for update of s;
  if v_antes is null then
    raise exception 'A empresa não tem assinatura ativa para trocar de plano.' using errcode = 'P0001';
  end if;

  select p.nome into v_depois from public.plans p where p.id = p_plan_id;
  if v_depois is null then
    raise exception 'Plano não encontrado.' using errcode = 'P0001';
  end if;

  update public.subscriptions
     set plan_id = p_plan_id, valor_centavos = p_valor_centavos
   where org_id = p_org_id;

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (p_ator, p_org_id, 'update', 'subscriptions', p_org_id,
          jsonb_build_object(
            'plano', jsonb_build_object('de', v_antes, 'para', v_depois),
            'valor_centavos', jsonb_build_object('de', v_valor_antes, 'para', p_valor_centavos)));
end;
$$;

revoke all on function public.trocar_plano_da_assinatura(uuid, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.trocar_plano_da_assinatura(uuid, uuid, integer, uuid)
  to service_role;

/*
 * Um aviso da Asaas, gravado uma vez só. Devolve false quando ele já tinha
 * chegado — quem chama para por aí.
 */
create or replace function public.anotar_aviso_de_cobranca(
  p_provider public.billing_provider,
  p_evento text,
  p_tipo text,
  p_org_id uuid,
  p_resultado text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_events (provider, external_id, tipo, org_id, resultado)
  values (p_provider, p_evento, p_tipo, p_org_id, p_resultado)
  on conflict do nothing;
  return found;
end;
$$;

revoke all on function public.anotar_aviso_de_cobranca(public.billing_provider, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.anotar_aviso_de_cobranca(public.billing_provider, text, text, uuid, text)
  to service_role;

/*
 * Uma fatura, como a Asaas contou. `p_evento` nulo é o próprio servidor
 * gravando a primeira fatura logo depois de assinar (sem esperar o aviso).
 *
 * Paga é final: um aviso atrasado de "vencida" ou "aguardando" não desfaz o
 * pagamento. Só estorno ou exclusão mudam uma fatura paga.
 *
 * Devolve: 'aplicado', 'repetido' (aviso que já tinha chegado) ou
 * 'desconhecida' (fatura de uma assinatura que não é nossa).
 */
create or replace function public.registrar_fatura(
  p_provider public.billing_provider,
  p_fatura text,
  p_assinatura text,
  p_valor_centavos integer,
  p_status public.invoice_status,
  p_vencimento date,
  -- Nulos quando é o servidor gravando a primeira fatura, sem aviso.
  p_evento text default null,
  p_tipo text default null,
  p_paga_em date default null,
  p_link text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- A empresa sai da assinatura — a atual, ou uma antiga de quem cancelou e
  -- voltou (as faturas dela guardam o id) — ou da própria fatura, já
  -- conhecida. Toda cobrança nossa nasce de uma assinatura; o resto da conta
  -- na Asaas não é da Storefy.
  select s.org_id into v_org
    from public.subscriptions s
   where s.provider = p_provider and s.external_id = p_assinatura;
  if v_org is null then
    select i.org_id into v_org
      from public.invoices i
     where i.provider = p_provider
       and (i.external_id = p_fatura or i.assinatura_externa = p_assinatura)
     limit 1;
  end if;

  if p_evento is not null then
    if not public.anotar_aviso_de_cobranca(
      p_provider, p_evento, p_tipo, v_org,
      case when v_org is null then 'ignorado: fatura de fora da Storefy' else 'aplicado' end
    ) then
      return 'repetido';
    end if;
  end if;

  if v_org is null then
    return 'desconhecida';
  end if;

  insert into public.invoices
    (org_id, provider, external_id, assinatura_externa, valor_centavos, status, vencimento,
     paga_em, link)
  values
    (v_org, p_provider, p_fatura, p_assinatura, greatest(p_valor_centavos, 0), p_status,
     p_vencimento, p_paga_em, nullif(btrim(coalesce(p_link, '')), ''))
  on conflict (provider, external_id) do update
     set assinatura_externa = coalesce(excluded.assinatura_externa, public.invoices.assinatura_externa),
         valor_centavos = excluded.valor_centavos,
         status = excluded.status,
         vencimento = excluded.vencimento,
         paga_em = excluded.paga_em,
         link = coalesce(excluded.link, public.invoices.link)
   where public.invoices.status <> 'paid'
      or excluded.status in ('paid', 'refunded', 'canceled');

  perform public.recalcular_cobranca(v_org);
  return 'aplicado';
end;
$$;

revoke all on function public.registrar_fatura(public.billing_provider, text, text, integer, public.invoice_status, date, text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.registrar_fatura(public.billing_provider, text, text, integer, public.invoice_status, date, text, text, date, text)
  to service_role;

/*
 * A assinatura acabou: cancelada pelo lojista (pelo servidor, depois da
 * Asaas) ou removida na Asaas (aviso). O que já foi pago continua valendo até
 * o fim do período.
 */
create or replace function public.encerrar_assinatura(
  p_provider public.billing_provider,
  p_assinatura text,
  -- O aviso da Asaas, quando veio dela; quem pediu, quando foi pelo painel.
  p_evento text default null,
  p_tipo text default null,
  p_ator uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.org_id into v_org
    from public.subscriptions s
   where s.provider = p_provider and s.external_id = p_assinatura;

  if p_evento is not null then
    if not public.anotar_aviso_de_cobranca(
      p_provider, p_evento, p_tipo, v_org,
      case when v_org is null then 'ignorado: assinatura de fora da Storefy' else 'aplicado' end
    ) then
      return 'repetido';
    end if;
  end if;

  if v_org is null then
    return 'desconhecida';
  end if;

  update public.subscriptions
     set cancelada_em = now()
   where org_id = v_org and cancelada_em is null;

  if found then
    insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
    values (p_ator, v_org, 'update', 'subscriptions', v_org,
            jsonb_build_object('cancelada', jsonb_build_object('de', false, 'para', true)));
  end if;

  perform public.recalcular_cobranca(v_org);
  return 'aplicado';
end;
$$;

revoke all on function public.encerrar_assinatura(public.billing_provider, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.encerrar_assinatura(public.billing_provider, text, text, text, uuid)
  to service_role;

-- --------------------------------------------- 10. a equipe estende o teste

/*
 * A04: dar mais prazo a um cliente (piloto, negociação, ajuda num build
 * travado). Só superadmin, até 90 dias à frente, e a trilha da empresa grava
 * o antes e o depois com quem fez — pelo gatilho de auditoria de
 * `organizations`, que vê o `auth.uid()` de quem chamou.
 */
create or replace function public.estender_teste(p_org_id uuid, p_ate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.hoje_em_brasilia();
begin
  if not public.is_platform_superadmin() then
    raise exception 'Só superadmin estende o teste de um cliente.' using errcode = '42501';
  end if;
  if p_ate is null or p_ate < v_hoje or p_ate > v_hoje + 90 then
    raise exception 'Escolha uma data entre hoje e daqui a 90 dias.' using errcode = 'P0001';
  end if;

  update public.organizations
     set trial_ends_at = (p_ate::timestamp + interval '23 hours 59 minutes 59 seconds')
                           at time zone 'America/Sao_Paulo'
   where id = p_org_id;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.estender_teste(uuid, date) from public, anon;
grant execute on function public.estender_teste(uuid, date) to authenticated;

-- ---------------------------------------------------------- 11. auditoria

-- Plano mudado é ação da plataforma: vai para a trilha sem empresa, como a
-- correção OTA.
create or replace function public.handle_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_entity_id uuid;
  v_action public.audit_action;
  v_old jsonb;
  v_new jsonb;
  v_linha record;
begin
  v_linha := coalesce(new, old);

  v_action := case tg_op
    when 'INSERT' then 'create'::public.audit_action
    when 'UPDATE' then 'update'::public.audit_action
    else 'delete'::public.audit_action
  end;

  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  case tg_table_name
    when 'organizations' then
      v_org_id := v_linha.id;
      v_entity_id := v_linha.id;
    when 'memberships' then
      v_org_id := v_linha.org_id;
      -- memberships tem chave composta; o alvo auditado é o usuário afetado.
      v_entity_id := v_linha.user_id;
    when 'stores' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'apps' then
      select s.org_id into v_org_id
      from public.stores s where s.id = v_linha.store_id;
      v_entity_id := v_linha.id;
    when 'app_configs' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'push_campaigns', 'push_automations' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'developer_accounts' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'builds' then
      select s.org_id into v_org_id
      from public.apps a
      join public.stores s on s.id = a.store_id
      where a.id = v_linha.app_id;
      v_entity_id := v_linha.id;
    when 'ota_updates' then
      -- Ação da PLATAFORMA: não há organização a quem atribuí-la.
      v_org_id := null;
      v_entity_id := v_linha.id;
    when 'invitations' then
      -- Nulo nos convites da plataforma (lojista piloto, equipe interna).
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
      v_old := v_old - 'token_hash';
      v_new := v_new - 'token_hash';
    when 'support_tickets' then
      v_org_id := v_linha.org_id;
      v_entity_id := v_linha.id;
    when 'plans' then
      -- Ação da PLATAFORMA, como a correção OTA.
      v_org_id := null;
      v_entity_id := v_linha.id;
    else
      -- Tabela nova ligada ao trigger sem tratar o org_id aqui: falhar alto é
      -- melhor do que gravar auditoria órfã, que ninguém consegue consultar.
      raise exception 'handle_audit: org_id não resolvido para a tabela %', tg_table_name;
  end case;

  insert into public.audit_logs (actor_id, org_id, action, entity, entity_id, diff)
  values (
    (select auth.uid()),
    v_org_id,
    v_action,
    tg_table_name,
    v_entity_id,
    public.audit_diff(v_old, v_new)
  );

  return v_linha;
end;
$$;

create trigger plans_audit
  after insert or update or delete on public.plans
  for each row execute function public.handle_audit();

-- ------------------------------------------------------------------- A02

/*
 * Empresas usando mais aparelhos do que o plano (ou o teste) permite. Conta
 * de toda a plataforma, então confere a equipe aqui dentro: o resumo abaixo é
 * `security invoker` e não alcançaria as funções internas.
 */
create or replace function public.orgs_acima_do_limite_de_aparelhos()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só o admin da plataforma lê o resumo.' using errcode = '42501';
  end if;
  return (
    select count(*)
      from public.organizations o
      cross join lateral public.cobranca_da_org(o.id) c
      cross join lateral public.uso_da_org_interno(o.id) u
     where c.limite_aparelhos is not null
       and u.aparelhos_30d > c.limite_aparelhos
  )::integer;
end;
$$;

revoke all on function public.orgs_acima_do_limite_de_aparelhos() from public, anon;
grant execute on function public.orgs_acima_do_limite_de_aparelhos() to authenticated, service_role;

-- A visão geral ganha o dinheiro (MRR das assinaturas em dia), os testes que
-- acabaram sem assinar nesta semana (a quem ligar) e as empresas acima do
-- limite de aparelhos do plano (o custo da OneSignal passando do preço).
drop function public.resumo_do_admin();

create or replace function public.resumo_do_admin()
returns table (
  orgs_ativas integer,
  orgs_em_trial integer,
  trials_vencendo_7d integer,
  orgs_inadimplentes integer,
  lojas_live integer,
  lojas_em_revisao integer,
  builds_na_fila integer,
  builds_com_erro_7d integer,
  builds_rejeitados_7d integer,
  contas_dev_com_erro integer,
  chamados_esperando integer,
  testes_encerrados_7d integer,
  acima_do_limite integer,
  mrr_centavos bigint,
  assinaturas_ativas integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só o admin da plataforma lê o resumo.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.organizations where status = 'active')::integer,
    -- Em teste de verdade: o teste que já acabou está em "testes encerrados".
    (select count(*) from public.organizations
      where status = 'trialing' and trial_ends_at >= now())::integer,
    /*
     * Trial JÁ VENCIDO não entra: ele não é mais um prazo a acompanhar, e tem
     * cartão próprio ("testes encerrados"). Misturar faria "vencendo" crescer
     * para sempre sem ninguém poder fazer nada a respeito — e um número que só
     * sobe deixa de ser lido.
     */
    (select count(*) from public.organizations
      where status = 'trialing'
        and trial_ends_at between now() and now() + interval '7 days')::integer,
    (select count(*) from public.organizations where status = 'past_due')::integer,
    (select count(*) from public.stores where status = 'live')::integer,
    (select count(*) from public.stores where status = 'in_review')::integer,
    (select count(*) from public.builds where status in ('queued', 'building'))::integer,
    (select count(*) from public.builds
      where status = 'errored' and created_at > now() - interval '7 days')::integer,
    /*
     * Rejeitado conta por `updated_at`, e não por `created_at`: o build pode
     * ter nascido há três semanas e ter sido rejeitado ontem. Por `created_at`
     * a rejeição de ontem sumiria da conta — justamente a que precisa de
     * alguém hoje.
     */
    (select count(*) from public.builds
      where status = 'rejected' and updated_at > now() - interval '7 days')::integer,
    (select count(*) from public.developer_accounts where status = 'error')::integer,
    -- Chamado com a última palavra do cliente: a vez é da equipe.
    (select count(*) from public.support_tickets where status = 'aberto')::integer,
    -- Acabou o teste nesta semana e não assinou: a janela de conversar. Uma
    -- janela, e não o acumulado — o acumulado só cresce e ninguém lê.
    (select count(*) from public.organizations o
      where o.status = 'trialing'
        and o.trial_ends_at between now() - interval '7 days' and now()
        and not exists (select 1 from public.subscriptions s where s.org_id = o.id))::integer,
    public.orgs_acima_do_limite_de_aparelhos(),
    (select coalesce(sum(s.valor_centavos), 0) from public.subscriptions s
      where s.status = 'active')::bigint,
    (select count(*) from public.subscriptions s where s.status = 'active')::integer;
end
$$;

comment on function public.resumo_do_admin is
  'Os números da A02. Só platform_admin; a RLS continua sendo a fronteira.';

revoke all on function public.resumo_do_admin() from public, anon;
grant execute on function public.resumo_do_admin() to authenticated;
