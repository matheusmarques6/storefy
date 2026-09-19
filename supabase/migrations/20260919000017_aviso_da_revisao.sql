-- O aviso por e-mail da decisão da Apple (passo 6 da seção 7 do plano).
--
-- A revisão leva de um a três dias. Nenhum lojista fica com a tela de
-- publicação aberta esperando; quando a Apple decide, ele precisa saber sem
-- ter de voltar aqui para conferir.
--
-- O PROBLEMA DE VERDADE É NÃO REPETIR. O cron roda de hora em hora, e um
-- "aprovado" que não fosse marcado viraria 24 e-mails por dia. A marca fica no
-- banco, e a reserva é atômica: dois ciclos em paralelo — que acontecem quando
-- uma execução demora mais do que uma hora — não mandam o mesmo aviso duas
-- vezes.

alter table public.builds
  -- Qual decisão já foi avisada. Nulo enquanto nenhuma foi.
  add column notified_status public.build_status;

comment on column public.builds.notified_status is
  'A última decisão avisada ao lojista por e-mail. Impede aviso repetido.';

/*
 * Reserva o direito de avisar sobre esta decisão.
 *
 * Devolve `true` para UM chamador só. Quem recebe `true` manda o e-mail; quem
 * recebe `false` não tem o que fazer. O `for update` é o que garante isso: sem
 * ele, dois ciclos lendo ao mesmo tempo veriam os dois `notified_status` velhos
 * e os dois mandariam.
 */
create or replace function public.reservar_aviso(p_id uuid, p_status public.build_status)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.build_status;
  v_avisado public.build_status;
begin
  select status, notified_status into v_status, v_avisado
    from public.builds where id = p_id for update;

  if v_status is null or v_status is distinct from p_status then
    -- A decisão mudou entre a gravação e o aviso: quem avisa é o próximo ciclo,
    -- sobre o estado novo. Avisar sobre o velho seria mentir.
    return false;
  end if;

  if v_avisado is not distinct from p_status then
    return false;
  end if;

  update public.builds set notified_status = p_status where id = p_id;
  return true;
end;
$$;

comment on function public.reservar_aviso(uuid, public.build_status) is
  'Reserva o aviso de uma decisão. Devolve true para um chamador só.';

/*
 * Devolve a reserva quando o e-mail não saiu.
 *
 * Sem isto, uma queda passageira do serviço de e-mail faria o lojista NUNCA
 * saber que o app foi aprovado — a marca ficaria lá dizendo que já avisamos.
 */
create or replace function public.devolver_aviso(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.builds set notified_status = null where id = p_id;
$$;

comment on function public.devolver_aviso(uuid) is
  'Desfaz a reserva do aviso quando o e-mail não pôde ser enviado.';

/*
 * Para quem avisar.
 *
 * Só owner e admin. Um `member` da organização não decide nada sobre
 * publicação, e mandar para ele um "seu app foi recusado" só gera confusão.
 *
 * A função lê `auth.users`, que é o motivo de ela ser `security definer` e de
 * não estar ao alcance do navegador: a lista de e-mails de uma organização é
 * exatamente o que alguém de fora gostaria de ter.
 */
create or replace function public.emails_do_build(p_id uuid)
returns table (email text, nome_da_loja text)
language sql
security definer
set search_path = ''
as $$
  select u.email::text, s.name
    from public.builds b
    join public.apps a on a.id = b.app_id
    join public.stores s on s.id = a.store_id
    join public.memberships m on m.org_id = s.org_id and m.role in ('owner', 'admin')
    join auth.users u on u.id = m.user_id
   where b.id = p_id
     and u.email is not null
     and u.email_confirmed_at is not null;
$$;

comment on function public.emails_do_build(uuid) is
  'E-mails de owner e admin da organização dona do build. Só service role.';

revoke all on function public.reservar_aviso(uuid, public.build_status)
  from public, anon, authenticated;
revoke all on function public.devolver_aviso(uuid) from public, anon, authenticated;
revoke all on function public.emails_do_build(uuid) from public, anon, authenticated;
grant execute on function public.reservar_aviso(uuid, public.build_status) to service_role;
grant execute on function public.devolver_aviso(uuid) to service_role;
grant execute on function public.emails_do_build(uuid) to service_role;
