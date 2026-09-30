-- =============================================================================
-- C12 — o último passo para o app ir ao ar
-- =============================================================================
--
-- Achado na auditoria de 29/09/2026. Depois do build, a tela dizia "A loja
-- recebeu. Agora é aguardar a revisão." — e ninguém estava revisando:
--
--   * na Apple, o envio só sobe o binário para a App Store Connect. A versão
--     fica em "Preparar para envio" até o dono da conta escolher o build,
--     completar a ficha e clicar em "Enviar para a revisão". O job perguntava
--     o estado à Apple de hora em hora e jogava fora tudo o que não fosse
--     "em revisão", "aprovado" ou "recusado" — justamente os estados em que
--     é a vez do lojista;
--   * no Google, a versão vai para o teste interno, que ninguém revisa. Para
--     chegar aos clientes, o lojista a promove para a produção no Play
--     Console. O job nem olhava o Android: uma loja só com Android ficava
--     "Em revisão" para sempre, e o passo "no ar" do painel nunca fechava.
--
-- Agora cada build guarda o estado que a loja de aplicativos diz dele
-- (`store_state`), e a tela e a equipe (A06) sabem de quem é a vez: do
-- lojista, da loja ou de ninguém. No Android, o job lê as trilhas com a conta
-- de serviço do lojista e a página pública do app.
-- =============================================================================

alter table public.builds
  add column store_state text,
  add column store_state_at timestamptz,
  -- Um token da loja, e não texto livre: a tela escolhe o que dizer por ele.
  add constraint builds_store_state_formato
    check (store_state is null or store_state ~ '^[A-Z][A-Z_]{1,59}$');

comment on column public.builds.store_state is
  'O estado desta versão na loja de aplicativos: o da App Store Connect (PREPARE_FOR_SUBMISSION, WAITING_FOR_REVIEW...) ou o da Play (PLAY_INTERNAL, PLAY_PRODUCTION...). Só o job da revisão grava.';

-- ------------------------------------------------ gravar o estado da loja

drop function public.gravar_revisao(uuid, public.build_status, text);

create function public.gravar_revisao(
  p_id uuid,
  p_status public.build_status default null,
  p_erro text default null,
  p_estado text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.build_status;
  v_erro_antes text;
  v_estado_antes text;
  v_mudou boolean := false;
begin
  select status, error, store_state into v_antes, v_erro_antes, v_estado_antes
    from public.builds where id = p_id for update;

  if v_antes is null then
    return false;
  end if;

  /*
   * Aprovado não volta atrás, mas o estado da loja ainda anda: na Apple,
   * "aprovado, esperando você liberar" vira "na loja" quando o lojista
   * libera, e a tela precisa parar de pedir o clique. Só anda com uma
   * leitura que ainda diz "aprovado": uma resposta velha dizendo "em
   * revisão" não reescreve nada.
   */
  if v_antes = 'approved' then
    if p_status = 'approved' and p_estado is not null
       and p_estado is distinct from v_estado_antes then
      update public.builds set store_state = p_estado, store_state_at = now() where id = p_id;
      return true;
    end if;
    return false;
  end if;

  -- Só avança a partir de um estado de espera. Sem isto, um ciclo do cron
  -- rodando sobre dado velho voltaria um build recusado para "em revisão".
  if v_antes not in ('submitted', 'in_review') then
    return false;
  end if;

  -- O estado muda mesmo sem decisão: é ele que diz se falta um passo do lojista.
  if p_estado is not null and p_estado is distinct from v_estado_antes then
    update public.builds set store_state = p_estado, store_state_at = now() where id = p_id;
    v_mudou := true;
  end if;

  if p_status is null then
    if coalesce(v_erro_antes, '') = coalesce(p_erro, '') then
      return v_mudou;
    end if;
    update public.builds set error = p_erro where id = p_id;
    return true;
  end if;

  if p_status not in ('in_review', 'approved', 'rejected') then
    raise exception 'gravar_revisao: status % não é decisão de revisão', p_status;
  end if;

  if v_antes = p_status and coalesce(v_erro_antes, '') = coalesce(p_erro, '') then
    return v_mudou;
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

comment on function public.gravar_revisao(uuid, public.build_status, text, text) is
  'Grava o que a loja de aplicativos disse de um build: o estado dela e, quando há, a decisão (em revisão, aprovado, recusado).';

revoke all on function public.gravar_revisao(uuid, public.build_status, text, text)
  from public, anon, authenticated;
grant execute on function public.gravar_revisao(uuid, public.build_status, text, text)
  to service_role;

-- ------------------------------------------------ o que o job pergunta

/*
 * Os builds que o job da revisão acompanha, nas duas lojas.
 *
 * Com o número da versão: cada build sai como `1.0.<n>`, e a Apple é
 * perguntada pela versão DAQUELE número — a mais nova da App Store Connect
 * pode ser outra (a que já está na loja), e emprestar o estado dela aprovaria
 * uma atualização que ninguém revisou.
 *
 * Só o MAIS NOVO de cada app em cada loja: uma versão substituída por outra
 * não anda mais, e perguntar por ela gastaria a cota da chave do lojista.
 * E a janela é de 60 dias, e não 21: a primeira publicação espera o lojista
 * tirar as capturas, responder o questionário de privacidade e, no Android,
 * preencher a ficha da Play — e isso leva semanas. O primeiro da fila é o
 * que foi olhado há mais tempo.
 */
drop function public.builds_em_revisao(integer);

create function public.builds_em_revisao(p_limite integer default 40)
returns table (
  id uuid,
  platform public.device_platform,
  build_number integer,
  version text,
  bundle_id_ios text,
  package_android text,
  asc_key_enc text,
  asc_key_id text,
  asc_issuer_id text,
  google_service_account_enc text
)
language sql
security definer
set search_path = ''
as $$
  select x.id, x.platform, x.build_number, x.version, x.bundle_id_ios, x.package_android,
         x.asc_key_enc, x.asc_key_id, x.asc_issuer_id, x.google_service_account_enc
    from (
      select distinct on (b.app_id, b.platform)
             b.id, b.platform, b.build_number, b.version, b.status, b.store_state,
             coalesce(b.store_state_at, b.submitted_at) as olhado_em,
             a.bundle_id_ios, a.package_android,
             d.asc_key_enc, d.asc_key_id, d.asc_issuer_id, d.google_service_account_enc
        from public.builds b
        join public.apps a on a.id = b.app_id
        join public.stores s on s.id = a.store_id
        join public.developer_accounts d
          on d.org_id = s.org_id
         and d.platform = case when b.platform = 'ios' then 'apple' else 'google' end::public.developer_platform
       where b.status in ('submitted', 'in_review', 'approved')
         and b.submitted_at > now() - interval '60 days'
         and (b.platform <> 'ios' or (a.bundle_id_ios is not null and d.asc_key_enc is not null))
         and (b.platform <> 'android'
              or (a.package_android is not null and d.google_service_account_enc is not null
                  and b.build_number is not null))
       order by b.app_id, b.platform, b.submitted_at desc
    ) x
   -- Aprovado só volta à fila enquanto a Apple espera ser liberado.
   where x.status <> 'approved'
      or x.store_state in ('PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE')
   order by x.olhado_em asc
   limit greatest(1, least(coalesce(p_limite, 40), 200));
$$;

comment on function public.builds_em_revisao(integer) is
  'Os builds mais novos de cada app nas duas lojas que ainda podem andar, com a chave cifrada da conta. Só o job da revisão chama.';

revoke all on function public.builds_em_revisao(integer) from public, anon, authenticated;
grant execute on function public.builds_em_revisao(integer) to service_role;
