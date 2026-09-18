# Storefy

**Sua loja virou app.** SaaS que transforma lojas Shopify em apps iOS e Android.
O app é uma WebView com uma camada nativa por cima — abas, push, splash e deep links.

- `CLAUDE.md` — regras do projeto. **As quatro regras inegociáveis valem para toda sessão.**
- `PLANO-DESENVOLVIMENTO.md` — plano completo, fase a fase. É a fonte de verdade.

Estado atual: **Fase 0 — Fundação**.

---

## Como rodar

### 1. Pré-requisitos

| Ferramenta | Versão   | Observação                                  |
| ---------- | -------- | ------------------------------------------- |
| Node       | 22+      | a versão exata está no `.nvmrc`             |
| pnpm       | 10+      | `corepack enable` já resolve                |
| PostgreSQL | 16+      | só o cliente (`psql`) se o banco for remoto |
| Docker     | opcional | necessário apenas para `supabase start`     |

### 2. Instalar

```bash
pnpm install
```

### 3. Apontar para um Supabase

Escolha **um** caminho.

#### Opção A — projeto no Supabase Cloud (recomendada)

> **O projeto já existe.** `storefy`, região `sa-east-1` (São Paulo),
> ref `npmftaxkhqsxppcqlbdd`. Todas as migrations já foram aplicadas nele.
> Você só precisa preencher o `.env.local`.

1. Copie `.env.example` para `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

2. Preencha com os valores de **Project Settings → API Keys**:

   | Variável                        | Valor                                            |
   | ------------------------------- | ------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`      | `https://npmftaxkhqsxppcqlbdd.supabase.co`       |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_xGUCRTlQQzljZpAQpe6phw_qLO1JSzx` |
   | `SUPABASE_SERVICE_ROLE_KEY`     | copie do painel — **nunca comite**               |

<details>
<summary>Começando um projeto Supabase do zero</summary>

1. Crie o projeto em [supabase.com](https://supabase.com/dashboard).
2. Preencha o `.env.local` com os valores de **Project Settings → Data API**:

   ```bash
   cp .env.example .env.local
   ```

   | Variável                        | Onde achar                              |
   | ------------------------------- | --------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Project URL                             |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` / publishable              |
   | `SUPABASE_SERVICE_ROLE_KEY`     | chave `service_role` — **nunca comite** |

3. Aplique as migrations:

   ```bash
   npx supabase link --project-ref <ref-do-projeto>
   npx supabase db push
   ```

   Sem a CLI, rode os arquivos de `supabase/migrations/` em ordem pelo SQL Editor
   do painel.

</details>

#### Opção B — Postgres local, sem Docker

Serve para desenvolver o banco e rodar os testes de RLS. Não sobe Auth nem
Storage, então o painel em si precisa da Opção A.

```bash
createdb storefy_local
psql -d storefy_local -f supabase/tests/helpers/supabase_stubs.sql
for f in supabase/migrations/*.sql; do psql -d storefy_local -v ON_ERROR_STOP=1 -f "$f"; done
```

#### Opção C — stack completa com Docker

```bash
npx supabase start   # sobe Postgres, Auth, Storage e Studio
npx supabase db reset
```

A CLI imprime a URL e as chaves para colar no `.env.local`.

### 4. Gerar os tipos do banco

```bash
pnpm db:types                                    # usa o cluster local
PGURL=postgres://... pnpm db:types               # usa outro banco
```

Rode isto **depois de toda migration** e commite o resultado. O CI compara o
arquivo commitado com o schema e reprova se estiverem fora de sincronia.

### 5. Criar o primeiro administrador

```bash
pnpm bootstrap:admin voce@suaempresa.com.br
```

Se a pessoa ainda não tem conta, o script envia um convite; se já tem, apenas a
promove. Não existe seed com dados fictícios: o primeiro admin é uma pessoa real
que você informa.

### 6. Subir o painel

```bash
pnpm dev
```

| Painel  | Endereço                                                   |
| ------- | ---------------------------------------------------------- |
| Cliente | http://app.localhost:3000                                  |
| Admin   | http://admin.localhost:3000 ou http://localhost:3000/admin |

`*.localhost` resolve sozinho no Chrome, no Edge e no Safari. No Firefox,
acrescente ao `/etc/hosts`:

```
127.0.0.1  app.localhost admin.localhost
```

---

## Deploy na Vercel

### Variáveis de ambiente

Cadastre em **Settings → Environment Variables**, marcando **Production,
Preview e Development** nas três primeiras — sem Preview, o deploy de cada PR
sobe sem conseguir falar com o banco.

| Variável                                             | Obrigatória | Valor                                            |
| ---------------------------------------------------- | ----------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`                           | **sim**     | `https://npmftaxkhqsxppcqlbdd.supabase.co`       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                      | **sim**     | `sb_publishable_xGUCRTlQQzljZpAQpe6phw_qLO1JSzx` |
| `SUPABASE_SERVICE_ROLE_KEY`                          | **sim**     | do painel do Supabase — só Production e Preview  |
| `NEXT_PUBLIC_SITE_URL`                               | recomendada | a URL de produção, sem barra no final            |
| `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`                   | não         | `true` só depois de configurar o provedor        |
| `NEXT_PUBLIC_CLIENT_HOST` / `NEXT_PUBLIC_ADMIN_HOST` | não         | preencha ao adotar domínio próprio               |

As duas primeiras são `NEXT_PUBLIC_`, ou seja, o Next as embute no bundle **em
tempo de build**. Cadastrá-las depois não afeta um deploy já feito: é preciso
redeployar.

Faltando qualquer uma das duas, a aplicação inteira responde com a tela
"Configuração pendente" listando o que falta. Isso é proposital — melhor do que
uma tela branca ou um erro de runtime sem explicação.

`RESEND_API_KEY` não é lida pela aplicação nesta fase. O Resend entra como SMTP
**dentro do Supabase** (Authentication → Emails → SMTP Settings), não pelo
código. A variável na Vercel só passa a ter uso quando enviarmos e-mail
transacional direto do painel, na Fase 3.

### Conferindo o deploy

```bash
curl https://SEU-DEPLOY.vercel.app/api/health
```

```json
{
  "status": "ok",
  "configuracao": { "supabaseUrl": true, "supabaseAnonKey": true, "...": true },
  "banco": { "alcancavel": true, "latenciaMs": 82 }
}
```

O endpoint devolve **503** quando falta configuração ou o banco não responde, e
só booleanos — nunca o valor de uma variável. Serve tanto para conferir um
deploy novo quanto para monitoramento depois.

### Redirects do Supabase Auth

Em **Authentication → URL Configuration**, cadastre em _Redirect URLs_:

```
https://SEU-DOMINIO/auth/callback
https://SEU-DOMINIO/auth/confirmar
https://*-SEU-PROJETO.vercel.app/auth/**
http://app.localhost:3000/auth/**
```

Sem isso, o link de confirmação de e-mail e o de recuperação de senha são
recusados pelo Supabase.

---

## Comandos

| Comando                        | O que faz                               |
| ------------------------------ | --------------------------------------- |
| `pnpm dev`                     | sobe o painel                           |
| `pnpm build`                   | build de produção                       |
| `pnpm lint`                    | ESLint com reconhecimento de tipos      |
| `pnpm typecheck`               | TypeScript em modo strict               |
| `pnpm test`                    | testes de unidade (Vitest)              |
| `pnpm test:rls`                | testes de RLS contra um Postgres real   |
| `pnpm e2e`                     | fluxos de ponta a ponta (Playwright)    |
| `pnpm db:types`                | regenera os tipos a partir do schema    |
| `pnpm bootstrap:admin <email>` | cadastra um administrador da plataforma |
| `pnpm format`                  | Prettier                                |

---

## Estrutura

```
storefy/
├─ apps/
│  ├─ web/                 Next.js (App Router) — painéis do cliente e do admin
│  │  ├─ app/(client)/     painel do cliente (C01, C05, lojas, configurações)
│  │  ├─ app/(admin)/      painel admin (A01, A03, A04, A12)
│  │  ├─ e2e/              fluxos Playwright
│  │  └─ proxy.ts          roteamento por painel + renovação de sessão
│  └─ mobile/              Expo — Fase 1
├─ packages/
│  ├─ config-schema/       AppConfig em Zod, o contrato painel ⇄ app
│  ├─ db/                  tipos gerados do banco e atalhos
│  ├─ bridge/              contrato WebView ⇄ nativo — Fase 1
│  ├─ ui/                  componentes compartilhados — Fase 8
│  └─ shopify/             cliente das APIs Shopify — Fase 5
├─ supabase/
│  ├─ migrations/          schema, RLS, triggers
│  └─ tests/               suíte de RLS e stubs do Supabase
└─ scripts/                bootstrap do admin, geração de tipos, runner de RLS
```

---

## Testes

### Unidade

```bash
pnpm test
```

Cobrem o schema `AppConfig` (incluindo compatibilidade retroativa) e a validação
dos formulários.

### RLS

```bash
pnpm test:rls
```

Recria um banco descartável, aplica todas as migrations e roda **49 asserções**
sobre isolamento entre organizações, papéis, acesso ao admin, imutabilidade da
auditoria e triggers.

Os testes rodam com `set role authenticated`, porque superusuário e dono de
tabela ignoram RLS — sem a troca de papel, a suíte passaria sem provar nada.

Não precisa de Docker nem de projeto Supabase: RLS é um recurso do Postgres, e
`supabase/tests/helpers/supabase_stubs.sql` reproduz o contrato que o Supabase
expõe (`auth.uid()` lendo `request.jwt.claims`, papéis `anon`, `authenticated` e
`service_role`).

### Ponta a ponta

```bash
pnpm e2e
```

Precisa de um Supabase alcançável com as migrations aplicadas; sem ele, os testes
são pulados com a explicação do que falta. Os usuários criados são reais, no
ambiente de teste, e removidos no final — a exceção prevista na regra 1.

---

## Decisões que valem saber

**TypeScript está em 6.0.3, não na 7.** O `typescript-eslint` 8.70 declara
suporte a `>=4.8.4 <6.1.0`. O lint com reconhecimento de tipos é o que faz valer
a regra de TypeScript strict, então manter o linter funcionando pesa mais do que
estar no compilador mais novo. Revisite quando o `typescript-eslint` suportar a 7.

**ESLint está em 9.39.5, não na 10.** Sob a 10, o parser que o
`eslint-config-next` 16 embute devolve um scope manager sem `addGlobals` e o lint
quebra em todo arquivo.

**Os tipos do banco vêm de introspecção, não do `supabase gen types`.** A CLI roda
o `postgres-meta` em container, e nem todo ambiente consegue puxar imagens Docker.
`scripts/gen-db-types.ts` fala direto com o Postgres e emite a mesma forma.

**O admin lê pela sessão do próprio usuário, não pela service role.** As policies
já contemplam `is_platform_admin()`, e um erro de rota com service role exporia
todos os clientes de uma vez. A service role fica para o que a RLS bloqueia de
propósito, como escrever em `platform_admins`.

**O roteamento resolve o painel por dois caminhos.** Subdomínio (`app.`/`admin.`)
é o modelo do plano; prefixo `/admin` é o que funciona no domínio da Vercel, que
serve um projeto em um host só. Preencher `NEXT_PUBLIC_CLIENT_HOST` e
`NEXT_PUBLIC_ADMIN_HOST` troca para subdomínio sem mover nenhuma rota.

---

## Segurança

- **RLS em todas as tabelas.** Nenhuma query confia em filtro do front.
- **`audit_logs` é somente-anexar.** Não existe policy de INSERT, UPDATE ou
  DELETE para ninguém — nem owner, nem admin da plataforma. A escrita vem só dos
  triggers. Uma trilha editável não serve como trilha.
- **Segredos com sufixo `_enc`** ficam criptografados e nunca chegam ao browser.
  Também não entram no diff da auditoria.
- **A service role nunca vai para o client.** Os módulos que a usam têm
  `import 'server-only'`, o que transforma um import indevido em erro de build.

---

## Licença

Proprietário — Convertfy.
