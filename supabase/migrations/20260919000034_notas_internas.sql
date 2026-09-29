/*
 * A04 — notas internas sobre um cliente.
 *
 * É onde o suporte registra o que aconteceu: "ligou reclamando do build",
 * "pediu desconto", "vai migrar de tema em março". Sem isso, o que se sabe de
 * um cliente mora na cabeça de quem atendeu da última vez.
 *
 * A PROPRIEDADE QUE IMPORTA, e a que um descuido destruiria: o CLIENTE NUNCA
 * LÊ ISTO. Nem o dono da organização. A policy natural de escrever — "membros
 * leem as notas da própria organização" — é exatamente a errada, e entregaria
 * ao lojista tudo que a equipe anotou sobre ele. A asserção no rls.test.sql
 * prova que o dono não enxerga, e é ela que segura isso no lugar.
 *
 * NÃO HÁ UPDATE, de propósito. Uma nota é um registro do que se sabia NAQUELE
 * dia; reescrevê-la apaga a razão de ela existir. Quem mudou de ideia escreve
 * outra nota. Apagar continua possível — engano de digitação acontece, e uma
 * nota errada sobre um cliente é pior que nenhuma.
 */
create table public.org_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  /*
   * Quem escreveu. `set null` em vez de cascade: a nota sobrevive à saída da
   * pessoa da equipe. Perder o histórico de um cliente porque alguém foi
   * embora seria perder justamente o que este registro existe para guardar.
   */
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),

  -- Tamanho com teto para a nota não virar um documento colado, e com piso
  -- para não existir nota vazia ocupando espaço na tela.
  constraint org_notes_body_tamanho check (
    length(btrim(body)) between 2 and 4000
  )
);

comment on table public.org_notes is
  'Notas internas da equipe sobre um cliente. O cliente nunca lê.';

create index org_notes_por_org on public.org_notes (org_id, created_at desc);

-- ------------------------------------------------------------------ RLS

alter table public.org_notes enable row level security;

/*
 * Só a equipe da Storefy. Note que NÃO há cláusula por organização: não é
 * "membros da org leem as notas da org", é "só quem é da plataforma lê". A
 * diferença é a nota sobre um cliente chegar ou não ao próprio cliente.
 */
create policy "só a equipe da plataforma lê as notas internas"
  on public.org_notes for select to authenticated
  using (public.is_platform_admin());

comment on policy "só a equipe da plataforma lê as notas internas" on public.org_notes is
  'Só leitura, e só para platform_admins. Escrever e apagar é caminho de servidor.';

/*
 * Nenhuma policy de insert, update ou delete: a RLS nega por padrão, e o
 * caminho de escrita é a ação do servidor com a service role — igual ao das
 * correções OTA. Uma policy de escrita aqui seria uma segunda porta a lembrar
 * de trancar.
 */
revoke all on public.org_notes from anon;
grant select on public.org_notes to authenticated;

-- ------------------------------------------------- a lista, com quem escreveu

/*
 * As notas de uma organização, com o e-mail de quem escreveu.
 *
 * `security definer` pelo mesmo motivo do `admin_equipe`: o e-mail mora em
 * `auth.users`, que não tem policy para o `authenticated`. Não é RLS a
 * contornar — é um schema fora de alcance. A guarda no topo substitui a policy.
 *
 * O e-mail importa: uma nota sem autor é um bilhete anônimo sobre um cliente,
 * e ninguém sabe a quem perguntar o resto da história.
 */
create or replace function public.admin_notas_da_org(p_org_id uuid, p_limite integer default 50)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  author_id uuid,
  author_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Acesso restrito à equipe da plataforma.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select n.id, n.body, n.created_at, n.author_id, u.email::text
    from public.org_notes n
    left join auth.users u on u.id = n.author_id
   where n.org_id = p_org_id
   order by n.created_at desc
   limit greatest(1, least(coalesce(p_limite, 50), 200));
end
$$;

comment on function public.admin_notas_da_org is
  'Notas internas de uma organização, com quem escreveu. Só platform_admin.';

revoke all on function public.admin_notas_da_org(uuid, integer) from public, anon;
grant execute on function public.admin_notas_da_org(uuid, integer) to authenticated;
