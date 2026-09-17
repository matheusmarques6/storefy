# Storefy by Convertfy — Plano de Desenvolvimento Completo

> **Storefy** (by Convertfy) — "sua loja virou app". Produto complementar da Convertfy: mais um canal de retenção próprio, ao lado de e-mail, SMS e WhatsApp.
> SaaS que transforma lojas Shopify em apps iOS e Android. O app usa uma WebView com uma camada nativa por cima (tab bar, splash, push, deep links).
> Stack: **GitHub + Vercel + Supabase + Expo (EAS) + OneSignal**.
> Este documento é a fonte de verdade para o Claude Code. Ele deve ser lido junto com o `CLAUDE.md` da raiz do repositório.

Antes do lançamento, verificar o domínio (`storefy.com`/`.com.br`/`.app`), o INPI (classes 9 e 42) e as buscas por nome na App Store e no Google Play. Enquanto isso, usar subdomínios da Convertfy (ver abaixo).

**Domínios (fase inicial):** painel do cliente em `storefy.convertfy.me`; admin em `admin-storefy.convertfy.me` ou dentro do admin Convertfy. Os subdomínios `app.storefy.com` e `admin.storefy.com` citados no documento podem ser trocados por estes.

---

## 0. Princípios do produto

1. **O app espelha o site e parece nativo.** O conteúdo vem da loja pela WebView. A navegação, a abertura do app, as notificações e o feedback são nativos.
2. **Configuração remota sempre que possível.** Cores, abas, banners e regras de CSS vêm do Supabase em tempo de execução. Só geram um novo build: nome, ícone, splash, bundle ID e plugins nativos.
3. **Um produto integrado.** Quando o lojista salva algo no painel, o app atualiza na próxima abertura. Um push enviado no painel chega ao celular e as métricas voltam para o painel.
4. **Usabilidade primeiro.** O lojista precisa sair do cadastro com um preview funcionando em menos de 5 minutos, sem ajuda técnica.
5. **Aprovação na App Store faz parte do produto.** Todo app sai com pelo menos 4 recursos nativos reais e é publicado **na conta de desenvolvedor do próprio lojista**. Isso atende as diretrizes 4.2 e 4.2.6 da Apple.

---

## 1. Arquitetura geral

```
┌──────────────────────────── Vercel ────────────────────────────┐
│  apps/web (Next.js App Router)                                  │
│   ├─ app.storefy.com   → Painel do Cliente   (route group)     │
│   ├─ admin.storefy.com → Painel Admin        (route group)     │
│   ├─ /api/*             → webhooks Shopify, EAS, OneSignal,     │
│   │                       billing, config pública do app        │
│   └─ Vercel Cron        → dispara jobs (push agendado, etc.)    │
└───────────────┬─────────────────────────────────────────────────┘
                │ supabase-js (service role só no servidor)
┌───────────────▼────────────── Supabase ─────────────────────────┐
│ Postgres + RLS multi-tenant · Auth · Storage (ícones, splash,   │
│ imagens de push) · Edge Functions (jobs) · pg_cron · Realtime   │
│ (status de build ao vivo)                                        │
└───────────────┬─────────────────────────────────────────────────┘
                │
   ┌────────────┼───────────────┬─────────────────────┐
   ▼            ▼               ▼                     ▼
OneSignal   GitHub Actions   Expo EAS Build/Submit   Shopify
(1 app por  (orquestra       (1 projeto Expo por     (OAuth app +
 loja, via   builds por       loja, credenciais da    webhooks +
 Org API)    loja)            conta do lojista)       Storefront API)
                                    │
                                    ▼
                    apps/mobile (Expo + react-native-webview)
                    lê /api/public/app-config/:storeId na abertura
```

### Por que essa arquitetura
- **Um único app Next.js com dois route groups** (`(client)` e `(admin)`) divide auth, componentes e tipos. O admin fica isolado por middleware que confere o subdomínio e o papel do usuário.
- **Um OneSignal App por loja.** As credenciais APNs (.p8) e FCM de cada lojista são diferentes, porque cada app está em uma conta de desenvolvedor diferente. A OneSignal permite criar apps por API com a Organization API Key, já com as credenciais `apns_p8`, `apns_key_id`, `apns_team_id` e `apns_bundle_id` preenchidas. Assim o onboarding fica 100% automático.
- **Um projeto Expo (EAS) por loja.** Cada loja tem o próprio bundle ID, as próprias credenciais e o próprio histórico de builds. O `projectId` é injetado por variável de ambiente no `app.config.ts`.

---

## 2. Estrutura do repositório (monorepo)

```
storefy/
├─ CLAUDE.md
├─ PLANO-DESENVOLVIMENTO.md
├─ package.json            # pnpm workspaces + turbo
├─ turbo.json
├─ apps/
│  ├─ web/                 # Next.js 15+ (App Router), Tailwind, shadcn/ui
│  │  ├─ app/(client)/...  # painel do cliente
│  │  ├─ app/(admin)/...   # painel admin
│  │  ├─ app/api/...       # rotas de API/webhooks
│  │  └─ middleware.ts     # roteamento por subdomínio + auth
│  └─ mobile/              # Expo (managed) + expo-router
│     ├─ app.config.ts     # dinâmico por loja (env)
│     ├─ app/(tabs)/...    # abas nativas
│     ├─ src/webview/      # WebView, injeção, bridge
│     └─ scripts/          # gerar assets por loja
├─ packages/
│  ├─ config-schema/       # Zod: AppConfig (contrato painel ⇄ app)
│  ├─ db/                  # tipos gerados do Supabase + queries
│  ├─ bridge/              # contrato de mensagens WebView ⇄ nativo
│  ├─ ui/                  # componentes compartilhados (web)
│  └─ shopify/             # cliente Storefront/Admin API
├─ supabase/
│  ├─ migrations/
│  ├─ functions/           # edge functions (push-dispatch, build-worker)
│  └─ seed.sql
└─ .github/workflows/
   ├─ ci.yml
   └─ build-store-app.yml  # disparado por repository_dispatch
```

---

## 3. Contrato central: `AppConfig` (packages/config-schema)

Todo o sistema gira em torno deste objeto. O painel edita, o Supabase guarda (com versões) e o app consome.

```ts
export const AppConfig = z.object({
  version: z.number(),                    // incrementa a cada publicação
  store: z.object({
    name: z.string(),
    url: z.string().url(),                // https://loja.com.br
    domains: z.array(z.string()),         // domínios internos (resto abre externo)
  }),
  theme: z.object({
    primary: z.string(), background: z.string(), text: z.string(),
    tabBarBg: z.string(), tabBarActive: z.string(), tabBarInactive: z.string(),
    statusBar: z.enum(['light', 'dark']),
  }),
  tabs: z.array(z.object({
    id: z.string(),
    label: z.string().max(12),
    icon: z.string(),                     // nome do ícone (lucide/phosphor)
    type: z.enum(['webview', 'cart', 'account', 'notifications', 'search']),
    url: z.string().optional(),           // path relativo ou URL absoluta
    badge: z.enum(['none', 'cart_count', 'unread']).default('none'),
  })).min(2).max(5),
  webview: z.object({
    hideSelectors: z.array(z.string()),   // ex: 'header', '.site-footer', '#shopify-chat'
    customCss: z.string().default(''),
    customJs: z.string().default(''),
    pullToRefresh: z.boolean().default(true),
    userAgentSuffix: z.string().default('StorefyApp'),
  }),
  features: z.object({
    pushPromptTiming: z.enum(['onboarding', 'after_first_add_to_cart', 'manual']),
    onboardingSlides: z.array(z.object({ title: z.string(), body: z.string(), image: z.string() })).max(4),
    appBanner: z.object({ enabled: z.boolean(), text: z.string() }), // banner "baixe o app" no site
    biometricLogin: z.boolean().default(false),
    rateAppPrompt: z.boolean().default(true),
  }),
  announcement: z.object({ enabled: z.boolean(), text: z.string(), url: z.string().optional() }).optional(),
  minSupportedBuild: z.number().default(1), // força atualização se o build for antigo
});
```

**Regra:** toda mudança nesse schema passa por um teste de compatibilidade. Apps já publicados precisam continuar funcionando com configs novas. Campos novos entram sempre com `default`.

---

## 4. Modelo de dados (Supabase)

```sql
-- Multi-tenant: tudo pendura em organizations; RLS por membership.
organizations (id, name, slug, plan, status, trial_ends_at, created_at)
memberships   (org_id, user_id, role: owner|admin|member)
platform_admins (user_id, role: superadmin|support)          -- equipe Storefy

stores (id, org_id, name, shop_domain, primary_url, platform: shopify|other,
        shopify_access_token_enc, shopify_scopes, status: draft|building|in_review|live|paused,
        created_at)

apps (id, store_id, display_name, bundle_id_ios, package_android,
      expo_project_id, onesignal_app_id, onesignal_api_key_enc,
      ios_asc_app_id, apple_team_id, current_config_version,
      icon_path, splash_path, created_at)

app_configs (id, app_id, version, config jsonb, status: draft|published,
             published_by, published_at)                      -- histórico/rollback

developer_accounts (id, org_id, platform: apple|google,
                    status: pending|invited|verified|error,
                    apple_team_id, asc_key_id, asc_issuer_id, asc_key_enc,
                    apns_key_id, apns_key_enc,
                    google_service_account_enc, verified_at, notes)

builds (id, app_id, platform: ios|android, profile, eas_build_id, status:
        queued|building|finished|errored|submitted|in_review|approved|rejected,
        version, build_number, logs_url, error, config_version,
        triggered_by, created_at, updated_at)

devices (id, app_id, onesignal_subscription_id, platform, app_version,
         external_id, customer_email_hash, last_seen_at, created_at)

push_campaigns (id, app_id, title, body, image_path, deep_link, segment jsonb,
                status: draft|scheduled|sending|sent|failed|canceled,
                scheduled_at, sent_at, onesignal_notification_id,
                stats jsonb, created_by)

push_automations (id, app_id, type: welcome|abandoned_cart|back_in_stock|
                  order_shipped|inactive_7d|custom_webhook,
                  enabled, delay_minutes, title, body, deep_link, stats jsonb)

automation_runs (id, automation_id, device_id, trigger_ref, status,
                 scheduled_for, sent_at, canceled_reason)

cart_events (id, app_id, device_id, cart_token, item_count, value_cents,
             currency, event: add|update|checkout_started|purchased, created_at)

analytics_daily (app_id, date, installs, active_users, sessions,
                 push_sent, push_opened, orders_app, revenue_app_cents)

subscriptions (org_id, provider: stripe|asaas|shopify, external_id, plan,
               status, current_period_end)

audit_logs (id, actor_id, org_id, action, entity, entity_id, diff jsonb, created_at)
support_notes (id, org_id, author_id, body, created_at)
```

**Segurança**
- RLS em todas as tabelas: `org_id in (select org_id from memberships where user_id = auth.uid())`.
- Admin usa a service role **somente** em Server Actions e Route Handlers que validam `platform_admins`.
- Os segredos (`*_enc`) ficam criptografados com `pgsodium`/Vault ou AES-GCM na aplicação. A chave fica numa variável de ambiente da Vercel, e o browser nunca recebe esses valores.
- Endpoint público do app: `GET /api/public/app-config/[appId]`. Ele devolve só a config publicada, com cache de CDN (`s-maxage=60, stale-while-revalidate`).

---

## 5. App mobile — especificação técnica

### 5.1 Base
- Expo (managed workflow, SDK estável mais recente), `expo-router` com abas, `react-native-webview`, `expo-splash-screen`, `expo-image`, `expo-haptics`, `expo-linking`, `expo-local-authentication`, `expo-store-review`, `expo-updates` (OTA para correções JS), `@react-native-community/netinfo`, `react-native-onesignal` e `onesignal-expo-plugin`.
- **Atenção:** o `onesignal-expo-plugin` precisa ser o **primeiro** item do array `plugins`. Ignorar isso causa o erro "Missing Push Capability" no iOS.

### 5.2 `app.config.ts` dinâmico
```ts
const S = process.env; // injetado pelo pipeline de build
export default {
  name: S.APP_NAME, slug: S.APP_SLUG, scheme: S.APP_SCHEME,
  version: S.APP_VERSION,
  icon: `./brands/${S.STORE_ID}/icon.png`,
  splash: { image: `./brands/${S.STORE_ID}/splash.png`, backgroundColor: S.SPLASH_BG },
  ios: { bundleIdentifier: S.IOS_BUNDLE_ID, buildNumber: S.IOS_BUILD, appleTeamId: S.APPLE_TEAM_ID,
         associatedDomains: [`applinks:${S.STORE_DOMAIN}`] },
  android: { package: S.ANDROID_PACKAGE, versionCode: Number(S.ANDROID_VC),
             intentFilters: [/* https://STORE_DOMAIN autoVerify */] },
  plugins: [
    ['onesignal-expo-plugin', { mode: S.APNS_MODE ?? 'production' }], // SEMPRE PRIMEIRO
    'expo-router', 'expo-local-authentication', /* ... */
  ],
  extra: { storeId: S.STORE_ID, appId: S.STOREFY_APP_ID, apiBase: S.API_BASE,
           oneSignalAppId: S.ONESIGNAL_APP_ID, eas: { projectId: S.EAS_PROJECT_ID } },
};
```

### 5.3 Fluxo de abertura
1. A splash nativa aparece. O app carrega a `AppConfig` do cache (MMKV/AsyncStorage) e busca a versão nova em segundo plano.
2. Se `minSupportedBuild` for maior que o build atual, aparece a tela "Atualize o app".
3. No primeiro uso, entra o onboarding (slides opcionais) e em seguida o pedido de push, conforme `pushPromptTiming`.
4. Depois vêm as abas nativas. Cada aba do tipo `webview` tem **sua própria instância de WebView, mantida viva**, para que a troca de aba seja instantânea e preserve o scroll.
5. A splash só é escondida quando a primeira WebView dispara `onLoadEnd` ou quando passam 4 segundos (timeout).

### 5.4 Camada WebView (a "máscara")
- `injectedJavaScriptBeforeContentLoaded`: aplica `hideSelectors` + `customCss` com um `<style>` injetado cedo (evita o "piscar" do header do tema) e define `window.__STOREFY__ = { platform, appVersion }`.
- `injectedJavaScript` (após o DOM): instala o bridge, observa o carrinho e intercepta links.
- **Carrinho:** o script lê `fetch('/cart.js')` em eventos `add to cart` (intercepta `fetch`/`XMLHttpRequest` para `/cart/add`, `/cart/change` e `/cart/update`) e envia `CART_UPDATED {count, token, total}`. Isso alimenta o badge da aba e o `cart_events`.
- **Links:** domínios da lista `domains` abrem na WebView. Os demais (WhatsApp, Instagram, `tel:`, `mailto:`) abrem via `Linking`. O checkout (`/checkouts/`, `checkout.shopify.com`) abre **na mesma WebView da aba atual**, com `sharedCookiesEnabled` e `thirdPartyCookiesEnabled`, para manter a sessão.
- **Gestos e UX:** pull-to-refresh, swipe de voltar no iOS (`allowsBackForwardNavigationGestures`), botão voltar do Android ligado a `webview.goBack()`, barra de progresso fina no topo, haptic ao adicionar ao carrinho, `decelerationRate="normal"`, desativação de zoom por pinça (via meta viewport injetada) e bloqueio do menu de seleção de texto em áreas de UI.
- **Offline:** o NetInfo exibe uma tela nativa "Sem conexão" com botão "Tentar de novo". Um `onError` ou `onHttpError` ≥ 500 exibe a tela de erro com opção de recarregar.
- **Aba "tocada de novo":** faz scroll para o topo ou volta para a URL inicial da aba.

### 5.5 Bridge (packages/bridge) — contrato tipado
```ts
// Web → Nativo (window.ReactNativeWebView.postMessage(JSON))
type WebToNative =
 | { type: 'CART_UPDATED'; count: number; token: string; totalCents: number; currency: string }
 | { type: 'CUSTOMER_IDENTIFIED'; customerId?: string; emailHash?: string }   // via window.ShopifyAnalytics / meta
 | { type: 'CHECKOUT_STARTED'; token: string }
 | { type: 'ORDER_COMPLETED'; orderId: string; totalCents: number }        // página /thank_you
 | { type: 'HAPTIC'; style: 'light' | 'medium' | 'success' }
 | { type: 'SHARE'; url: string; title?: string }
 | { type: 'REQUEST_PUSH_PERMISSION' }
 | { type: 'OPEN_EXTERNAL'; url: string };

// Nativo → Web (webviewRef.injectJavaScript)
type NativeToWeb =
 | { type: 'APP_CONTEXT'; platform: 'ios' | 'android'; appVersion: string; pushEnabled: boolean }
 | { type: 'NAVIGATE'; path: string };
```
O site do lojista também pode chamar `window.Storefy.share()` e as demais funções por um snippet opcional, que é instalado pelo app Shopify (Theme App Extension).

### 5.6 Push no app
- `OneSignal.initialize(appId)`. Com `OneSignal.login(externalId)`, o `externalId` é o `customerId` quando conhecido. Antes disso, usa o ID anônimo do dispositivo.
- Tags: `cart_count`, `cart_value`, `last_cart_at`, `has_purchased`, `app_version`.
- Clique no push: `data.deep_link` → a aba correta executa `NAVIGATE`. Se o app estiver fechado, a config carrega primeiro e a navegação vem depois.
- Registro do device: `POST /api/public/devices` com a subscription ID. Isso permite métricas próprias e segmentação.
- **Inbox nativo** (aba opcional "Notificações"): lista as campanhas enviadas pela API da Storefy e controla lidas/não lidas localmente. Esse recurso conta muito na revisão da Apple.

### 5.7 Recursos nativos mínimos (checklist Apple 4.2)
- [ ] Tab bar nativa
- [ ] Push com deep link
- [ ] Inbox de notificações
- [ ] Tela offline nativa
- [ ] Onboarding nativo
- [ ] Compartilhamento nativo
- [ ] Haptics
- [ ] Face ID opcional
- [ ] Pedido de avaliação do app
- [ ] Universal Links

---

## 6. Push notifications — backend

### Campanhas
1. O painel cria um `push_campaign` (rascunho, depois agendado).
2. Um Vercel Cron roda a cada minuto e chama `/api/jobs/dispatch-push` com um segredo no header.
3. O job seleciona as campanhas vencidas, envia via OneSignal `POST /notifications` (com a REST API Key da loja, `target_channel: push`, filtros convertidos a partir de `segment` e `data.deep_link`) e grava `onesignal_notification_id`.
4. Um job de estatísticas, a cada 15 minutos, busca entregas e cliques na OneSignal e atualiza `stats` e `analytics_daily`.

### Automações (MVP: boas-vindas e carrinho abandonado)
- **Boas-vindas:** o registro do device cria um `automation_run` agendado para `now + delay`.
- **Carrinho abandonado:**
  - `CART_UPDATED` com `count > 0` cria ou reagenda o run (delay padrão de 60 minutos).
  - `ORDER_COMPLETED` ou o webhook Shopify `orders/create` (casando pelo `cart_token`) cancela o run.
  - Regras: no máximo 1 push de carrinho a cada 24 horas por device, e janela de silêncio das 22h às 8h no fuso da loja.
- **Fase posterior:** "de volta ao estoque", "pedido enviado" (webhook `fulfillments/create`), "inativo há 7 dias" e webhook customizado (integração com Klaviyo/Omnisend/n8n).
- **Reaproveitamento do admin Convertfy:** o módulo **Automações** do admin Convertfy (gatilho → espera → ação → estatísticas) é o modelo mental e de UI para `push_automations`. Vale copiar os componentes do editor de fluxo se forem compatíveis.

### Onboarding de push (automático)
Quando o lojista conclui a conexão da conta Apple (chave APNs .p8) e da conta Google (FCM service account):
1. `POST https://api.onesignal.com/apps` com a Organization API Key da Storefy e as credenciais.
2. O `onesignal_app_id` é salvo e a REST API Key da loja é criada e guardada criptografada.
3. Um push de teste é enviado para os devices internos do lojista (pelo app de preview).

---

## 7. Pipeline de build e publicação

1. O lojista clica em **"Publicar app"** no painel. A API valida o checklist: config publicada, ícone 1024×1024, contas Apple/Google verificadas, OneSignal ok.
2. A API cria o registro em `builds` (status `queued`) e chama o GitHub `repository_dispatch` com `{ buildId, storeId, platform }`.
3. O workflow `build-store-app.yml`:
   - baixa a config e os assets da loja (API interna autenticada) para `apps/mobile/brands/<storeId>/`;
   - gera ícones e splash nos tamanhos necessários (script com `sharp`);
   - exporta as variáveis (`APP_NAME`, `IOS_BUNDLE_ID`, `EAS_PROJECT_ID`…);
   - se for a primeira vez: cria o projeto Expo da loja (`eas init --non-interactive` com a conta de robô da Storefy) e salva o `expo_project_id`;
   - roda `eas build --platform <p> --profile production --non-interactive --no-wait` e grava o `eas_build_id`.
4. O webhook do EAS (`/api/webhooks/eas`) atualiza o status. O Supabase Realtime atualiza a tela de builds ao vivo.
5. Ao terminar: `eas submit --non-interactive` (App Store Connect API Key da conta do lojista via `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID` e `EXPO_ASC_ISSUER_ID`; Google via service account JSON). Status `submitted`.
6. O status da revisão da Apple é lido pela App Store Connect API (cron a cada hora) e passa por `in_review`, `approved` ou `rejected`. O lojista recebe e-mail e notificação no painel.

**Pontos manuais inevitáveis (guiados no painel):**
- **Apple:** o lojista cria a conta Apple Developer (US$ 99/ano). Depois gera a App Store Connect API Key (papel Admin/App Manager) e a chave APNs .p8, e faz upload no painel com um tutorial em vídeo. Alternativa: convidar a Storefy como membro do time.
- **App Store Connect:** criar o registro do app (nome, bundle ID). Isso pode ser automatizado pela API com a chave de papel Admin. Se falhar, o painel guia o passo manual.
- **Google Play:** o **primeiro upload do AAB é manual** no Play Console. O painel mostra o passo a passo e oferece o arquivo para download. Os uploads seguintes são automáticos.
- **Metadados da loja** (screenshots, descrição, política de privacidade): o painel gera uma sugestão com IA e screenshots a partir do preview. A política de privacidade fica hospedada em `storefy.com/privacy/<store>`.

**Atualizações sem novo build:** a `AppConfig` é remota (instantânea). Correções JS usam `expo-updates` (EAS Update) no canal `production-<storeId>`. Novo build só é necessário para ícone, nome, splash ou plugins nativos.

---

## 8. Integração Shopify

- **MVP (Fase 1–3):** conexão só pela URL da loja. O WebView já funciona sem API nenhuma.
- **Fase 5:** app Shopify próprio (OAuth) criado **manualmente uma única vez** no Partner Dashboard. Implementado dentro do `apps/web` com `@shopify/shopify-api`. Escopos iniciais: `read_products`, `read_orders`, `read_customers`, `read_fulfillments`.
  - Webhooks obrigatórios: `app/uninstalled` e os três webhooks de GDPR (`customers/data_request`, `customers/redact`, `shop/redact`).
  - Webhooks de produto: `orders/create`, `fulfillments/create`, `products/update` (para "de volta ao estoque").
  - Storefront API: busca de produtos e coleções no **seletor de deep link** do composer de push ("escolher produto" em vez de colar URL).
  - **Theme App Extension:** banner "Baixe nosso app" no site, snippet do bridge e smart app banner.
- **Cobrança:** para listar o app na Shopify App Store, a Shopify exige cobrança pela Billing API — confirmar as regras atuais antes de listar. Para venda direta no Brasil: Asaas ou Stripe (cartão e Pix).

---

## 9. Painéis — escopo funcional

### 9.1 Painel do Cliente (`app.storefy.com`)
| ID | Tela | Função |
|---|---|---|
| C01 | Login / Cadastro / Recuperar senha | Supabase Auth (e-mail + Google) |
| C02 | Onboarding 1 — URL da loja | Valida a URL, detecta Shopify, pega logo, cores (favicon/meta theme-color) e nome automaticamente |
| C03 | Onboarding 2 — Visual rápido | Confirma logo, cor e abas sugeridas, com preview ao vivo |
| C04 | Onboarding 3 — Preview no celular | QR code para abrir no app "Storefy Preview" + "tudo pronto" |
| C05 | Dashboard | Status do app (rascunho → loja), instalações, ativos, receita via app, próximos passos (checklist) |
| C06 | Editor do App (builder) | Layout em 3 colunas: navegação de seções · propriedades · **mockup de iPhone/Android ao vivo** · botão "Publicar alterações" |
| C06a | › Identidade | Nome, ícone, splash, cores, status bar |
| C06b | › Abas | Arrastar e soltar, ícone, rótulo, tipo, URL e badge |
| C06c | › Ajustes da WebView | Esconder elementos (seletor visual clicando no preview), CSS/JS avançado |
| C06d | › Onboarding e permissões | Slides e momento do pedido de push |
| C06e | › Recursos | Face ID, avaliação, banner no site, aviso no topo |
| C06f | › Histórico de versões | Comparar e restaurar |
| C07 | Push — Campanhas (lista) | Status, enviados, aberturas, CTR, receita |
| C08 | Push — Nova campanha | Título, texto, emoji, imagem, deep link (produto/coleção/URL), público, agendar ou enviar, **preview de notificação iOS/Android**, envio de teste |
| C09 | Push — Automações | Cards liga/desliga (boas-vindas, carrinho abandonado…) com editor de mensagem e atraso |
| C10 | Push — Detalhe da campanha/automação | Métricas e funil |
| C11 | Analytics | Instalações, ativos (DAU/MAU), sessões, pedidos e receita App x Site, push; filtro de período |
| C12 | Publicação | Checklist, contas Apple/Google (status), builds por plataforma, histórico, status da revisão, ficha da loja (textos e screenshots) |
| C13 | Conectar Apple / Google | Wizards passo a passo com vídeo, upload de chaves e validação em tempo real |
| C14 | Integrações | Shopify (OAuth), Klaviyo/Omnisend (webhook), Meta Pixel |
| C15 | Plano e cobrança | Plano atual, uso (MAU), upgrade, faturas |
| C16 | Configurações | Loja, equipe (convites e papéis), notificações por e-mail |
| C17 | Central de ajuda | Artigos e contato com o suporte |

### 9.2 Painel Admin (`admin.storefy.com`)
| ID | Tela | Função |
|---|---|---|
| A01 | Login admin | Apenas `platform_admins` + 2FA |
| A02 | Visão geral | MRR, clientes ativos, trials, apps live, builds com erro, fila de revisão |
| A03 | Clientes (lista) | Busca, filtros (plano, status, etapa do onboarding), saúde |
| A04 | Cliente (detalhe) | Abas: resumo, app/config, builds, push, cobrança, equipe, notas, logs; **"Entrar como cliente"** (impersonação auditada) |
| A05 | Fila de builds | Todos os builds, filtros, reexecutar, logs, erro |
| A06 | Revisões das lojas | Apps em revisão ou rejeitados, motivo e ações sugeridas |
| A07 | Contas de desenvolvedor | Status e validação das credenciais de cada cliente |
| A08 | Push global | Volume, falhas, custo OneSignal (MAU por app) |
| A09 | Planos e preços | Definição de planos e limites (MAU, pushes, apps) |
| A10 | Templates | Presets de abas/CSS por tema Shopify (Dawn, Impulse, Prestige…) — **acelera muito o onboarding** |
| A11 | Equipe interna | Admins e papéis |
| A12 | Logs de auditoria | Quem fez o quê |
| A13 | Configurações do sistema | Chaves, feature flags, versão mínima do app |

### 9.3 App Mobile (telas nativas)
| ID | Tela |
|---|---|
| M01 | Splash |
| M02 | Onboarding (slides) |
| M03 | Pedido de permissão de push (pré-prompt nativo bonito antes do prompt do sistema) |
| M04 | Aba WebView (Home / Coleções / Promoções) com barra de progresso |
| M05 | Carrinho (WebView `/cart` com badge) |
| M06 | Conta (WebView `/account`, com Face ID opcional) |
| M07 | Notificações (inbox nativa) |
| M08 | Busca (campo nativo que abre `/search?q=`) |
| M09 | Sem conexão |
| M10 | Erro / recarregar |
| M11 | Atualização obrigatória |
| M12 | Ajustes do app (notificações liga/desliga, versão, política de privacidade) |

### 9.4 App "Storefy Preview"
Um app interno, publicado uma única vez na conta da Storefy, que o lojista usa para **testar o próprio app antes de publicar**. Ele lê um QR code, carrega a `AppConfig` em rascunho e renderiza exatamente o mesmo shell. É o maior acelerador de venda e de usabilidade. Como é uma ferramenta de pré-visualização da Storefy, e não o app da loja, não esbarra na diretriz 4.2.6.

---

## 10. Design e usabilidade (diretrizes para o Claude Design e o Claude Code)

- **Stack UI web:** Tailwind + shadcn/ui + lucide-react + Recharts. Tipografia: Geist ou Inter. Cantos de 12–16px, sombras suaves e bastante respiro.
- **Mockup do celular** como elemento central do editor: moldura realista, alternância iPhone/Android e claro/escuro. Tudo o que é editado atualiza em menos de 100ms.
- **Salvamento automático do rascunho** e botão fixo "Publicar alterações" com contador de mudanças pendentes.
- **Estados sempre desenhados:** vazio (com CTA), carregando (skeleton), erro (com ação) e sucesso (toast).
- **Checklist de progresso** persistente no dashboard até o app estar live.
- **Linguagem simples:** nada de "bundle ID" para o lojista, e sim "identificador do app (preenchemos para você)".
- **Mobile:** o painel precisa funcionar no celular, pelo menos para dashboard, campanhas e analytics.
- **Acessibilidade:** contraste AA, foco visível, navegação por teclado.
- **App:** animações nativas de troca de aba, haptics sutis, e a splash e as abas com as cores da marca. Nada pode parecer "site dentro do app".

---

## 11. Fases de desenvolvimento

> Cada fase tem objetivo, tarefas, critério de pronto e um prompt inicial para o Claude Code.
> As **Fases 0–4 não dependem das telas finais**: o Claude Code usa shadcn/ui padrão e depois troca pelos layouts do Claude Design. Isso permite trabalhar em paralelo.

### Fase 0 — Fundação (2–3 dias)
**Tarefas**
- Monorepo pnpm + Turborepo, TypeScript strict, ESLint/Prettier, Husky.
- `apps/web` Next.js na Vercel com domínios `app.` e `admin.`, e `middleware.ts` com roteamento por subdomínio.
- Supabase: projeto, CLI, migrations iniciais (organizations, memberships, platform_admins, stores, apps, app_configs, audit_logs), RLS e geração de tipos em `packages/db`.
- Auth (e-mail + Google), layout base dos dois painéis, guarda de rota do admin.
- `packages/config-schema` com Zod + testes (Vitest).
- CI: lint, typecheck, test e build. Previews da Vercel por PR.
- Arquivo `.env.example` completo.

**Pronto quando:** login funciona nos dois subdomínios, RLS é testado (usuário A não vê a loja de B) e o CI está verde.

**Prompt:**
> "Leia CLAUDE.md e PLANO-DESENVOLVIMENTO.md. Execute a Fase 0 completa. Crie as migrations do item 4 apenas para as tabelas da Fase 0, com RLS e testes de RLS. Ao final, liste o que foi feito e o que depende de mim (chaves e domínios)."

### Fase 1 — App shell mobile (5–7 dias) ⭐ núcleo técnico
**Tarefas**
- `apps/mobile` com Expo + expo-router, com `app.config.ts` dinâmico e uma loja de exemplo em `brands/demo/`.
- Carregamento da `AppConfig` (primeiro de um JSON local, depois do endpoint), com cache e fallback.
- Abas nativas geradas pela config, com WebViews persistentes por aba.
- Injeção antecipada de CSS, `hideSelectors`, bridge tipado (`packages/bridge`), observador de carrinho com badge, interceptação de links, checkout na mesma WebView, pull-to-refresh, voltar no Android, gestos no iOS, barra de progresso, telas offline/erro/atualização, haptics e compartilhamento.
- Testar em 3 lojas reais com temas diferentes (Dawn + 2 temas pagos) e criar presets de `hideSelectors`.
- Builds de desenvolvimento via EAS (dev client) em iPhone e Android reais.

**Pronto quando:** num aparelho físico, a loja abre sem header ou footer do tema, as abas trocam instantaneamente, o badge do carrinho atualiza, o checkout funciona até a tela de pagamento sem perder o carrinho e o modo avião mostra a tela offline.

**Prompt:**
> "Execute a Fase 1 seguindo a seção 5 à risca. Comece por packages/bridge e pelo schema. Use a loja [URL] como demo. Faça testes de unidade para o parser de links e para o gerador de CSS injetado."

### Fase 2 — Config remota + Editor do App (5–7 dias)
**Tarefas**
- Tabelas `app_configs` com versões. Endpoint público `/api/public/app-config/[appId]` com cache.
- Onboarding C02–C04: detecção automática de logo, cores e nome a partir da URL (scrape server-side de `<meta>`, `theme-color`, `og:image` e `/products.json` para confirmar Shopify).
- Editor C06 com **preview ao vivo**. O preview web é um iframe com a loja e uma tab bar simulada. Para fidelidade total, usar o app Preview (C04).
- Seletor visual de elementos para esconder (modo "clicar para esconder" no iframe, via proxy de mesma origem em `/api/preview-proxy` que reescreve o HTML e injeta o script seletor).
- Publicar config (versão +1), histórico e restaurar.
- **App Storefy Preview:** mesma base do `apps/mobile` com a flag `PREVIEW_MODE`, leitor de QR e carregamento de config em rascunho com token temporário.

**Pronto quando:** o lojista muda a cor de uma aba no painel, clica em publicar, fecha e reabre o app, e a mudança aparece.

### Fase 3 — Push notifications (5–7 dias)
**Tarefas**
- Migrations: `developer_accounts`, `devices`, `push_campaigns`, `push_automations`, `automation_runs`, `cart_events`.
- Integração da OneSignal Org API (criar app por loja, salvar chaves). Para o app Preview, usar um app OneSignal da própria Storefy.
- SDK no app: initialize, login, tags, clique com deep link, inbox (M07), pré-prompt (M03).
- Endpoints `/api/public/devices` e `/api/public/events` (cart e order) com rate limit e validação por assinatura HMAC do app.
- Telas C07–C10 com preview de notificação e envio de teste.
- Jobs: dispatch (Vercel Cron a cada minuto), stats (a cada 15 minutos), automações de boas-vindas e carrinho abandonado com as regras de frequência e silêncio.

**Pronto quando:** uma campanha agendada chega no celular no horário marcado, o toque abre o produto certo, as aberturas aparecem no painel e o carrinho abandonado dispara após 60 minutos (e é cancelado quando há compra).

### Fase 4 — Build e publicação automatizados (5–8 dias)
**Tarefas**
- Tabela `builds` e wizards C13 (Apple: upload da ASC API Key + APNs .p8 com validação via App Store Connect API; Google: service account JSON com validação).
- Script de geração de assets (`sharp`): ícone iOS/Android (adaptive), splash e ícone de notificação Android.
- Workflow `build-store-app.yml` (seção 7), `eas.json` com perfis `development`, `preview` e `production`.
- Webhook do EAS, Realtime na tela C12, submit automático, cron de status da revisão.
- Geração da política de privacidade por loja e rascunho da ficha da loja.
- Canal de EAS Update por loja e botão admin "enviar correção OTA para todas as lojas".

**Pronto quando:** a partir do painel, uma loja de teste (com a sua própria conta Apple/Google) chega ao TestFlight e à trilha interna do Play sem nenhum comando manual depois do setup das chaves.

### Fase 5 — Shopify app + analytics (5–7 dias)
**Tarefas**
- OAuth Shopify, webhooks (incluindo os de GDPR), Theme App Extension (banner do app + snippet do bridge).
- Seletor de produto/coleção no composer de push (Storefront API).
- Atribuição de pedidos: `ORDER_COMPLETED` do bridge e webhook `orders/create` com a marca `source=app` (via atributo de carrinho `_storefy=1` injetado pelo bridge com `/cart/update.js`).
- `analytics_daily` + tela C11 + cards do dashboard C05.
- Automações extras: pedido enviado e de volta ao estoque.

### Fase 6 — Painel Admin completo (4–6 dias)
- Telas A02–A13, impersonação com auditoria, presets por tema (A10), feature flags e reexecução de builds.
- Reaproveitar do admin Convertfy os padrões de tabela, filtros, página de detalhe com abas e notas internas.

### Fase 7 — Cobrança, planos e limites (3–5 dias)
- Asaas/Stripe (ou Shopify Billing, se a distribuição for pela App Store da Shopify), webhooks de assinatura, trial de 14 dias e bloqueio suave (o app continua funcionando e o push/editor ficam limitados).
- Medição de MAU por app (custo OneSignal) e exibição de uso no C15.

### Fase 8 — Polimento, QA e lançamento (5+ dias)
- Trocar os layouts provisórios pelos do Claude Design (tela por tela, usando os IDs C/A/M).
- Testes E2E com Playwright (onboarding → editor → publicar config → campanha).
- Maestro para fluxos do app (abrir, trocar aba, carrinho, offline).
- Sentry (web + mobile), logs estruturados, status page.
- Revisão de segurança: RLS, segredos, rate limit, HMAC.
- **Checklist App Store** (seção 5.7) + notas de revisão padrão explicando os recursos nativos.
- Três lojas piloto (clientes Convertfy) até ficarem live nas duas lojas.

**Estimativa total:** cerca de 7 a 9 semanas para uma pessoa com Claude Code em ritmo forte. O MVP vendável (Fases 0–4) leva cerca de 4 a 5 semanas.

---

## 12. Variáveis de ambiente

```
# Web (Vercel)
NEXT_PUBLIC_SUPABASE_URL=            NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=           ENCRYPTION_KEY=
ONESIGNAL_ORG_API_KEY=               ONESIGNAL_ORG_ID=
GITHUB_DISPATCH_TOKEN=               GITHUB_REPO=
EXPO_TOKEN=                          EAS_WEBHOOK_SECRET=
CRON_SECRET=                         APP_HMAC_SECRET=
SHOPIFY_API_KEY=                     SHOPIFY_API_SECRET=      SHOPIFY_SCOPES=
ASAAS_API_KEY= / STRIPE_SECRET_KEY=  RESEND_API_KEY=
SENTRY_DSN=

# Mobile (injetado no build)
STORE_ID= STOREFY_APP_ID= API_BASE= APP_NAME= APP_SLUG= APP_SCHEME=
IOS_BUNDLE_ID= ANDROID_PACKAGE= APPLE_TEAM_ID= EAS_PROJECT_ID=
ONESIGNAL_APP_ID= SPLASH_BG= STORE_DOMAIN= APP_VERSION= IOS_BUILD= ANDROID_VC=
EXPO_ASC_API_KEY_PATH= EXPO_ASC_KEY_ID= EXPO_ASC_ISSUER_ID=
```

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Rejeição Apple 4.2 | Recursos nativos da seção 5.7, notas de revisão padronizadas, inbox e onboarding nativos, conta demo |
| Rejeição 4.2.6 | Publicação sempre na conta do lojista; nunca na conta da Storefy (exceto o app Preview) |
| Login/checkout em WebView (lojas sem Plus) | Cookies compartilhados, checkout na mesma WebView, testes por tema. Multipass só para lojas Plus |
| Tema quebra com CSS injetado | Presets por tema (A10), seletor visual e preview antes de publicar |
| Setup das chaves Apple é difícil para o lojista | Wizard com vídeo, validação em tempo real e opção "convide nossa equipe" (serviço assistido) |
| Primeiro upload do Play é manual | Passo guiado com AAB para download. Os seguintes são automáticos |
| Custo OneSignal por MAU | Medir MAU por app, repassar no plano, alertas no admin |
| Mudança no schema quebra apps antigos | `minSupportedBuild`, defaults obrigatórios, testes de compatibilidade |

---

## 14. Ordem de trabalho sugerida (você × Claude Code)

| Semana | Claude Code | Você (Claude Design) |
|---|---|---|
| 1 | Fase 0 + início da Fase 1 | Design system + C02–C06 (onboarding e editor) |
| 2 | Fase 1 | M01–M12 (telas do app) |
| 3 | Fase 2 | C05, C07–C10 (dashboard e push) |
| 4 | Fase 3 | C11–C17 |
| 5 | Fase 4 | A02–A13 (admin) |
| 6–7 | Fases 5–7 | Ajustes finos e estados vazios/erro |
| 8+ | Fase 8 (aplica os designs) | QA visual |
