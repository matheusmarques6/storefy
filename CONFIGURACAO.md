# O que falta você fazer — passo a passo

Tudo o que a Storefy precisa de **fora** para sair do ar de teste e virar um
produto rodando de verdade. O código das fases 0 a 5 está pronto e testado; o
que está aqui é conta, chave e domínio, que só uma pessoa pode criar.

**Como usar:** faça na ordem. Cada bloco diz o que destrava, quanto custa e
onde colar cada valor. Quando terminar um bloco, me mande os valores e eu
ligo e testo a parte correspondente.

**Onde colar, em uma frase:**

| Lugar                                     | O que vai lá                                        |
| ----------------------------------------- | --------------------------------------------------- |
| Vercel › Settings › Environment Variables | quase tudo (o painel lê daqui)                      |
| GitHub › Settings › Secrets › Actions     | `EXPO_TOKEN`, `BUILD_API_SECRET`, `STOREFY_API_URL` |
| `apps/web/.env.local`                     | as mesmas da Vercel, para rodar na sua máquina      |

`apps/web/.env.local` nunca é comitado. Copie de `.env.example`.

---

## Bloco 0 — Contas que você já tem (conferir)

- [ ] **Supabase** — projeto `npmftaxkhqsxppcqlbdd` (sa-east-1). Já está de pé
      com 28 migrations aplicadas.
- [ ] **GitHub** — `matheusmarques6/storefy`. Já está.
- [ ] **Vercel** — precisa do plano **Pro (US$ 20/mês)**.

> **Por que Pro:** o plano Hobby limita o Vercel Cron a 2 jobs, uma vez por dia.
> A Storefy tem 4, e o de envio de push roda **a cada minuto** — é ele que faz
> a campanha agendada sair na hora marcada. No Hobby, o push agendado atrasaria
> até 24 horas.

**Me mande:** confirmação de que a Vercel está no Pro.

---

## Bloco 1 — Domínio (30 min, destrava tudo)

Sem domínio próprio, os links de confirmação de e-mail, o retorno do OAuth da
Shopify e a política de privacidade que a Apple exige apontam para um endereço
`*.vercel.app` que muda a cada deploy.

1. Escolha os dois subdomínios. Sugestão, usando o domínio que você já tem:
   - painel do lojista: `app.storefy.com.br` (ou `storefy.convertfy.me`)
   - painel da Storefy: `admin.storefy.com.br` (ou `admin-storefy.convertfy.me`)
2. Na Vercel, projeto › **Settings › Domains**, adicione os dois.
3. No seu provedor de DNS, crie os `CNAME` que a Vercel mostrar.
4. Espere o certificado ficar verde na Vercel (costuma levar minutos).

**Me mande:** os dois endereços finais.

Eles viram `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CLIENT_HOST` e
`NEXT_PUBLIC_ADMIN_HOST`.

---

## Bloco 2 — Chaves que você gera sozinho (5 min)

Rode no terminal e guarde a saída de cada uma:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 32      # BUILD_API_SECRET
openssl rand -hex 32      # EAS_WEBHOOK_SECRET
```

- **`ENCRYPTION_KEY`** — cifra os segredos das lojas (token Shopify, chaves
  Apple e Google, chave do OneSignal). **Guarde em lugar seguro.** Se ela se
  perder, nenhum segredo já gravado abre de novo, e todo lojista precisa
  reconectar tudo.
- **`CRON_SECRET`** — sem ela, qualquer pessoa na internet dispararia o envio
  de push de todos os clientes. As rotas de job respondem 503 enquanto ela não
  existir, de propósito.
- **`BUILD_API_SECRET`** — assina a conversa entre o GitHub Actions e o painel.
  Vai nos **dois** lugares: Vercel e segredos do GitHub.
- **`EAS_WEBHOOK_SECRET`** — assina o aviso de "build pronto" que o Expo manda.
  Também vai nos **dois** lugares. Você gera, e não copia de lugar nenhum: o
  webhook do EAS é por projeto, cada loja tem o seu, e é o workflow que o
  registra com este valor a cada loja nova.

**Me mande:** as quatro (ou coloque direto na Vercel e me avise).

---

## Bloco 3 — Supabase, o que falta (20 min)

O banco está pronto. Falta ligar três coisas no painel do Supabase.

### 3.1 Chave de service role

**Project Settings › API Keys › `service_role`.** É a chave que ignora RLS.
Nunca vai para o navegador.

→ `SUPABASE_SERVICE_ROLE_KEY`

### 3.2 URLs de retorno do login

**Authentication › URL Configuration:**

- _Site URL_: `https://app.storefy.com.br`
- _Redirect URLs_: `https://app.storefy.com.br/**` e
  `https://admin.storefy.com.br/**`

Sem isso, o link de confirmação de e-mail cai em "invalid redirect".

### 3.3 SMTP próprio (Resend — ver bloco 4)

**Authentication › Emails › SMTP Settings:**

- Host `smtp.resend.com`, porta `465`, usuário `resend`, senha = a chave da
  Resend.

O SMTP embutido do Supabase entrega poucos e-mails por hora e cai em spam —
serve para testar, não para clientes.

### 3.4 (opcional) Entrar com Google

**Authentication › Providers › Google.** Só depois disso ligue
`NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true`. Com `false`, o botão aparece
desabilitado explicando que falta configurar — e não some, porque sumir faria
parecer que o produto não tem login social.

**Me mande:** a `SUPABASE_SERVICE_ROLE_KEY` e um "ok" dos itens 3.2 e 3.3.

---

## Bloco 4 — Resend, e-mail (20 min, ~US$ 0 até 3 mil e-mails/mês)

Manda o e-mail de confirmação de cadastro e o aviso de "seu app foi aprovado".

1. Crie a conta em <https://resend.com>.
2. **Domains › Add Domain** — use o mesmo domínio do bloco 1.
3. Crie no DNS os registros que a Resend mostrar (SPF, DKIM e DMARC).
4. Espere ficar **Verified**. Sem isso a Resend recusa o envio com 403.
5. **API Keys › Create** — permissão de envio basta.

**Me mande:**

- `RESEND_API_KEY`
- `EMAIL_REMETENTE`, no formato `Storefy <nao-responda@storefy.com.br>`

> Se faltarem, nada se perde: o aviso volta para a fila e sai no ciclo
> seguinte, quando as chaves existirem. É a única integração assim.

---

## Bloco 5 — Shopify Partner (40 min, grátis) ⭐

**É o que destrava a Fase 5 inteira:** conectar a loja, receber os pedidos,
separar receita do app e do site, e os avisos de "pedido enviado" e "voltou ao
estoque".

1. Crie a conta em <https://partners.shopify.com> (grátis).
2. **Apps › Create app › Create app manually.** Nome: `Storefy`.
3. Em **Configuration**, preencha:
   - _App URL_: `https://app.storefy.com.br`
   - _Allowed redirection URL(s)_:
     `https://app.storefy.com.br/api/shopify/callback`
     — precisa ser **exatamente** isso, com `https` e sem barra no fim.
4. Em **API access / Protected customer data**, peça acesso a dados de cliente
   (a Shopify pergunta o porquê: "notificações push transacionais e atribuição
   de pedidos ao aplicativo próprio da loja").
5. Em **Compliance webhooks**, aponte os três para o **mesmo endereço**:

   | Webhook               | URL                                               |
   | --------------------- | ------------------------------------------------- |
   | Customer data request | `https://app.storefy.com.br/api/webhooks/shopify` |
   | Customer data erasure | `https://app.storefy.com.br/api/webhooks/shopify` |
   | Shop data erasure     | `https://app.storefy.com.br/api/webhooks/shopify` |

   Os três são **obrigatórios**: sem eles a Shopify recusa o app na revisão.

6. Copie **Client ID** e **Client secret**.

**Me mande:**

- `SHOPIFY_API_KEY` (é o Client ID)
- `SHOPIFY_API_SECRET` (é o Client secret)

### 5.1 Publicar a extensão de tema

Depois que o app existir, uma vez só, na sua máquina:

```bash
npm install -g @shopify/cli
cd /caminho/para/storefy
shopify app deploy
```

É isso que leva o banner "baixe o app" e o botão "me avise quando voltar" para
o editor de tema das lojas.

### 5.2 Uma loja de desenvolvimento para testar

No Partner Dashboard, **Stores › Add store › Development store**. É grátis,
serve para instalar o app e ver a corrente inteira funcionando sem mexer numa
loja de cliente.

**Me mande:** o endereço `.myshopify.com` dela.

---

## Bloco 6 — Expo / EAS (30 min, US$ 0 no início)

É quem compila o app iOS e Android de cada loja.

1. Crie a conta em <https://expo.dev>.
2. Crie uma **organização** (o "owner" dos projetos). Anote o slug dela — é o
   que aparece na URL do painel do Expo.
3. **Account Settings › Access Tokens › Create token** (token de robô).
4. Convide o token/robô para a organização, com permissão de criar projetos.

É só isso. **Não rode `eas init` nem `eas webhook:create` à mão**: cada loja
tem o seu próprio projeto no Expo (senão um update de uma loja cairia no app da
outra), e é o workflow de build que cria o projeto da loja, registra o webhook
de status nele e guarda o id em `apps.expo_project_id`.

**Me mande:**

- `EXPO_TOKEN` (→ segredos do GitHub)
- `EXPO_OWNER` (o slug da organização, → segredos do GitHub)

> `EAS_WEBHOOK_SECRET` é o do bloco 2, gerado por você, e vai na Vercel **e**
> nos segredos do GitHub. Sem ele, a rota do webhook responde 503 de propósito:
> aceitar POST sem conferir assinatura deixaria qualquer um marcar um build
> como aprovado.

---

## Bloco 7 — GitHub, token e segredos (10 min)

1. **Settings › Developer settings › Personal access tokens › Fine-grained.**
   - Repositório: só `matheusmarques6/storefy`
   - Permissões: **Contents: read**, **Metadata: read**,
     **Actions: read and write**
2. Em **Settings › Secrets and variables › Actions** do repositório, crie:

   | Segredo              | Valor                                             |
   | -------------------- | ------------------------------------------------- |
   | `EXPO_TOKEN`         | do bloco 6                                        |
   | `EXPO_OWNER`         | do bloco 6 (o slug da organização)                |
   | `BUILD_API_SECRET`   | do bloco 2                                        |
   | `EAS_WEBHOOK_SECRET` | do bloco 2 — o **mesmo** valor que está na Vercel |
   | `STOREFY_API_URL`    | `https://app.storefy.com.br`                      |

**Me mande:**

- `GITHUB_DISPATCH_TOKEN` (o token criado)
- `GITHUB_REPO` = `matheusmarques6/storefy`

---

## Bloco 8 — OneSignal, push (20 min, grátis até 10 mil assinantes)

1. Crie a conta em <https://onesignal.com>.
2. **Organization Settings › Keys & IDs › Organization API Key.**

   Se o seu plano não mostrar essa opção, me avise: dá para trocar o fluxo
   para o lojista criar o app OneSignal dele, mas aí são mais três telas de
   configuração que ele preenche à mão — por isso o caminho padrão é a chave
   de organização.

**Me mande:** `ONESIGNAL_ORG_API_KEY`

---

## Bloco 9 — Apple, para a primeira publicação (1–2 dias de espera)

> **Isto é por CLIENTE, não por Storefy.** Cada app é publicado na conta do
> próprio lojista — é a diretriz 4.2.6 da Apple, e publicar tudo na nossa
> conta é motivo de banimento. Você precisa de uma conta só para **testar** a
> corrente inteira.

1. **Apple Developer Program** — US$ 99/ano, em
   <https://developer.apple.com/programs>. A aprovação costuma levar de 24 a
   48 horas.
2. **App Store Connect › Users and Access › Integrations › App Store Connect
   API › Keys.** Crie uma chave com papel **App Manager**. Baixe o `.p8`
   (**só dá para baixar uma vez**) e anote _Key ID_ e _Issuer ID_.
3. **Certificates, Identifiers & Profiles › Keys.** Crie uma chave **APNs**.
   Baixe o `.p8` e anote o _Key ID_. Anote também o _Team ID_.

**O que fazer com isso:** nada de variável de ambiente. Você sobe os arquivos
**pelo painel**, em _Publicação › Conectar Apple_ (tela C13), e eles são
cifrados antes de tocar no banco.

**Me mande:** um "ok, conectei", e eu confiro o que a tela gravou.

---

## Bloco 10 — Google Play, para a primeira publicação (30 min + 1 dia)

Mesma regra: a conta é do cliente. Uma para testar.

1. **Google Play Console** — US$ 25, uma vez só, em
   <https://play.google.com/console/signup>.
2. Crie o app na Play Console e faça **o primeiro envio à mão**. O Google não
   aceita o primeiro `.aab` pela API — o painel tem uma tela guiada para isso,
   com o arquivo para baixar e o passo a passo.
3. **Setup › API access › Create service account**, no Google Cloud. Dê o papel
   de **Service Account User** e, na Play Console, conceda acesso de
   **Release manager** a ela. Baixe o JSON.

**O que fazer com isso:** sobe pelo painel, em _Publicação › Conectar Google_.

**Me mande:** um "ok, conectei".

---

## Bloco 11 — Um celular de verdade (1 hora)

As fases 1 a 3 (editor, prévia ao vivo, push) estão escritas e testadas, mas
nunca rodaram num aparelho: este ambiente não tem um. Quando houver o primeiro
build, preciso que você:

1. Instale o app no celular pelo TestFlight (iOS) ou pela trilha interna
   (Android).
2. Abra, aceite as notificações, navegue, ponha algo no carrinho.
3. Me diga o que viu — principalmente se o cabeçalho do tema **pisca** antes de
   sumir, se o badge do carrinho acompanha, e se o push chega.

---

## Ordem que eu recomendo

| Ordem | Bloco   | Por quê                                                         |
| ----- | ------- | --------------------------------------------------------------- |
| 1º    | 1, 2, 3 | domínio e chaves destravam todo o resto                         |
| 2º    | 4       | e-mail funcionando = dá para convidar gente                     |
| 3º    | **5**   | é a fase inteira que acabei de entregar, parada por duas chaves |
| 4º    | 6, 7, 8 | juntos, fazem o primeiro build sair                             |
| 5º    | 9, 10   | exigem espera de aprovação; comece cedo                         |
| 6º    | 11      | quando houver o primeiro build                                  |

---

## Resumo: só os valores

Cole na Vercel (**Production**, **Preview** e **Development**) e no
`apps/web/.env.local`:

```
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_CLIENT_HOST=
NEXT_PUBLIC_ADMIN_HOST=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=
CRON_SECRET=
BUILD_API_SECRET=
RESEND_API_KEY=
EMAIL_REMETENTE=
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
ONESIGNAL_ORG_API_KEY=
GITHUB_DISPATCH_TOKEN=
GITHUB_REPO=matheusmarques6/storefy
EAS_WEBHOOK_SECRET=
```

Nos segredos do GitHub Actions:

```
EXPO_TOKEN=
EXPO_OWNER=
BUILD_API_SECRET=
EAS_WEBHOOK_SECRET=
STOREFY_API_URL=
```

`BUILD_API_SECRET` e `EAS_WEBHOOK_SECRET` aparecem nas duas listas de
propósito: é o mesmo valor nos dois lugares, um lado assinando e o outro
conferindo.

Pelo painel, como arquivo (nunca como variável): chaves Apple `.p8` e JSON da
conta de serviço do Google.

---

## O que acontece hoje, sem nada disso

Nada quebra em silêncio — cada ponto bloqueado tem um estado explícito:

| Sem                      | O que acontece                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `SHOPIFY_API_KEY/SECRET` | a tela de Integrações diz "em preparação"; o webhook responde 503, para a Shopify reentregar quando existir |
| `CRON_SECRET`            | as rotas de job respondem 503 e não enviam nada                                                             |
| `EAS_WEBHOOK_SECRET`     | o webhook do EAS responde 503 em vez de aceitar qualquer POST                                               |
| `RESEND_API_KEY`         | o aviso volta para a fila e sai depois, sem se perder                                                       |
| `ENCRYPTION_KEY`         | a conexão com a Shopify e os assistentes Apple/Google recusam gravar, em vez de salvar em claro             |
| contas Apple/Google      | o checklist de publicação mostra o que falta e o botão de publicar fica travado, com o motivo escrito       |
