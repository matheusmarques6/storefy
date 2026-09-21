-- Ativos únicos num período (a tela C11).
--
-- POR QUE NÃO SAI DE `analytics_daily`: `active_users` é o distinto DO DIA.
-- Somar trinta dias dá "aparelho-dias", e não usuários — quem abriu o app todo
-- dia contaria trinta vezes. O número que o lojista chama de MAU é o distinto
-- do PERÍODO, e ele só existe em `device_days`.
--
-- `security invoker` de propósito: a função roda com o papel de quem chama, a
-- RLS de `device_days` é avaliada normalmente e um membro de outra organização
-- recebe zero. Uma `security definer` aqui exigiria refazer à mão a checagem
-- que a policy já faz — e é exatamente aí que vaza dado entre clientes.
create or replace function public.ativos_no_periodo(p_app_id uuid, p_de date, p_ate date)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(distinct dd.device_id)::integer
    from public.device_days dd
   where dd.app_id = p_app_id
     and dd.day between p_de and p_ate;
$$;

comment on function public.ativos_no_periodo(uuid, date, date) is
  'Aparelhos distintos que abriram o app no período. Respeita a RLS de quem chama.';

revoke all on function public.ativos_no_periodo(uuid, date, date) from public, anon;
grant execute on function public.ativos_no_periodo(uuid, date, date) to authenticated, service_role;
