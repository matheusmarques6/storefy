-- Sessões de prévia: ver o rascunho num aparelho antes de publicar (fase 2).
--
-- O lojista gera um código no editor e aponta o app Storefy Preview para ele.
-- O app não tem sessão do painel — quem o segura é o código, e é por isso que
-- ele vale pouco tempo.
--
-- O TOKEN É GUARDADO COMO HASH. Ele dá acesso ao rascunho de uma loja sem
-- login; guardá-lo em claro faria um vazamento do banco virar acesso a todos os
-- rascunhos de todos os clientes de uma vez. O valor em claro existe só no
-- instante em que é gerado, e vai direto para o QR na tela.

create table public.preview_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  -- sha256 do token, em hexadecimal.
  token_hash text not null unique,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.preview_sessions is
  'Código temporário que deixa o app Storefy Preview ler o rascunho de um app.';
comment on column public.preview_sessions.token_hash is
  'sha256 do código. O valor em claro nunca é gravado.';

create index preview_sessions_app_id_idx on public.preview_sessions (app_id);
create index preview_sessions_expires_at_idx on public.preview_sessions (expires_at);

alter table public.preview_sessions enable row level security;

create policy "membros leem as prévias dos apps da organização"
  on public.preview_sessions for select to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id and public.is_store_member(a.store_id)
    )
  );

create policy "owner e admin criam prévias"
  on public.preview_sessions for insert to authenticated
  with check (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

create policy "owner e admin encerram prévias"
  on public.preview_sessions for delete to authenticated
  using (
    exists (
      select 1 from public.apps a
      where a.id = app_id
        and public.has_store_role(a.store_id, array['owner', 'admin']::public.membership_role[])
    )
  );

-- ------------------------------------------------------------ abrir prévia

/*
 * Gera o código e devolve o valor em claro UMA vez.
 *
 * O sorteio acontece dentro do banco de propósito: assim o valor em claro não
 * passa pelo servidor web antes de existir, e não há caminho em que ele seja
 * gravado em log de aplicação por engano.
 *
 * `security invoker`: quem pode criar é quem a policy acima deixa.
 */
create or replace function public.abrir_previa(p_app_id uuid, p_minutos integer default 30)
returns table (token text, expira_em timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token text;
  v_expira timestamptz;
begin
  if p_minutos < 1 or p_minutos > 240 then
    raise exception 'A prévia vale de 1 a 240 minutos.' using errcode = '22023';
  end if;

  -- 32 caracteres hexadecimais: sorteável só na força bruta, e curto o
  -- bastante para caber num QR que a câmera lê de longe.
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_expira := now() + make_interval(mins => p_minutos);

  insert into public.preview_sessions (app_id, token_hash, created_by, expires_at)
  values (
    p_app_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    auth.uid(),
    v_expira
  );

  -- Prévias vencidas do mesmo app saem junto: ninguém volta nelas, e a tabela
  -- não precisa de um job só para isso.
  delete from public.preview_sessions
   where app_id = p_app_id and expires_at < now();

  return query select v_token, v_expira;
end;
$$;

comment on function public.abrir_previa is
  'Cria um código de prévia e devolve o valor em claro uma única vez.';

revoke execute on function public.abrir_previa(uuid, integer) from public, anon;
grant execute on function public.abrir_previa(uuid, integer) to authenticated;
