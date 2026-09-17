-- Mini-framework de asserções para os testes de RLS.
-- Sem dependência externa (pgTAP não está disponível em toda instalação).

create schema if not exists tests;

create table if not exists tests.resultados (
  id serial primary key,
  grupo text not null,
  descricao text not null,
  passou boolean not null,
  detalhe text
);

-- Registra o resultado de uma asserção.
create or replace function tests.ok(p_grupo text, p_condicao boolean, p_descricao text)
returns void
language plpgsql
as $$
begin
  insert into tests.resultados (grupo, descricao, passou)
  values (p_grupo, p_descricao, coalesce(p_condicao, false));
end;
$$;

-- Passa a agir como o usuário informado, igual ao que o PostgREST faz por request.
create or replace function tests.login(p_email text)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text,
    false
  );
end;
$$;

-- Volta ao estado sem usuário autenticado.
create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', false);
end;
$$;

-- True quando o comando é BLOQUEADO (erro ou nenhuma linha afetada).
-- INSERT barrado por WITH CHECK lança exceção; UPDATE/DELETE barrados por
-- USING simplesmente não encontram linha. Os dois contam como bloqueio.
create or replace function tests.bloqueado(p_sql text)
returns boolean
language plpgsql
as $$
declare
  v_linhas integer;
begin
  execute p_sql;
  get diagnostics v_linhas = row_count;
  return v_linhas = 0;
exception
  when insufficient_privilege or check_violation then
    return true;
  when others then
    -- Violação de RLS no PostgREST chega como 42501; qualquer outro erro é
    -- problema real do teste e deve aparecer.
    if sqlstate = '42501' then
      return true;
    end if;
    raise;
end;
$$;

-- True quando o comando é PERMITIDO e afeta pelo menos uma linha.
create or replace function tests.permitido(p_sql text)
returns boolean
language plpgsql
as $$
declare
  v_linhas integer;
begin
  execute p_sql;
  get diagnostics v_linhas = row_count;
  return v_linhas > 0;
exception
  when others then
    return false;
end;
$$;

-- Quantas linhas o usuário atual enxerga na consulta.
create or replace function tests.contar(p_sql text)
returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  execute p_sql into v_n;
  return coalesce(v_n, 0);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
grant select, insert on tests.resultados to anon, authenticated, service_role;
grant usage, select on all sequences in schema tests to anon, authenticated, service_role;
