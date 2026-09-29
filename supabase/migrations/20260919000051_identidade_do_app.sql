-- A identidade do app: o identificador nas lojas, o registro na Apple e o nome.
--
-- O DEFEITO. O checklist da publicação (C12) exige o identificador do app no
-- iPhone e no Android e diz que "a Storefy define" — e nada definia. As colunas
-- `bundle_id_ios` e `package_android` ficavam nulas para sempre, o botão de
-- publicar nunca destravava, ligar as notificações recusava por falta do
-- identificador e o banner "baixe o app" nunca aparecia. E o nome do app, que
-- nasce do nome da loja, não tinha onde ser mudado: uma loja de nome longo
-- ficava presa no item "o nome passa de 30 caracteres".
--
-- O QUE MUDA AQUI:
--   1. só o servidor escreve na linha do app (menos as impressões digitais do
--      Android, que a tela da publicação grava pela sessão);
--   2. o identificador tem o formato que a Apple E o Google aceitam, e é único
--      entre os apps da Storefy;
--   3. o identificador que já foi usado numa loja de aplicativos não muda mais;
--   4. três funções gravam identificador, registro na Apple e nome creditando
--      quem pediu na trilha de auditoria.

-- ------------------------------------------------ 1. só o servidor escreve

-- Antes, o dono e o administrador podiam mudar pela API, direto, o projeto do
-- Expo, o app do OneSignal e os identificadores — colunas que só fazem sentido
-- escritas pelo servidor, depois de conferidas. A tela nunca escreveu nelas
-- pela sessão; a porta estava aberta à toa.
--
-- Ficam duas: as impressões digitais do Android, que a Publicação grava pela
-- sessão (com a RLS de dono e administrador), e a versão no ar, que
-- `publicar_config` grava — ela roda com o papel de quem publica, e é a RLS
-- de `app_configs` que decide quem pode.
revoke insert, update on public.apps from authenticated, anon;
grant update (android_cert_fingerprints, current_config_version) on public.apps to authenticated;

-- ------------------------------------------------------------- 2. formato

-- O que as duas lojas aceitam ao mesmo tempo: minúsculas e números, cada parte
-- começando por letra, pelo menos duas partes. A Apple aceita hífen e o Google
-- aceita sublinhado, mas cada um recusa o do outro — e o mesmo identificador
-- nas duas lojas é o que o lojista espera ver.
alter table public.apps
  add constraint apps_bundle_id_ios_formato check (
    bundle_id_ios is null
    or (bundle_id_ios ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$' and char_length(bundle_id_ios) <= 150)
  ),
  add constraint apps_package_android_formato check (
    package_android is null
    or (package_android ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$' and char_length(package_android) <= 150)
  ),
  -- O número do app na App Store (o "Apple ID" dele), como a API da Apple devolve.
  add constraint apps_ios_asc_app_id_formato check (
    ios_asc_app_id is null or ios_asc_app_id ~ '^[0-9]{6,15}$'
  );

create unique index apps_bundle_id_ios_unico
  on public.apps (bundle_id_ios) where bundle_id_ios is not null;
create unique index apps_package_android_unico
  on public.apps (package_android) where package_android is not null;

-- ------------------------------------------------------------- 3. a trava

/*
 * O identificador que já chegou a uma loja de aplicativos não muda mais: na
 * Apple, o app criado no App Store Connect é daquele identificador; no Google,
 * o primeiro envio o amarra ao app para sempre. Trocar depois criaria outro
 * app, sem as avaliações nem os downloads do primeiro — e o lojista só
 * descobriria no próximo envio.
 *
 * No banco, e não só na tela: vale para o painel, para o suporte e para
 * qualquer script. Build que falhou antes de gerar o binário não trava nada.
 */
create or replace function public.apps_identificador_travado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.bundle_id_ios is distinct from old.bundle_id_ios
     and old.bundle_id_ios is not null
     and (
       old.ios_asc_app_id is not null
       or exists (
         select 1
           from public.builds b
          where b.app_id = old.id
            and b.platform = 'ios'
            and b.status in ('finished', 'submitted', 'in_review', 'approved', 'rejected')
       )
     ) then
    raise exception 'O identificador do app já está em uso na Apple e não pode mais mudar.';
  end if;

  if new.package_android is distinct from old.package_android
     and old.package_android is not null
     and exists (
       select 1
         from public.builds b
        where b.app_id = old.id
          and b.platform = 'android'
          and b.status in ('finished', 'submitted', 'in_review', 'approved', 'rejected')
     ) then
    raise exception 'O identificador do app já foi usado num envio ao Google e não pode mais mudar.';
  end if;

  return new;
end;
$$;

comment on function public.apps_identificador_travado() is
  'Impede trocar o identificador do app depois que ele chegou à Apple ou ao Google.';

create trigger apps_identificador_travado
  before update of bundle_id_ios, package_android on public.apps
  for each row execute function public.apps_identificador_travado();

revoke all on function public.apps_identificador_travado() from public, anon, authenticated;

-- ---------------------------------------------------------- 4. as funções

/*
 * Define o identificador do app, o mesmo nas duas lojas.
 *
 * `p_ator` é quem pediu, conferido pelo servidor (dono ou administrador da
 * loja). Ele vira o autor da sessão só nesta transação, para a trilha de
 * auditoria creditar a pessoa, e não "o sistema".
 */
create or replace function public.definir_identificador_do_app(
  p_app_id uuid,
  p_ator uuid,
  p_identificador text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identificador text := lower(btrim(coalesce(p_identificador, '')));
begin
  if v_identificador !~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$' or char_length(v_identificador) > 150 then
    raise exception 'Use só letras minúsculas e números, em partes separadas por ponto, como br.com.sualoja.app.';
  end if;

  if p_ator is not null then
    perform set_config('request.jwt.claim.sub', p_ator::text, true);
  end if;

  update public.apps
     set bundle_id_ios = v_identificador,
         package_android = v_identificador
   where id = p_app_id;

  if not found then
    raise exception 'App não encontrado.';
  end if;
end;
$$;

comment on function public.definir_identificador_do_app(uuid, uuid, text) is
  'Grava o identificador do app nas duas lojas. Só service role, depois de conferir quem pediu.';

revoke all on function public.definir_identificador_do_app(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.definir_identificador_do_app(uuid, uuid, text) to service_role;

/*
 * Guarda o número do app no App Store Connect — o que a API da Apple devolveu
 * ao procurar o identificador na conta do lojista. É ele que o envio à Apple e
 * o banner "baixe o app" usam. Só o servidor chama, depois de ouvir a Apple:
 * aceitar da tela deixaria apontar o banner para o app de outra empresa.
 */
create or replace function public.registrar_app_na_apple(
  p_app_id uuid,
  p_ator uuid,
  p_asc_app_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_asc_app_id, '') !~ '^[0-9]{6,15}$' then
    raise exception 'Número de app da Apple inválido.';
  end if;

  if p_ator is not null then
    perform set_config('request.jwt.claim.sub', p_ator::text, true);
  end if;

  update public.apps set ios_asc_app_id = p_asc_app_id where id = p_app_id;

  if not found then
    raise exception 'App não encontrado.';
  end if;
end;
$$;

comment on function public.registrar_app_na_apple(uuid, uuid, text) is
  'Grava o número do app no App Store Connect, achado pela API da Apple. Só service role.';

revoke all on function public.registrar_app_na_apple(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.registrar_app_na_apple(uuid, uuid, text) to service_role;

/*
 * Troca o nome do app — o que aparece embaixo do ícone e na loja de
 * aplicativos. Até 30 caracteres, o limite da App Store: acima disso a Apple
 * corta o nome sem avisar. Vale no próximo envio às lojas.
 */
create or replace function public.renomear_app(
  p_app_id uuid,
  p_ator uuid,
  p_nome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
begin
  if v_nome = '' then
    raise exception 'Dê um nome ao app.';
  end if;
  if char_length(v_nome) > 30 then
    raise exception 'O nome passa de 30 caracteres, e a App Store cortaria. Encurte o nome.';
  end if;

  if p_ator is not null then
    perform set_config('request.jwt.claim.sub', p_ator::text, true);
  end if;

  update public.apps set display_name = v_nome where id = p_app_id;

  if not found then
    raise exception 'App não encontrado.';
  end if;
end;
$$;

comment on function public.renomear_app(uuid, uuid, text) is
  'Troca o nome do app (até 30 caracteres). Só service role, depois de conferir quem pediu.';

revoke all on function public.renomear_app(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.renomear_app(uuid, uuid, text) to service_role;
