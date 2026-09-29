-- A07: a equipe revalida a credencial Apple ou Google de um cliente.
--
-- A conferência acontece no servidor (a chave é lida pela service role e
-- aberta ali); o RESULTADO é gravado por esta função, chamada pela sessão da
-- equipe. Assim o gatilho de auditoria de `developer_accounts` registra QUEM
-- conferiu — pela service role, a trilha sairia sem autor, e uma segunda
-- linha escrita à mão duplicaria a mudança.
--
-- A função não recebe segredo nenhum e não mexe nas colunas `_enc`: só no
-- estado, na data da validação e na observação que a equipe lê.

create or replace function public.admin_gravar_revalidacao(
  p_conta_id uuid,
  p_valida boolean,
  p_observacao text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.developer_accounts
     set status = case when p_valida then 'verified' else 'error' end::public.developer_account_status,
         verified_at = case when p_valida then now() end,
         notes = nullif(btrim(coalesce(p_observacao, '')), '')
   where id = p_conta_id
     -- Conta sem credencial não tem o que ter sido conferido.
     and status in ('verified', 'error');

  if not found then
    raise exception 'conta_nao_encontrada' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.admin_gravar_revalidacao(uuid, boolean, text) is
  'A07: grava o resultado da revalidação de uma credencial, com a equipe como autora na auditoria.';

revoke all on function public.admin_gravar_revalidacao(uuid, boolean, text) from public, anon;
grant execute on function public.admin_gravar_revalidacao(uuid, boolean, text) to authenticated;
