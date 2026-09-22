/*
 * A02 — os números da visão geral do admin.
 *
 * UMA CHAMADA, E NÃO DEZ. A tela precisa de dez contagens em quatro tabelas;
 * dez `count` disparados do servidor seriam dez idas ao banco para desenhar um
 * cabeçalho que o admin olha por três segundos.
 *
 * `security invoker`, E ISSO FOI UMA CORREÇÃO. A primeira versão era
 * `definer`, com o argumento de que um `count` sob RLS devolveria o que o
 * usuário ENXERGA e não o que existe — número filtrado em silêncio, pior que
 * erro. O argumento é bom e estava errado AQUI: toda policy de leitura destas
 * tabelas já termina em `or is_platform_admin()`, conferido no `pg_policies`.
 * Para o admin, invoker e definer devolvem o mesmo número.
 *
 * E aí invoker é melhor, por dois motivos. Não cria uma função que lê tudo
 * atrás de um único `if` — se alguém editar essa guarda errado um dia, definer
 * vaza a contagem do banco inteiro. E mantém a RLS como a única fronteira, que
 * é a regra do projeto, em vez de abrir uma porta paralela que precisa ser
 * lembrada toda vez.
 *
 * A guarda continua, mas por clareza, não por segurança: sem ela um usuário
 * comum receberia os números DELE — "1 organização ativa" — como se fossem os
 * da plataforma. O erro diz a verdade; o número certo da pergunta errada, não.
 *
 * O preço do invoker é uma tabela nova cuja policy esqueça o
 * `or is_platform_admin()`: ela contaria zero, calada. É exatamente o que a
 * asserção "conta o que existe" no rls.test.sql existe para pegar.
 *
 * O QUE NÃO ESTÁ AQUI, DE PROPÓSITO: MRR. Não existe tabela de cobrança ainda
 * — é a Fase 7 —, e número inventado em tela de dinheiro é a pior espécie de
 * dado falso, porque ninguém confere o que já parece plausível. A tela diz que
 * falta e diz o que falta.
 *
 * As janelas de 7 dias são do ERRO, não da tela: um build que quebrou há dois
 * meses não é trabalho de hoje, e contá-lo junto faria o número nunca baixar,
 * virando um enfeite vermelho permanente que ninguém mais lê.
 */
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
  contas_dev_com_erro integer
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
    (select count(*) from public.organizations where status = 'trialing')::integer,
    /*
     * Trial JÁ VENCIDO não entra: ele não é mais um prazo a acompanhar, é uma
     * cobrança que falhou ou uma conta que virou `canceled`, e os dois têm
     * cartão próprio. Misturar faria "vencendo" crescer para sempre sem
     * ninguém poder fazer nada a respeito — e um número que só sobe deixa de
     * ser lido.
     */
    (select count(*) from public.organizations
      where status = 'trialing'
        and trial_ends_at is not null
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
    (select count(*) from public.developer_accounts where status = 'error')::integer;
end
$$;

comment on function public.resumo_do_admin is
  'Os números da A02. Só platform_admin; a RLS continua sendo a fronteira.';

revoke all on function public.resumo_do_admin() from public, anon;
grant execute on function public.resumo_do_admin() to authenticated;
