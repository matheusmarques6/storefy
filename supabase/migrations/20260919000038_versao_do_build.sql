-- O número e a versão de cada binário, reservados pelo banco.
--
-- O DEFEITO: o workflow que gera o app nunca definia `IOS_BUILD`,
-- `ANDROID_VC` nem `APP_VERSION`, e o `app.config.ts` caía no padrão — todo
-- binário de toda loja saía como versão 1.0.0, build 1. A primeira publicação
-- passava. A SEGUNDA — trocar o ícone, reenviar depois de uma recusa — era
-- recusada pela App Store Connect ("the bundle version must be higher") e pelo
-- Google Play ("version code already used"), e a loja ficava presa na
-- primeira versão para sempre. E `minSupportedBuild` não tinha como funcionar:
-- não existe "build mais novo" quando todos são o 1.
--
-- O CONTADOR É POR APP, e não por plataforma. `minSupportedBuild` é UM número
-- na config, comparado com o build instalado nas duas plataformas; com um
-- contador só, "exigir o build 7" significa a mesma coisa no iPhone e no
-- Android. Buracos na sequência (um build que falhou antes de subir) são
-- aceitos pelas duas lojas.
--
-- A VERSÃO É `1.0.<número>`: depois que uma versão é aprovada, a Apple não
-- aceita outro binário com o MESMO texto de versão, e amarrar a versão ao
-- número garante que ela sempre sobe.

create or replace function public.reservar_versao_do_build(p_build_id uuid)
returns table (numero integer, versao text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app uuid;
  v_existente integer;
  v_numero integer;
begin
  select b.app_id, b.build_number into v_app, v_existente
    from public.builds b
   where b.id = p_build_id;

  if v_app is null then
    raise exception 'reservar_versao_do_build: build % não existe', p_build_id
      using errcode = 'P0002';
  end if;

  -- Idempotente: o workflow reexecutado pede de novo e recebe o MESMO número.
  if v_existente is not null then
    return query select v_existente, '1.0.' || v_existente::text;
    return;
  end if;

  -- Dois builds do mesmo app começando juntos (iOS e Android, um clique só)
  -- leriam o mesmo máximo sem esta trava. Ela vale até o fim da transação.
  perform pg_advisory_xact_lock(hashtextextended('versao-do-build:' || v_app::text, 0));

  select coalesce(max(b.build_number), 0) + 1 into v_numero
    from public.builds b
   where b.app_id = v_app;

  update public.builds
     set build_number = v_numero,
         version = '1.0.' || v_numero::text
   where id = p_build_id;

  return query select v_numero, '1.0.' || v_numero::text;
end;
$$;

comment on function public.reservar_versao_do_build(uuid) is
  'Reserva o próximo número (por app) e a versão 1.0.<n> de um build. Idempotente.';

revoke all on function public.reservar_versao_do_build(uuid) from public, anon, authenticated;
grant execute on function public.reservar_versao_do_build(uuid) to service_role;
