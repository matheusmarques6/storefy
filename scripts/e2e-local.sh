#!/usr/bin/env bash
#
# E2E de ponta a ponta contra um Supabase DE VERDADE, na própria máquina.
#
# Sobe a pilha oficial do Supabase (Postgres, Auth, REST, Storage), aplica as
# migrations, faz o build de PRODUÇÃO do painel apontando para ela e roda o
# Playwright contra `next start` — o mesmo binário que vai para a Vercel, e não
# o `next dev`, que esconde diferenças de build.
#
# POR QUE ESTE SCRIPT EXISTE: por semanas a suíte e2e existiu sem rodar nunca,
# porque "precisa de um Supabase alcançável". Na primeira vez que rodou, achou
# em minutos um logout quebrado, um botão que não fazia nada na tela de login e
# páginas do admin executando para quem não era admin. Teste que não roda não
# protege nada.
#
# Uso:
#   ./scripts/e2e-local.sh                  # a suíte inteira
#   ./scripts/e2e-local.sh e2e/admin.spec.ts
#   SEM_BUILD=1 ./scripts/e2e-local.sh      # reaproveita o build anterior
#
# Nada aqui toca o `.env.local`: as variáveis vêm do shell, e o Next dá
# precedência a elas sobre os arquivos .env.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB="${RAIZ}/apps/web"
PORTA="${PORTA:-3000}"
LOG="${TMPDIR:-/tmp}/storefy-e2e-next.log"

# ------------------------------------------------------------- 1. Docker
if ! docker info >/dev/null 2>&1; then
  if command -v dockerd >/dev/null 2>&1; then
    echo "==> Subindo o daemon do Docker"
    (dockerd >"${TMPDIR:-/tmp}/storefy-dockerd.log" 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  docker info >/dev/null 2>&1 || { echo "Docker indisponível. O e2e precisa dele para o Supabase local."; exit 1; }
fi

# ------------------------------------------------------------- 2. Supabase
cd "${RAIZ}"
if ! npx supabase status >/dev/null 2>&1; then
  echo "==> Subindo o Supabase local (primeira vez baixa as imagens)"
  # O registry padrão do CLI é o ECR, cujo CDN nem toda rede alcança; o Docker
  # Hub publica as mesmas imagens. O que o produto não usa fica de fora.
  SUPABASE_INTERNAL_IMAGE_REGISTRY="${SUPABASE_INTERNAL_IMAGE_REGISTRY:-docker.io}" \
    npx supabase start -x studio,logflare,vector,edge-runtime,supavisor,postgres-meta,imgproxy
fi

STATUS="$(npx supabase status -o env 2>/dev/null)"
valor() { printf '%s\n' "${STATUS}" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'; }

export NEXT_PUBLIC_SUPABASE_URL="$(valor API_URL)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(valor ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(valor SERVICE_ROLE_KEY)"
export NEXT_PUBLIC_SITE_URL="http://app.localhost:${PORTA}"
export E2E_BASE_URL="http://app.localhost:${PORTA}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
export CRON_SECRET="${CRON_SECRET:-cron-do-e2e-local}"
# O segredo das rotas internas do build e da OTA: é com ele que o
# `segredo-do-app.spec.ts` faz o papel do workflow do GitHub.
export BUILD_API_SECRET="${BUILD_API_SECRET:-build-do-e2e-local}"
# A Asaas do e2e é um servidor na própria máquina, que o `cobranca.spec.ts`
# sobe na porta abaixo: a cobrança de verdade passa pelo sandbox da Asaas, com
# uma conta que é da Storefy (ver PLANO, Fase 7).
export PORTA_DA_ASAAS_DE_TESTE="${PORTA_DA_ASAAS_DE_TESTE:-4010}"
export ASAAS_API_URL="http://127.0.0.1:${PORTA_DA_ASAAS_DE_TESTE}/v3"
export ASAAS_API_KEY='$aact_hmlg_chave_do_e2e_local'
export ASAAS_WEBHOOK_TOKEN="${ASAAS_WEBHOOK_TOKEN:-token-do-aviso-do-e2e-local}"
# Vazias DE PROPÓSITO, e não ausentes: ausente, o Next buscaria o valor no
# `.env.local` do desenvolvedor, que aponta para outro projeto.
export NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=""
export NEXT_PUBLIC_CLIENT_HOST=""
export NEXT_PUBLIC_ADMIN_HOST=""
export NEXT_TELEMETRY_DISABLED=1
# As integrações de verdade ficam DESLIGADAS pelo mesmo motivo: valendo as do
# `.env.local`, a suíte mandaria o erro de teste para o Sentry da Storefy,
# e-mail de verdade pela Resend, chamado para o suporte e build para o GitHub.
# Quem quiser uma delas no e2e passa o valor no shell.
export SENTRY_DSN="${E2E_SENTRY_DSN:-}"
export RESEND_API_KEY=""
export EMAIL_SUPORTE=""
export ONESIGNAL_ORG_API_KEY=""
export GITHUB_DISPATCH_TOKEN=""
export SHOPIFY_API_KEY=""
export SHOPIFY_API_SECRET=""

# ------------------------------------------------------------- 3. Build
cd "${WEB}"
if [[ "${SEM_BUILD:-}" != "1" ]]; then
  echo "==> Build de produção apontando para o Supabase local"
  npx next build >/dev/null
fi

# ------------------------------------------------------------- 4. Servidor
# Libera a porta de verdade. `ss -p` não mostra o PID em todo container, e um
# servidor antigo esquecido na porta faz a suíte inteira testar o build de
# ONTEM sem avisar — aconteceu, e três rodadas "passaram" contra código velho.
# `fuser` mata quem segura a porta; o `pkill -x` (nome exato, e não a linha de
# comando) pega o que sobrar sem acertar o próprio shell.
liberar_porta() {
  fuser -k "${PORTA}/tcp" >/dev/null 2>&1 || true
  for _ in $(seq 1 10); do
    fuser "${PORTA}/tcp" >/dev/null 2>&1 || return 0
    sleep 1
  done
  echo "A porta ${PORTA} continua ocupada. Pare o processo que está nela e rode de novo."
  exit 1
}
liberar_porta
trap liberar_porta EXIT

echo "==> Subindo o painel em ${E2E_BASE_URL}"
npx next start -p "${PORTA}" >"${LOG}" 2>&1 &
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:${PORTA}/api/health" && break
  sleep 1
done
curl -sf "http://127.0.0.1:${PORTA}/api/health" >/dev/null \
  || { echo "O painel não respondeu. Log em ${LOG}"; tail -20 "${LOG}"; exit 1; }

# ------------------------------------------------------------- 5. Playwright
# Um Chromium já instalado no ambiente, quando existe: nem toda rede alcança o
# CDN de onde o Playwright baixaria o dele.
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" && -x /opt/pw-browsers/chromium ]]; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
fi

echo "==> Playwright"
set +e
E2E_SEM_SERVIDOR=true npx playwright test "$@"
RESULTADO=$?
set -e

# Erro de servidor durante a suíte é falha, mesmo com todo teste verde: uma
# página que estoura por trás de um redirect passa no teste e explode no log
# de produção — foi assim que apareceram as páginas do admin executando para
# quem não era admin.
#
# UMA EXCEÇÃO, e só uma: "The destination stream closed early" é o CLIENTE
# indo embora no meio de uma resposta. Acontece quando o teste termina e fecha
# o navegador enquanto o Next ainda pré-carrega um <Link> da última página
# (medido: 1 em 4 rodadas do teste do "sem acesso", cuja página tem um link
# para "/"). O servidor está certo em registrar, e não há o que consertar do
# lado dele. Qualquer outro erro continua reprovando.
#
# `requisicao.falhou` é a mesma coisa pelo log estruturado (`instrumentation.ts`):
# o que vai para o Sentry em produção reprova aqui.
FALHAS='⨯ Error|"evento":"requisicao\.falhou"'
ERROS="$(grep -E "${FALHAS}" "${LOG}" | grep -v 'The destination stream closed early' || true)"
if [[ -n "${ERROS}" ]]; then
  echo ""
  echo "==> O servidor registrou erros durante a suíte:"
  grep -E "${FALHAS}" -A 2 "${LOG}" | grep -v 'The destination stream closed early' | head -30
  [[ ${RESULTADO} -eq 0 ]] && RESULTADO=1
fi

exit ${RESULTADO}
