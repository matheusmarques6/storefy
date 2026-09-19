-- O acompanhamento da revisão da Apple (passo 6 da seção 7 do plano).
--
-- Duas funções, as duas só para a service role, as duas pelo mesmo motivo de
-- sempre: `builds_em_revisao` devolve a chave .p8 CIFRADA de cada loja, e
-- `gravar_revisao` escreve numa tabela que não tem policy de update. Nenhuma
-- das duas pode ser chamada pelo navegador.

/*
 * Os builds que ainda esperam uma decisão da Apple.
 *
 * Só iOS: o envio ao Google vai para a trilha interna, que não passa por
 * revisão. Ali `submitted` já é o estado final até o lojista promover a versão
 * no Play Console, e mover para `approved` diria a ele que o app está no ar
 * quando não está.
 *
 * O `interval '21 days'` existe porque a Apple às vezes simplesmente não
 * responde — app abandonado, conta cancelada, versão substituída. Sem o corte,
 * o cron perguntaria por esses builds de hora em hora para sempre, gastando a
 * cota da chave do lojista em algo que nunca vai mudar.
 */
create or replace function public.builds_em_revisao(p_limite integer default 40)
returns table (
  id uuid,
  bundle_id_ios text,
  asc_key_enc text,
  asc_key_id text,
  asc_issuer_id text
)
language sql
security definer
set search_path = ''
as $$
  select b.id, a.bundle_id_ios, d.asc_key_enc, d.asc_key_id, d.asc_issuer_id
    from public.builds b
    join public.apps a on a.id = b.app_id
    join public.stores s on s.id = a.store_id
    join public.developer_accounts d
      on d.org_id = s.org_id and d.platform = 'apple'
   where b.platform = 'ios'
     and b.status in ('submitted', 'in_review')
     and b.submitted_at > now() - interval '21 days'
     and a.bundle_id_ios is not null
   order by b.submitted_at asc
   limit greatest(1, least(coalesce(p_limite, 40), 200));
$$;

comment on function public.builds_em_revisao(integer) is
  'Builds de iOS esperando decisão da Apple, com a chave cifrada da loja. Só service role.';

/*
 * Grava o que a Apple respondeu.
 *
 * Devolve `true` só quando algo MUDOU de verdade. O cron usa isso para contar
 * e, no futuro, para decidir quando avisar o lojista: sem essa distinção, uma
 * versão parada em `in_review` por três dias geraria 72 avisos iguais.
 *
 * `p_status` nulo com `p_erro` preenchido é o caso da chave revogada: o build
 * fica onde está e a mensagem aparece na tela, porque um build parado em
 * "enviado" para sempre não diz ao lojista que ele precisa reconectar a conta.
 */
create or replace function public.gravar_revisao(
  p_id uuid,
  p_status public.build_status default null,
  p_erro text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.build_status;
  v_erro_antes text;
begin
  select status, error into v_antes, v_erro_antes
    from public.builds where id = p_id for update;

  if v_antes is null then
    return false;
  end if;

  -- Só avança a partir de um estado de espera. Sem isto, um ciclo do cron
  -- rodando sobre dado velho voltaria um build aprovado para "em revisão".
  if v_antes not in ('submitted', 'in_review') then
    return false;
  end if;

  if p_status is null then
    if coalesce(v_erro_antes, '') = coalesce(p_erro, '') then
      return false;
    end if;
    update public.builds set error = p_erro where id = p_id;
    return true;
  end if;

  if p_status not in ('in_review', 'approved', 'rejected') then
    raise exception 'gravar_revisao: status % não é decisão de revisão', p_status;
  end if;

  if v_antes = p_status and coalesce(v_erro_antes, '') = coalesce(p_erro, '') then
    return false;
  end if;

  update public.builds
     set status = p_status,
         error = p_erro,
         -- Aprovado e rejeitado são fim de linha: a hora fica registrada.
         finished_at = case
           when p_status in ('approved', 'rejected') then coalesce(finished_at, now())
           else finished_at
         end
   where id = p_id;

  return true;
end;
$$;

comment on function public.gravar_revisao(uuid, public.build_status, text) is
  'Grava a decisão da Apple num build. Devolve true só quando algo mudou.';

-- As duas leem e escrevem o que a RLS esconde do dono. Fora do alcance da API
-- pública; só o servidor, com a service role.
revoke all on function public.builds_em_revisao(integer) from public, anon, authenticated;
revoke all on function public.gravar_revisao(uuid, public.build_status, text)
  from public, anon, authenticated;
grant execute on function public.builds_em_revisao(integer) to service_role;
grant execute on function public.gravar_revisao(uuid, public.build_status, text) to service_role;
