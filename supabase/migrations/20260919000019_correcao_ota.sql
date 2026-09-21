-- Correção OTA para as lojas (seção 7 do plano, "Atualizações sem novo build").
--
-- Um bug no JavaScript do app não precisa de build novo nem de revisão da
-- Apple: o `expo-updates` baixa o pacote corrigido na próxima abertura. É a
-- diferença entre consertar em minutos e consertar em três dias.
--
-- CADA LOJA TEM O PRÓPRIO CANAL, e a correção é publicada uma vez por canal.
-- Isso não é zelo excessivo: o pacote JavaScript carrega as variáveis daquela
-- loja — o id do app, o segredo com que ele assina o que manda — e publicar um
-- pacote só para todos os canais entregaria o segredo de uma loja ao app de
-- outra.

create type public.ota_status as enum ('queued', 'running', 'finished', 'errored');

comment on type public.ota_status is
  'Do clique no admin até a última loja ter recebido a correção.';

create table public.ota_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  status public.ota_status not null default 'queued',
  /*
   * O texto que aparece no painel do Expo ao lado da atualização. É o que
   * alguém vai ler daqui a seis meses tentando entender o que foi publicado.
   */
  message text not null,
  /** Commit que gerou o pacote, para saber exatamente o que foi publicado. */
  commit_sha text,
  /** Quantas lojas entraram nesta rodada. Nulo até o workflow contar. */
  total integer,
  concluidas integer not null default 0,
  falhas integer not null default 0,
  /** Motivo, quando a rodada inteira falhou. */
  error text,
  triggered_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ota_updates is
  'Uma rodada de correção OTA para todas as lojas. Escrita pelo servidor.';

create trigger ota_updates_set_updated_at
  before update on public.ota_updates
  for each row execute function public.set_updated_at();

create index ota_updates_created_at_idx on public.ota_updates (created_at desc);

-- ------------------------------------------------------------------ RLS

alter table public.ota_updates enable row level security;

/*
 * Só a equipe da Storefy enxerga. Uma correção OTA é uma ação da PLATAFORMA,
 * não de um cliente: ela não pertence a nenhuma organização, e mostrá-la ao
 * lojista contaria a ele que outras lojas existem e quantas são.
 */
create policy "só a equipe da plataforma vê as correções OTA"
  on public.ota_updates for select to authenticated
  using (public.is_platform_admin());

comment on policy "só a equipe da plataforma vê as correções OTA" on public.ota_updates is
  'Só leitura, e só para platform_admins. Criar e atualizar é caminho de servidor.';

-- ------------------------------------------------------- lista para o runner

/*
 * As lojas que recebem a correção.
 *
 * Só as que JÁ TÊM projeto no Expo: sem projeto não há canal, e pedir uma
 * atualização para um canal que não existe faz o `eas update` falhar com uma
 * mensagem que não ajuda ninguém.
 *
 * Não devolve segredo nenhum — a lista viaja para o runner e vira uma matriz
 * de jobs, cujos nomes ficam visíveis para quem lê as execuções. Cada job
 * busca o que precisa depois, por loja, numa chamada autenticada.
 */
create or replace function public.lojas_para_ota()
returns table (store_id uuid, app_id uuid, nome text)
language sql
security definer
set search_path = ''
as $$
  select s.id, a.id, s.name
    from public.stores s
    join public.apps a on a.store_id = s.id
   where a.expo_project_id is not null
     and s.status <> 'paused'
   order by s.created_at asc
   limit 250;
$$;

comment on function public.lojas_para_ota() is
  'Lojas com projeto no Expo, para a matriz do workflow de OTA. Sem segredos.';

/*
 * O que um job da matriz precisa para gerar o pacote DAQUELA loja.
 *
 * O `device_secret_enc` sai daqui cifrado e é aberto pela rota do servidor,
 * como em todo o resto: a função não descriptografa nada.
 */
create or replace function public.dados_da_ota(p_store_id uuid)
returns table (
  app_id uuid,
  store_id uuid,
  nome_do_app text,
  bundle_id_ios text,
  package_android text,
  expo_project_id text,
  onesignal_app_id text,
  device_secret_enc text
)
language sql
security definer
set search_path = ''
as $$
  select a.id, s.id, a.display_name, a.bundle_id_ios, a.package_android,
         a.expo_project_id, a.onesignal_app_id, a.device_secret_enc
    from public.stores s
    join public.apps a on a.store_id = s.id
   where s.id = p_store_id
     and a.expo_project_id is not null;
$$;

comment on function public.dados_da_ota(uuid) is
  'Variáveis do pacote OTA de uma loja. Só service role.';

/*
 * Conta uma loja concluída ou falhada.
 *
 * Soma em vez de gravar o total: os jobs da matriz correm em paralelo, e dois
 * terminando ao mesmo tempo escreveriam por cima um do outro. O `+ 1` no
 * próprio UPDATE é atômico.
 */
create or replace function public.contar_ota(p_id uuid, p_ok boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ota_updates
     set concluidas = concluidas + (case when p_ok then 1 else 0 end),
         falhas = falhas + (case when p_ok then 0 else 1 end),
         status = case when status = 'queued' then 'running' else status end,
         started_at = coalesce(started_at, now())
   where id = p_id;
$$;

comment on function public.contar_ota(uuid, boolean) is
  'Soma uma loja concluída ou falhada na rodada. Atômico: a matriz é paralela.';

revoke all on function public.lojas_para_ota() from public, anon, authenticated;
revoke all on function public.dados_da_ota(uuid) from public, anon, authenticated;
revoke all on function public.contar_ota(uuid, boolean) from public, anon, authenticated;
grant execute on function public.lojas_para_ota() to service_role;
grant execute on function public.dados_da_ota(uuid) to service_role;
grant execute on function public.contar_ota(uuid, boolean) to service_role;
