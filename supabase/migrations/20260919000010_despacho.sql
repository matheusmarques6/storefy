-- O despacho do push (seção 6 do plano).
--
-- O Vercel Cron chama `/api/jobs/dispatch-push` a cada minuto. O risco desse
-- desenho é UM SÓ, e é grave: duas execuções sobrepostas mandando a mesma
-- campanha duas vezes. Um push duplicado para a base inteira de uma loja não
-- tem desfazer — e é o tipo de erro que faz desinstalar o app.
--
-- Por isso a reserva é feita aqui, num `update ... returning` com a condição
-- de status embutida. O Postgres garante que só uma transação vê cada linha
-- como `scheduled`; a segunda não encontra nada e não tem o que enviar. Ler
-- primeiro e marcar depois, do lado do servidor web, deixaria exatamente a
-- janela entre as duas coisas.

-- ------------------------------------------------------- campanhas

/**
 * Reserva as campanhas vencidas e devolve o que o job precisa para enviá-las.
 *
 * O `onesignal_api_key_enc` sai criptografado: quem sabe abrir é o servidor
 * web, com a `ENCRYPTION_KEY`, e o banco nunca precisa conhecer a chave.
 */
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

comment on function public.reservar_campanhas is
  'Marca as campanhas vencidas como enviando e devolve os dados do envio.';

/** A campanha saiu. `p_stats` é o que a OneSignal respondeu na hora. */
create or replace function public.concluir_campanha(
  p_id uuid,
  p_notification_id text,
  p_stats jsonb default '{}'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.push_campaigns
     set status = 'sent',
         sent_at = now(),
         onesignal_notification_id = p_notification_id,
         stats = coalesce(p_stats, '{}'::jsonb)
   where id = p_id and status = 'sending';
$$;

/**
 * A campanha não saiu.
 *
 * O motivo fica gravado em `stats` porque é o que a tela C10 mostra ao
 * lojista. "Falhou" sem motivo transforma um problema de configuração em um
 * chamado de suporte.
 */
create or replace function public.falhar_campanha(p_id uuid, p_motivo text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.push_campaigns
     set status = 'failed',
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object('erro', p_motivo)
   where id = p_id and status = 'sending';
$$;

/**
 * Devolve à fila uma campanha reservada que o job não conseguiu processar.
 *
 * Existe para a falha do PRÓPRIO job — o processo morreu, o deploy derrubou o
 * container. Sem isto a campanha ficaria em `sending` para sempre, que é o
 * estado de onde nada sai e ninguém repara.
 */
create or replace function public.devolver_campanhas_presas(p_minutos integer default 15)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update public.push_campaigns
     set status = 'scheduled'
   where status = 'sending'
     and updated_at < now() - make_interval(mins => greatest(coalesce(p_minutos, 15), 2));
  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

comment on function public.devolver_campanhas_presas is
  'Recoloca na fila a campanha que ficou em "enviando" por queda do job.';

-- ------------------------------------------------------- automações

/*
 * A reserva de um envio de automação é uma COLUNA, e não um status.
 *
 * `automation_run_status` só tem desfechos — agendado, enviado, cancelado,
 * falhou — e é bom que continue assim: "enviando" não é um desfecho, é um
 * detalhe de quem está processando. Marcar a reserva em `claimed_at` deixa o
 * status significando o que significa, e ainda torna o destravamento trivial
 * (basta limpar a coluna).
 */
alter table public.automation_runs
  add column if not exists claimed_at timestamptz;

comment on column public.automation_runs.claimed_at is
  'Quando o job pegou este envio. Limpar devolve à fila.';

/**
 * Reserva os envios de automação vencidos.
 *
 * Duas regras são reconferidas AQUI, e não só no agendamento:
 *
 *   a janela de silêncio. Entre agendar e enviar passa pelo menos uma hora, e
 *   um job atrasado por queda acordaria o cliente às três da manhã com uma
 *   mensagem de carrinho — o envio é reagendado para as 8h em vez de sair;
 *
 *   o teto de um push de carrinho a cada 24 horas por aparelho. Entre agendar
 *   e enviar, outro envio pode ter acontecido; sem reconferir, o cliente
 *   receberia dois.
 */
create or replace function public.reservar_envios_de_automacao(p_limite integer default 100)
returns table (
  id uuid,
  automation_id uuid,
  app_id uuid,
  subscription_id text,
  title text,
  body text,
  deep_link text,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Fora do silêncio antes de reservar: quem cair na madrugada é adiado e nem
  -- entra na leva deste minuto.
  update public.automation_runs r
     set scheduled_for = public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo'))
    from public.push_automations pa
    join public.apps a on a.id = pa.app_id
    join public.stores s on s.id = a.store_id
   where r.automation_id = pa.id
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and public.fora_do_silencio(now(), coalesce(s.timezone, 'America/Sao_Paulo')) > now();

  -- Carrinho abandonado para quem já recebeu um nas últimas 24 horas: cancela
  -- em vez de enviar. O cliente não precisa de dois lembretes por dia.
  update public.automation_runs r
     set status = 'canceled', canceled_reason = 'já recebeu um push de carrinho hoje'
    from public.push_automations pa
   where r.automation_id = pa.id
     and pa.type = 'abandoned_cart'
     and r.status = 'scheduled'
     and r.scheduled_for <= now()
     and exists (
       select 1 from public.automation_runs outro
        where outro.device_id = r.device_id
          and outro.automation_id = r.automation_id
          and outro.status = 'sent'
          and outro.sent_at > now() - interval '24 hours'
     );

  return query
  with reservados as (
    update public.automation_runs r
       set claimed_at = now()
     where r.id in (
       select r2.id
         from public.automation_runs r2
         join public.push_automations pa on pa.id = r2.automation_id
        where r2.status = 'scheduled'
          and r2.claimed_at is null
          and r2.scheduled_for <= now()
          -- Automação desligada no meio do caminho não dispara o que ficou.
          and pa.enabled
        order by r2.scheduled_for
        limit greatest(coalesce(p_limite, 100), 1)
        for update skip locked
     )
    returning r.id, r.automation_id, r.device_id
  )
  select res.id, res.automation_id, pa.app_id, d.onesignal_subscription_id,
         pa.title, pa.body, pa.deep_link, a.onesignal_app_id, a.onesignal_api_key_enc
    from reservados res
    join public.push_automations pa on pa.id = res.automation_id
    join public.devices d on d.id = res.device_id
    join public.apps a on a.id = pa.app_id;
end;
$$;

comment on function public.reservar_envios_de_automacao is
  'Reserva os envios vencidos, adiando os da madrugada e cancelando os repetidos.';

create or replace function public.concluir_envio(p_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.automation_runs
     set status = 'sent', sent_at = now()
   where id = p_id and status = 'scheduled' and claimed_at is not null;
$$;

create or replace function public.falhar_envio(p_id uuid, p_motivo text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.automation_runs
     set status = 'failed', canceled_reason = p_motivo
   where id = p_id and status = 'scheduled' and claimed_at is not null;
$$;

/** O mesmo destravamento das campanhas, para os envios de automação. */
create or replace function public.devolver_envios_presos(p_minutos integer default 15)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_linhas integer;
begin
  update public.automation_runs
     set claimed_at = null
   where status = 'scheduled'
     and claimed_at is not null
     and claimed_at < now() - make_interval(mins => greatest(coalesce(p_minutos, 15), 2));
  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

-- ------------------------------------------------------- estatísticas

/** Campanhas enviadas que ainda valem a pena reconsultar na OneSignal. */
create or replace function public.campanhas_para_estatistica(p_limite integer default 50)
returns table (
  id uuid,
  app_id uuid,
  onesignal_notification_id text,
  onesignal_app_id text,
  onesignal_api_key_enc text
)
language sql
security invoker
set search_path = ''
as $$
  select c.id, c.app_id, c.onesignal_notification_id,
         a.onesignal_app_id, a.onesignal_api_key_enc
    from public.push_campaigns c
    join public.apps a on a.id = c.app_id
   where c.status = 'sent'
     and c.onesignal_notification_id is not null
     -- Depois de 48 horas os números param de mexer; continuar consultando
     -- gastaria a cota da API da loja sem mudar nada na tela.
     and c.sent_at > now() - interval '48 hours'
   order by c.sent_at desc
   limit least(greatest(coalesce(p_limite, 50), 1), 200);
$$;

create or replace function public.gravar_estatistica(p_id uuid, p_stats jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.push_campaigns
     set stats = coalesce(stats, '{}'::jsonb) || coalesce(p_stats, '{}'::jsonb)
   where id = p_id;
$$;

-- Todas são caminho de job, com a service role. Nenhuma é rota do PostgREST.
do $$
declare
  v_assinatura text;
begin
  foreach v_assinatura in array array[
    'public.reservar_campanhas(integer)',
    'public.concluir_campanha(uuid, text, jsonb)',
    'public.falhar_campanha(uuid, text)',
    'public.devolver_campanhas_presas(integer)',
    'public.reservar_envios_de_automacao(integer)',
    'public.concluir_envio(uuid)',
    'public.falhar_envio(uuid, text)',
    'public.devolver_envios_presos(integer)',
    'public.campanhas_para_estatistica(integer)',
    'public.gravar_estatistica(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_assinatura);
    execute format('grant execute on function %s to service_role', v_assinatura);
  end loop;
end
$$;
