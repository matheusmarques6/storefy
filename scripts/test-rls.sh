#!/usr/bin/env bash
#
# Testes de RLS contra um Postgres real.
#
# Recria um banco descartável, aplica os stubs do Supabase, aplica todas as
# migrations em ordem e roda as asserções. Sai diferente de zero se qualquer
# asserção falhar, para o CI reprovar o build.
#
# Não precisa de Docker nem de projeto Supabase: o que importa é que a RLS é do
# Postgres, e `supabase/tests/helpers/supabase_stubs.sql` reproduz o contrato
# que o Supabase expõe (auth.uid(), papéis anon/authenticated/service_role).
#
# Uso:
#   ./scripts/test-rls.sh                 # usa o cluster local via socket
#   PGURL=postgres://... ./scripts/test-rls.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BANCO="${RLS_TEST_DB:-storefy_rls_test}"

if [[ -n "${PGURL:-}" ]]; then
  psql_admin() { psql "${PGURL}" "$@"; }
  psql_teste() { psql "${PGURL%/*}/${BANCO}" "$@"; }
elif [[ "$(id -un)" == "postgres" ]]; then
  psql_admin() { psql -d postgres "$@"; }
  psql_teste() { psql -d "${BANCO}" "$@"; }
else
  psql_admin() { su postgres -c "psql -d postgres $(printf '%q ' "$@")"; }
  psql_teste() { su postgres -c "psql -d ${BANCO} $(printf '%q ' "$@")"; }
fi

echo "==> Recriando o banco de teste '${BANCO}'"
psql_admin -q -c "drop database if exists ${BANCO} with (force)" >/dev/null
psql_admin -q -c "create database ${BANCO}" >/dev/null

echo "==> Aplicando os stubs do Supabase"
psql_teste -v ON_ERROR_STOP=1 -q -f "${RAIZ}/supabase/tests/helpers/supabase_stubs.sql"

echo "==> Aplicando as migrations"
for arquivo in "${RAIZ}"/supabase/migrations/*.sql; do
  echo "    $(basename "${arquivo}")"
  psql_teste -v ON_ERROR_STOP=1 -q -f "${arquivo}"
done

echo "==> Carregando as asserções"
psql_teste -v ON_ERROR_STOP=1 -q -f "${RAIZ}/supabase/tests/helpers/assertions.sql"

echo "==> Rodando os testes de RLS"
psql_teste -v ON_ERROR_STOP=1 -f "${RAIZ}/supabase/tests/rls.test.sql"

echo "==> Limpando"
psql_admin -q -c "drop database if exists ${BANCO} with (force)" >/dev/null
echo "==> RLS: todas as asserções passaram"
