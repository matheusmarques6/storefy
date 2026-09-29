-- A03: a lista de clientes com filtros (plano, situação, etapa do começo) e a
-- saúde de cada um.
--
-- A lista existia com busca e paginação; faltava o que o plano pede para a
-- equipe ANDAR pela base: achar os clientes de um plano, os que estão em
-- atraso, os que pararam no meio do começo — e, na mesma linha, se o cliente
-- está bem ou precisa de alguém.
--
-- É uma função, e não consultas soltas na tela, porque filtro e paginação
-- precisam ver a MESMA coisa: a etapa e a saúde são calculadas, e filtrar por
-- elas depois de paginar mostraria páginas meio vazias e um total errado.

/*
 * A etapa do começo, pela loja mais adiantada da empresa:
 *   sem_loja   — nenhuma loja;
 *   montando   — tem loja, e nenhum app publicado no painel;
 *   publicado  — o app foi publicado no painel, e nada foi às lojas;
 *   enviado    — algum build foi às lojas (construindo, em revisão ou recusado);
 *   no_ar      — alguma loja está no ar (ou pausada depois de estar).
 *
 * A saúde junta os motivos que pedem alguém da equipe, do mais grave para o
 * menos. Crítica: cobrança em atraso, teste que acabou sem assinatura.
 * Atenção: app recusado na revisão, build com erro nos últimos 7 dias, conta
 * de desenvolvedor com erro, aparelhos acima do plano, ninguém mexe no painel
 * há 30 dias.
 */
create or replace function public.admin_organizacoes(
  p_busca text default null,
  p_situacao public.org_status default null,
  p_plano text default null,
  p_etapa text default null,
  p_saude text default null,
  p_limite integer default 25,
  p_deslocamento integer default 0
)
returns table (
  id uuid,
  nome text,
  identificador text,
  situacao public.org_status,
  teste_ate timestamptz,
  criada_em timestamptz,
  plano_id uuid,
  plano text,
  assinatura_cancelada boolean,
  lojas integer,
  etapa text,
  saude text,
  motivos text[],
  ultima_atividade timestamptz,
  total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo text;
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  -- O termo vira padrão de ILIKE literal: `%` e `_` digitados não são curinga.
  v_termo := nullif(btrim(coalesce(p_busca, '')), '');
  if v_termo is not null then
    v_termo := '%' || replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  with base as (
    select o.id, o.name, o.slug, o.status, o.trial_ends_at, o.created_at
      from public.organizations o
     where (v_termo is null or o.name ilike v_termo or o.slug ilike v_termo)
       and (p_situacao is null or o.status = p_situacao)
  ),
  assinatura as (
    select distinct on (s.org_id)
           s.org_id, s.plan_id, pl.nome, s.cancelada_em
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
     where s.org_id in (select b.id from base b)
     order by s.org_id, s.created_at desc
  ),
  etapas as (
    select b.id as org_id,
           count(distinct st.id)::integer as lojas,
           coalesce(max(
             case
               when st.status in ('live', 'paused') then 4
               when st.status in ('building', 'in_review', 'rejected') then 3
               when a.current_config_version is not null then 2
               when st.id is not null then 1
             end
           ), 0) as nivel,
           bool_or(st.status = 'rejected') as recusada
      from base b
      left join public.stores st on st.org_id = b.id
      left join public.apps a on a.store_id = st.id
     group by b.id
  ),
  sinais as (
    select b.id as org_id,
           (b.status = 'past_due') as em_atraso,
           (b.status = 'trialing' and b.trial_ends_at < now()
              and not exists (select 1 from public.subscriptions s where s.org_id = b.id))
             as teste_acabou,
           exists (
             select 1
               from public.builds bu
               join public.apps a on a.id = bu.app_id
               join public.stores st on st.id = a.store_id
              where st.org_id = b.id
                and bu.status = 'errored'
                and bu.updated_at > now() - interval '7 days'
           ) as build_com_erro,
           exists (
             select 1 from public.developer_accounts d
              where d.org_id = b.id and d.status = 'error'
           ) as conta_com_erro,
           coalesce((
             select c.limite_aparelhos is not null and u.aparelhos_30d > c.limite_aparelhos
               from public.cobranca_da_org(b.id) c
               cross join public.uso_da_org_interno(b.id) u
           ), false) as acima_do_limite,
           -- A última mudança feita por alguém da EMPRESA: a equipe da
           -- plataforma mexendo na conta não conta como cliente ativo.
           (select max(l.created_at)
              from public.audit_logs l
             where l.org_id = b.id
               and (l.actor_id is null
                    or not exists (select 1 from public.platform_admins pa
                                    where pa.user_id = l.actor_id))) as ultima,
           b.created_at
      from base b
  ),
  linhas as (
    select b.id, b.name, b.slug, b.status, b.trial_ends_at, b.created_at,
           ass.plan_id, ass.nome as plano, (ass.cancelada_em is not null) as cancelada,
           e.lojas,
           case e.nivel
             when 0 then 'sem_loja'
             when 1 then 'montando'
             when 2 then 'publicado'
             when 3 then 'enviado'
             else 'no_ar'
           end as etapa,
           array_remove(array[
             case when si.em_atraso then 'cobranca_em_atraso' end,
             case when si.teste_acabou then 'teste_acabou' end,
             case when e.recusada then 'revisao_recusada' end,
             case when si.build_com_erro then 'build_com_erro' end,
             case when si.conta_com_erro then 'conta_com_erro' end,
             case when si.acima_do_limite then 'acima_do_limite' end,
             case when si.created_at < now() - interval '30 days'
                   and coalesce(si.ultima, si.created_at) < now() - interval '30 days'
                  then 'sem_atividade' end
           ], null) as motivos,
           si.ultima
      from base b
      join etapas e on e.org_id = b.id
      join sinais si on si.org_id = b.id
      left join assinatura ass on ass.org_id = b.id
  ),
  classificadas as (
    select l.*,
           case
             when l.motivos && array['cobranca_em_atraso', 'teste_acabou'] then 'critica'
             when cardinality(l.motivos) > 0 then 'atencao'
             else 'boa'
           end as saude
      from linhas l
  ),
  filtradas as (
    select c.*
      from classificadas c
     where (p_plano is null
            or (p_plano = 'teste' and c.plan_id is null)
            or (p_plano <> 'teste' and c.plan_id::text = p_plano))
       and (p_etapa is null or c.etapa = p_etapa)
       and (p_saude is null or c.saude = p_saude)
  )
  select f.id, f.name, f.slug, f.status, f.trial_ends_at, f.created_at,
         f.plan_id, f.plano, coalesce(f.cancelada, false), f.lojas, f.etapa, f.saude,
         f.motivos, f.ultima,
         (count(*) over ())::integer
    from filtradas f
   order by f.created_at desc
   limit greatest(least(coalesce(p_limite, 25), 100), 1)
  offset greatest(coalesce(p_deslocamento, 0), 0);
end;
$$;

comment on function public.admin_organizacoes is
  'A03: clientes com plano, etapa do começo e saúde, filtrados e paginados. Só platform_admin.';

revoke all on function public.admin_organizacoes(
  text, public.org_status, text, text, text, integer, integer
) from public, anon;
grant execute on function public.admin_organizacoes(
  text, public.org_status, text, text, text, integer, integer
) to authenticated;
