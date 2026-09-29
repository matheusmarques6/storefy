-- O fuso da loja passa a ser conferido pelo banco.
--
-- O DEFEITO: `stores.timezone` era texto livre, com grant de UPDATE para o
-- painel. Um fuso que o Postgres não conhece ("lixo", "Brasil") não quebrava
-- nada na hora de gravar — quebrava depois, no `at time zone` do
-- `consolidar_analytics`, que percorre as lojas de TODOS os clientes num laço
-- só: a exceção de uma loja derrubava o fechamento do dia de todas.
--
-- A tela nunca deixou gravar isso — mas a tela não é a autorização (regra 2 do
-- CLAUDE.md), e o PostgREST aceitava o UPDATE direto, com a sessão de qualquer
-- dono de loja.
--
-- POR QUE `pg_timezone_names` E NÃO UM `at time zone` DE TESTE: o `at time
-- zone` aceita também abreviação e regra POSIX ("EST", "UTC+3"), que o banco
-- entende de um jeito e o painel, em JavaScript, de outro — a mesma loja teria
-- um fuso no analytics e outro na tela. A lista exige um NOME de fuso.
--
-- O custo é uma leitura da lista (~40 ms), e só quando o fuso muda: o trigger
-- é `update of timezone`, e editar o nome da loja não passa por ele.

create or replace function public.conferir_fuso_da_loja()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.timezone ~ '^(posix|right)/'
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = new.timezone
     ) then
    raise exception 'fuso_desconhecido: %', new.timezone
      using errcode = 'check_violation',
            hint = 'Use o nome de um fuso, como America/Sao_Paulo.';
  end if;
  return new;
end;
$$;

comment on function public.conferir_fuso_da_loja is
  'Recusa fuso que o Postgres não conhece: ele derrubaria o job diário de todas as lojas.';

create trigger stores_fuso_conhecido
  before insert or update of timezone on public.stores
  for each row execute function public.conferir_fuso_da_loja();

-- Loja que já tenha um fuso ilegível volta para o padrão, em vez de ficar
-- travada: sem isto, o próximo "Salvar" dela falharia por um valor que o
-- lojista nunca escolheu.
update public.stores
   set timezone = 'America/Sao_Paulo'
 where timezone ~ '^(posix|right)/'
    or not exists (
      select 1 from pg_catalog.pg_timezone_names where name = stores.timezone
    );
