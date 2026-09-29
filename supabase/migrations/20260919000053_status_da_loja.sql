-- O status da loja vem do que aconteceu com o app dela.
--
-- O DEFEITO. `stores.status` aparece no painel — no painel inicial (C05), na
-- lista e na página da loja — e no admin, onde o A02 conta "apps no ar" e "em
-- revisão" por ele. E nada o mudava: toda loja era "Rascunho" para sempre, com
-- o app aprovado nas duas lojas, e o A02 dizia zero apps no ar. Pior: a coluna
-- era gravável pela sessão, e o dono podia se declarar "No ar" pela API.
--
-- AGORA ele é DERIVADO dos builds do app, por gatilho, e só o banco o escreve:
--   No ar           algum build aprovado, em qualquer das duas lojas — e
--                   continua no ar enquanto uma atualização passa pela revisão;
--   Em revisão      algum build enviado ou em revisão;
--   Gerando app     algum build na fila, gerando ou pronto para enviar;
--   Revisão recusada o último desfecho foi a recusa, e nada novo está em curso;
--   Rascunho        nada disso.
-- "Pausada" é decisão de pessoa (o suporte), e o gatilho não a desfaz.

create or replace function public.status_da_loja_pelos_builds(p_app_id uuid)
returns public.store_status
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(bool_or(b.status = 'approved'), false) then 'live'
    when coalesce(bool_or(b.status in ('submitted', 'in_review')), false) then 'in_review'
    when coalesce(bool_or(b.status in ('queued', 'building', 'finished')), false) then 'building'
    when coalesce(bool_or(b.status = 'rejected'), false) then 'rejected'
    else 'draft'
  end::public.store_status
  from public.builds b
  where b.app_id = p_app_id;
$$;

comment on function public.status_da_loja_pelos_builds(uuid) is
  'O status da loja, calculado pelos builds do app: no ar, em revisão, gerando, recusado ou rascunho.';

create or replace function public.builds_atualiza_status_da_loja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_id uuid := coalesce(new.app_id, old.app_id);
  v_status public.store_status := public.status_da_loja_pelos_builds(v_app_id);
begin
  update public.stores s
     set status = v_status
    from public.apps a
   where a.id = v_app_id
     and s.id = a.store_id
     and s.status <> 'paused'
     and s.status is distinct from v_status;
  return null;
end;
$$;

comment on function public.builds_atualiza_status_da_loja() is
  'Mantém stores.status igual ao que os builds do app dizem. Não mexe em loja pausada.';

revoke all on function public.builds_atualiza_status_da_loja() from public, anon, authenticated;

create trigger builds_atualiza_status_da_loja
  after insert or delete or update of status on public.builds
  for each row execute function public.builds_atualiza_status_da_loja();

-- Só o banco escreve o status: a sessão não se declara "No ar".
revoke insert (status), update (status) on public.stores from authenticated;

-- As lojas que já existem passam a dizer a verdade.
update public.stores s
   set status = public.status_da_loja_pelos_builds(a.id)
  from public.apps a
 where a.store_id = s.id
   and s.status <> 'paused'
   and s.status is distinct from public.status_da_loja_pelos_builds(a.id);
