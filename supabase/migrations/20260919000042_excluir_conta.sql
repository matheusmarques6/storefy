-- Minha conta — excluir a própria conta (LGPD, art. 18, VI).
--
-- O banco já deixava (a Fase 0 corrigiu a cascata que impedia), mas não havia
-- botão: a pessoa precisava pedir ao suporte, e o suporte não tinha como
-- fazer sem abrir o banco de produção.
--
-- O perigo de excluir uma conta não é a conta: são as EMPRESAS. Quem é a
-- única pessoa de uma empresa leva junto a empresa, as lojas, os apps, as
-- campanhas — tudo, em cascata. Esta função diz isso ANTES, empresa por
-- empresa, com as mesmas regras que o banco vai aplicar
-- (`reassign_or_drop_org`): quem for o único membro apaga a empresa; o único
-- proprietário, com mais gente na equipe, passa a propriedade ao mais antigo
-- (administrador antes de membro); o resto só sai.

create or replace function public.consequencias_de_excluir_minha_conta()
returns table (
  org_id uuid,
  empresa text,
  efeito text,
  sucessor text,
  lojas bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with minhas as (
    select m.org_id, m.role
      from public.memberships m
     where m.user_id = (select auth.uid())
  )
  select
    minhas.org_id,
    o.name,
    case
      when (select count(*) from public.memberships x where x.org_id = minhas.org_id) = 1
        then 'excluida'
      when minhas.role = 'owner'
       and (select count(*) from public.memberships x
             where x.org_id = minhas.org_id and x.role = 'owner') = 1
        then 'passa_para'
      else 'sai'
    end,
    -- O mesmo sucessor que `reassign_or_drop_org` escolhe.
    (select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email::text)
       from public.memberships x
       join auth.users u on u.id = x.user_id
      where x.org_id = minhas.org_id and x.user_id <> (select auth.uid())
      order by case x.role when 'admin' then 0 else 1 end, x.created_at
      limit 1),
    (select count(*) from public.stores s where s.org_id = minhas.org_id)
  from minhas
  join public.organizations o on o.id = minhas.org_id
  order by o.created_at;
$$;

comment on function public.consequencias_de_excluir_minha_conta is
  'O que acontece com cada empresa se quem pergunta excluir a conta: excluída, passa a propriedade, ou só sai.';

revoke all on function public.consequencias_de_excluir_minha_conta() from public, anon;
grant execute on function public.consequencias_de_excluir_minha_conta() to authenticated;

-- ------------------------------------------------------------------------
-- DEFEITO da migration de convites, achado pelo e2e desta tela: a restrição
-- `invitations_aceite_com_autor` exigia `accepted_at` e `accepted_by` juntos,
-- e `accepted_by` tem `on delete set null`. Excluir uma conta que aceitou um
-- convite zerava o autor e violava a restrição — o Auth respondia "Database
-- error deleting user" e a conta NÃO saía. Justamente a pessoa que entrou por
-- convite ficava sem poder se excluir.
--
-- A regra que importa é uma direção só: não existe autor de aceite sem
-- aceite. Aceite sem autor é o registro de alguém que já foi embora.
alter table public.invitations drop constraint invitations_aceite_com_autor;
alter table public.invitations
  add constraint invitations_autor_so_com_aceite
  check (accepted_by is null or accepted_at is not null);
