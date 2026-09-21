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

**Progresso (atualizado em 17/09/2026)**

| Item | Situação |
|---|---|
| Monorepo pnpm + Turborepo, TypeScript strict, ESLint, Prettier, Husky | ✅ |
| `packages/config-schema` com Zod + 22 testes Vitest | ✅ |
| Migrations: organizations, memberships, platform_admins, stores, apps, app_configs, audit_logs | ✅ |
| RLS em todas as tabelas + 49 asserções de teste | ✅ |
| Trigger de criação da organização no cadastro | ✅ |
| Auditoria automática de criar, editar e excluir | ✅ |
| Tipos gerados em `packages/db` | ✅ |
| `apps/web` com route groups `(client)` e `(admin)` | ✅ |
| Roteamento por painel por arquivo de proxy | ✅ o plano diz `middleware.ts`; o Next 16 deprecou esse nome em favor de `proxy.ts`. Mesmo comportamento, arquivo renomeado. |
| Auth: cadastro, login, logout, recuperação, redefinição, confirmação | ✅ |
| Login com Google | ✅ código pronto, desabilitado até a credencial existir |
| Guarda do admin exigindo `platform_admins` | ✅ |
| C01, criação automática da org, CRUD de lojas, store switcher | ✅ |
| Configurações da organização e da conta | ✅ |
| Dashboard com dados reais e estado vazio | ✅ |
| A01, listas de organizações e lojas com busca e paginação | ✅ |
| Detalhe da organização e logs de auditoria | ✅ |
| `pnpm bootstrap:admin` | ✅ |
| `.env.example` completo e comentado | ✅ |
| CI no GitHub Actions | ✅ |
| README com passo a passo | ✅ |
| Specs Playwright dos fluxos principais | ✅ escritas; rodam onde houver Supabase alcançável |

**Infraestrutura**

| Item | Situação |
|---|---|
| Projeto Supabase | ✅ `storefy`, região `sa-east-1`, ref `npmftaxkhqsxppcqlbdd`. 13 migrations aplicadas, 7/7 tabelas com RLS, 21 policies, 14 triggers. |
| Advisors de segurança | ✅ De 24 achados para 7, e os 7 restantes são intencionais, com teste provando que não vazam. |

**Bloqueado, dependendo de ação humana**

| Item | O que falta |
|---|---|
| Google OAuth | Criar a credencial no Google Cloud e ligar o provedor no Supabase. O botão já existe, desabilitado com aviso. |
| Resend como SMTP | Criar a chave e configurá-la em Authentication → Emails → SMTP no Supabase. |
| Projeto Vercel | Criar o projeto e cadastrar as variáveis de ambiente. |
| `SUPABASE_SERVICE_ROLE_KEY` | Copiar do painel para o `.env.local`. O MCP não expõe essa chave, e com razão. |

**Bugs encontrados na revisão contra o banco real, e corrigidos**

| Bug | Consequência | Correção |
|---|---|---|
| `protect_last_owner` não distinguia remoção deliberada de cascata | Ninguém conseguia excluir a própria conta (a LGPD exige que seja possível), nem excluir uma organização. A limpeza dos testes E2E também falhava. | O trigger agora verifica se a conta ou a organização ainda existem: se não existem, é cascata e passa. |
| `audit_logs.org_id` com `on delete cascade` | Excluir uma organização apagava a trilha dela, e o trigger de auditoria ainda tentava gravar referindo a linha já removida — o que tornava a exclusão impossível. | FK removida. A coluna fica como registro histórico, e o nome da organização sobrevive no `diff`. |
| Organização podia ficar órfã | Excluída a conta do único owner, a organização ficaria sem dono e inacessível. | Novo trigger: promove o membro mais antigo a owner, ou remove a organização se ela ficou vazia. |
| Funções de trigger expostas como RPC | `handle_new_user`, `handle_audit` e outras eram chamáveis em `/rest/v1/rpc/`. Os auxiliares de RLS estavam abertos ao `anon`. | EXECUTE revogado. Verificado que revogar não impede o trigger de disparar. |
| `current_org_ids()` sem uso | Função `security definer` exposta sem nenhuma policy chamá-la. | Removida. |
| Embed `organizations(...)` em `audit_logs` | Sem a FK, o PostgREST não resolve o select aninhado: a tela de auditoria quebraria em runtime. | Consulta separada, com o nome histórico vindo do `diff` quando a organização já não existe. O typecheck pegou este. |
| Detecção do redirect do Next pelo `message` | Depois de excluir uma loja com sucesso, o usuário veria um toast vermelho falso. | Passa a checar o `digest`, que é como o Next sinaliza. |
| Busca e paginação do admin sem limite | `?pagina=99999999999` estouraria o offset e devolveria 400; `%` na busca casaria com tudo. | Extraído para `lib/listagem.ts`, com teto de página e escape de curinga, coberto por 15 testes. |
| Limpeza dos testes E2E deixava auditoria | Sem a FK, a trilha não cai por cascata e o dado de teste sobraria. | A limpeza coleta as organizações antes de excluir os usuários e remove a trilha delas. |

**Decisões tomadas nesta fase**

- Papéis: `owner` exclui loja e organização e gere membros; `admin` cria e edita lojas e dados da organização; `member` só lê.
- Loja ativa em cookie `httpOnly`, revalidado no servidor a cada request.
- `slug` da organização derivado do nome, com sufixo numérico em colisão.
- Auditoria por triggers no Postgres, e não na aplicação, para pegar também escrita fora do painel.
- Zod 4 com `z.email()` no lugar do `.email()` encadeado, que foi deprecado.
- Organização criada no cadastro por trigger; loja criada já gera o registro em `apps` (1:1 nesta fase).
- `apps` e `app_configs` entram como schema + RLS, sem tela: a interface é da Fase 2.

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

**Progresso (18/09/2026)**

| Item | Situação |
|---|---|
| `packages/bridge` — contrato tipado da seção 5.5 | ✅ com validação em runtime, não só tipo |
| Parser de links (seção 5.4) | ✅ 24 testes |
| Gerador de CSS injetado (seção 5.4) | ✅ 20 testes |
| Contrato de mensagens | ✅ 18 testes |
| `apps/mobile` com Expo SDK 57 + `app.config.ts` dinâmico | ✅ estrutura e configuração de build |
| Ordem dos plugins nativos (regra 5) | ✅ garantida por função, com 8 testes |
| Carregamento da config com cache e fallback (seção 5.3) | ✅ 15 testes |
| Config da loja demo (Oak Vintage) | ✅ valida no `AppConfigSchema` |
| Resolução das abas a partir da config (seção 5.2) | ✅ 19 testes |
| Observador de carrinho (script injetado, seção 5.4) | ✅ 29 testes, sete mutações detectadas |
| `window.Storefy` para o tema do lojista (seção 5.5) | ✅ 11 testes rodando o script |
| Ações nativas do bridge (vibrar, compartilhar, abrir fora) | ✅ 11 testes |
| Telas do app e abas nativas | ✅ barra escrita à mão, ver decisão abaixo |
| WebViews persistentes por aba | ✅ `display: none`, instância viva |
| Badge do carrinho ligado ao observador | ✅ com 99+ e leitura de tela |
| Roteador de links (checkout na mesma WebView) | ✅ 7 testes |
| Pull-to-refresh, voltar no Android, gestos no iOS | ✅ |
| Barra de progresso | ✅ |
| Telas offline, erro, atualização obrigatória e sem config | ✅ nativas |
| Onboarding nativo (passo 3 da seção 5.3) | ✅ 4 testes na decisão |
| Deep link por Universal Link | ✅ inclusive na abertura a frio |
| Haptics, compartilhar e pedido de avaliação | ✅ |
| Empacotamento (`expo export`) no `pnpm build` | ✅ Android e iOS |
| Caixa de avisos nativa (M07) | ⬜ Fase 3, junto com o push |
| Face ID opcional (`features.biometricLogin`) | ⬜ Fase 2, com a área de conta |
| Presets de `hideSelectors` por tema | ⬜ exige renderizar lojas reais |
| Testar em 3 lojas reais | ⬜ depende de aparelho físico e de rede até as lojas |
| `eas.json`, `owner` e variáveis de build por loja | ✅ 5 testes, `BUILD.md` com os comandos |
| Builds de desenvolvimento via EAS | ⬜ o container não alcança `expo.dev`; rodar na máquina do time |

**Decisões desta fase**

- O bridge valida em runtime com Zod, e não confia só no tipo do TypeScript.
  A página que manda as mensagens não é nossa: roda o tema do lojista, os apps
  que ele instalou e scripts de terceiros, e qualquer um deles pode chamar
  `window.ReactNativeWebView.postMessage` com o que quiser.
- `SHARE` e `OPEN_EXTERNAL` aceitam apenas `http` e `https`. `z.url()` sozinho
  aceita `javascript:` e `intent://` — são URLs válidas pela especificação — e
  as duas chegariam ao `Linking.openURL`. No Android, `intent://` dispara
  activity arbitrária.
- O CSS injetado sai com **uma regra por seletor**, não uma lista separada por
  vírgula: o navegador descarta a regra inteira quando um seletor da lista é
  inválido, então um `.header,,` digitado no painel faria nada mais ser
  escondido, sem aviso.
- A comparação de domínio é por limite de ponto. `endsWith` ingênuo deixaria
  `minha-loja.com.br.evil.com` passar como se fosse a loja.
- O observador de carrinho guarda a `fetch` original **antes** de embrulhar.
  Capturada depois, a própria leitura de `/cart.js` passaria pelo observador,
  que leria `/cart.js` de novo, em laço infinito dentro da loja do cliente.
  O teste que prova isso roda o script gerado num contexto do `node:vm`, com
  `fetch`, `XMLHttpRequest` e relógio falsos — sintaxe não bastaria.
- `CART_UPDATED` passou a exigir só `count`. Quem responde `/cart.js` é o tema
  do lojista, com proxy, cache de borda e apps de terceiro no caminho; quando um
  campo não vem, o observador **omite** em vez de completar. Dizer
  `currency: 'BRL'` para uma loja em dólar, ou `totalCents: 0` para um carrinho
  cheio, seria dado falso gravado em `cart_events` (regra 1). Sem `count` não há
  mensagem: é o número do badge, e é a única coisa que a mensagem serve para
  dizer.
- `@types/node` entrou no `apps/mobile` por causa de `app.config.ts` e dos
  testes, e junto veio o risco de alguém importar `node:*` em código que roda no
  aparelho — compila e quebra na mão do cliente. O eslint do pacote barra
  `node:*` fora dos testes.
- **A barra de abas é escrita à mão, e não o `Tabs` do expo-router.** As abas
  vêm da config remota: de duas a cinco, com rótulo, ícone e ordem trocados sem
  build novo. O roteador de arquivos precisa de uma rota por aba, escrita antes
  de existir a loja, o que obrigaria a criar cinco rotas fantasma e esconder as
  que sobrassem. Em troca, tudo que o `Tabs` daria de graça — papel de
  acessibilidade, estado selecionado, área segura, alvo de toque de 44pt — está
  escrito na mão em `src/navegacao/barra-de-abas.tsx`.
- **Nada de tela "em breve".** O que este build não implementa não aparece: sem
  o OneSignal ligado (`IMPLEMENTADO.push`), a aba de avisos some da barra e
  `acaoParaMensagem` devolve `ignorar` com motivo escrito. Pedir permissão de
  push sem ter onde registrar o aparelho queimaria a única chance que o iOS dá.
- **Três injeções, e não uma.** Um `customJs` com erro de sintaxe derruba o
  script inteiro em que estiver, porque o parse acontece antes de a primeira
  linha rodar. Junto do nosso, um ponto e vírgula errado no painel apagaria o
  badge e o compartilhar da loja toda, sem pista nenhuma. O JavaScript do
  lojista vai numa chamada só dele, depois da carga.
- **`pnpm build` empacota o app** para Android e iOS. Empacotar de verdade achou
  três defeitos que teste de unidade nenhum pegaria: `src/app/` virava a raiz de
  rotas do expo-router (que prefere `src/app` a `app/`) e o app sumia;
  `app.config.ts` importava TypeScript sem extensão, que o carregador do Expo
  resolve com o `require` do Node; e o `react-native` estava em 0.87.1, à frente
  do 0.86.3 que o SDK 57 empacota — e o 0.87 removeu o `rn-get-polyfills` que o
  Metro do Expo ainda procura.
- **O roteador de links recebe a URL ATUAL, não a URL alvo.** `destinoDoLink`
  usa o host da página corrente como domínio permitido, para não quebrar a
  navegação num subdomínio que o lojista esqueceu de listar. Passar o alvo ali
  — que é o que a WebView entrega de mão beijada — faz todo link virar "mesmo
  domínio", e Instagram, WhatsApp e concorrente abrem dentro do app sem barra de
  endereço. `src/webview/navegacao.ts` existe para essa troca não acontecer sem
  querer.
- Ícone e splash da loja são opcionais no `expo start` local e **obrigatórios**
  no build por loja. Sem isso, um app de cliente chegaria à App Store com o
  ícone padrão do Expo e ninguém perceberia antes da revisão.

### Fase 2 — Config remota + Editor do App (5–7 dias)
**Tarefas**
- Tabelas `app_configs` com versões. Endpoint público `/api/public/app-config/[appId]` com cache.
- Onboarding C02–C04: detecção automática de logo, cores e nome a partir da URL (scrape server-side de `<meta>`, `theme-color`, `og:image` e `/products.json` para confirmar Shopify).
- Editor C06 com **preview ao vivo**. O preview web é um iframe com a loja e uma tab bar simulada. Para fidelidade total, usar o app Preview (C04).
- Seletor visual de elementos para esconder (modo "clicar para esconder" no iframe, via proxy de mesma origem em `/api/preview-proxy` que reescreve o HTML e injeta o script seletor).
- Publicar config (versão +1), histórico e restaurar.
- **App Storefy Preview:** mesma base do `apps/mobile` com a flag `PREVIEW_MODE`, leitor de QR e carregamento de config em rascunho com token temporário.

**Pronto quando:** o lojista muda a cor de uma aba no painel, clica em publicar, fecha e reabre o app, e a mudança aparece.

**Progresso (19/09/2026)**

| Item | Situação |
|---|---|
| `app_configs` com versões, publicar e restaurar | ✅ função no Postgres, 28 asserções de RLS |
| Endpoint público `/api/public/app-config/[appId]` | ✅ com ETag, 304 e cache por situação |
| Config inicial de toda loja | ✅ app que já funciona, 12 testes |
| Editor C06 — aparência, abas, loja, recursos, versões | ✅ conferido no navegador em 1280 e 390 px |
| Prévia ao vivo com a tab bar real | ✅ por `/api/preview-proxy`, sem `allow-same-origin` |
| Seletor visual de elementos | ✅ 13 testes executando o script num DOM real |
| Detecção automática de nome, cor e logo (C02–C04) | ✅ 24 testes |
| Publicar, histórico e restaurar na tela | ✅ com confirmação |
| App Storefy Preview (QR + config em rascunho) | ✅ mesmo código, `PREVIEW_MODE=1` |
| Verificação ponta a ponta num aparelho | ⬜ depende de aparelho físico |

**Decisões desta fase**

- **O iframe da prévia NÃO recebe a origem do painel.** O documento sai do nosso
  domínio, e deixá-lo manter essa origem daria ao tema do lojista — e a todo
  script de terceiro instalado nele — acesso aos cookies e ao armazenamento de
  quem está editando. O sandbox fica sem `allow-same-origin` e o que esconder
  viaja por `postMessage`.
- **O proxy de prévia é o oposto de um proxy aberto:** exige sessão, a loja
  precisa ser de uma organização do usuário (quem filtra é a RLS), o alvo sai do
  endereço cadastrado no banco e nunca de uma URL do navegador, e hospedeiro
  interno é recusado antes de a requisição sair. Cada redirecionamento é
  reconferido: um `Location` para `169.254.169.254` é o jeito clássico de
  contornar validação feita só na primeira URL.
- **Publicar é uma função no Postgres**, e não três queries no servidor web: são
  quatro escritas que só fazem sentido juntas, e uma falha no meio deixaria o app
  da loja sem config publicada. É `security invoker`, então a autorização
  continua sendo a RLS.
- **Restaurar carrega no rascunho e não publica.** Voltar ao ar uma config de
  semanas atrás num clique é o tipo de botão que derruba a loja de um cliente.
- **Nada é chutado na detecção.** Quando a página não diz o nome, o campo volta
  vazio; o domínio virando "nome provável" apareceria como certeza e o app iria
  para a loja de aplicativos com ele.
- **O seletor visual usa uma classe só.** A segunda quase sempre é modificador de
  estado, que some quando o estado muda. Classe com hash é descartada: muda no
  próximo deploy do tema e o que foi escondido volta sem aviso.
- Os nomes de ícone viraram contrato em `packages/config-schema`: o painel
  desenha com lucide e o app com Ionicons, e cada lado tem teste cobrando que
  nenhum nome da lista fique sem desenho.
- O schema apertou cor, id e rótulo de aba **antes de existir config publicada**,
  que é a única janela em que isso não quebra a regra de compatibilidade.
- **Só o app de prévia leva a câmera.** `expo-camera` no array de plugins põe
  "este app quer usar sua câmera" no Info.plist; num app de loja isso aparece
  para o cliente final sem nenhuma função que justifique, e é pergunta certa na
  revisão da Apple. O teste do `montarPlugins` cobra as duas situações.
- **O código de prévia é guardado como hash.** Ele dá acesso ao rascunho de uma
  loja sem login; em claro, um vazamento do banco viraria acesso aos rascunhos
  de todos os clientes de uma vez. O valor em claro existe no instante em que é
  sorteado — dentro do banco — e vai direto para o QR.
- Código errado, vencido e app sem rascunho dão a MESMA resposta no endpoint da
  prévia. Separar os casos contaria a quem estivesse adivinhando quais códigos
  existem.
- `features.biometricLogin` continua sem tela no editor: nada no app o consome
  ainda, e um botão que não faz nada é o que a regra 3 proíbe. Entra junto com a
  área de conta.

### Fase 3 — Push notifications (5–7 dias)
**Tarefas**
- Migrations: `developer_accounts`, `devices`, `push_campaigns`, `push_automations`, `automation_runs`, `cart_events`.
- Integração da OneSignal Org API (criar app por loja, salvar chaves). Para o app Preview, usar um app OneSignal da própria Storefy.
- SDK no app: initialize, login, tags, clique com deep link, inbox (M07), pré-prompt (M03).
- Endpoints `/api/public/devices` e `/api/public/events` (cart e order) com rate limit e validação por assinatura HMAC do app.
- Telas C07–C10 com preview de notificação e envio de teste.
- Jobs: dispatch (Vercel Cron a cada minuto), stats (a cada 15 minutos), automações de boas-vindas e carrinho abandonado com as regras de frequência e silêncio.

**Pronto quando:** uma campanha agendada chega no celular no horário marcado, o toque abre o produto certo, as aberturas aparecem no painel e o carrinho abandonado dispara após 60 minutos (e é cancelado quando há compra).

**Progresso (19/09/2026)**

| Item | Situação |
|---|---|
| Migrations de push, eventos e contas de desenvolvedor | ✅ 7 enums, 6 tabelas, RLS e auditoria |
| Colunas de segredo fechadas por `grant` coluna a coluna | ✅ com guarda que vale para o schema inteiro |
| `/api/public/devices` e `/api/public/events` com HMAC e rate limit | ✅ assinatura sobre o texto do corpo |
| `/api/public/inbox` para a caixa de avisos | ✅ só o que aquele aparelho pode ver |
| SDK no app: initialize, login, tags, deep link | ✅ 267 testes no app |
| SHA-256 e HMAC em TypeScript puro | ✅ conferidos contra o `node:crypto` |
| Pré-prompt de permissão (M03) | ✅ respeita `features.pushPromptTiming` |
| Caixa de avisos nativa (M07) | ✅ lidos controlados no aparelho |
| Automação de boas-vindas | ✅ nasce com o aparelho, uma vez só |
| Automação de carrinho abandonado | ✅ reagenda, cancela na compra e no carrinho vazio |
| Janela de silêncio e teto de 24h | ✅ conferidos no agendamento E no envio |
| Telas C07–C10 com prévia de notificação | ✅ conferidas no navegador em 1280 e 390 px |
| Envio de teste para um aparelho | ✅ com limite de dez por minuto |
| Jobs de dispatch e de estatísticas | ✅ Vercel Cron, reserva atômica no banco |
| Criação do app da loja na OneSignal | ⚠️ implementada e testada, mas nunca executada contra a API real — depende da `ONESIGNAL_ORG_API_KEY` e das credenciais Apple/Google (assistentes C13, Fase 4) |
| Verificação ponta a ponta num aparelho | ⬜ depende de aparelho físico e das chaves de push |

**Decisões desta fase**

- **A reserva do envio acontece dentro do banco**, num `update ... returning`
  com `for update skip locked`. Duas execuções sobrepostas do cron mandando a
  mesma campanha significam a base inteira de uma loja recebendo o push duas
  vezes, e isso não tem desfazer. Ler no servidor web e marcar depois deixaria
  justamente a janela entre as duas coisas.
- **Falha permanente e falha passageira têm destinos diferentes.** Chave errada
  vira `failed` com o motivo, que o lojista vê; rede caindo não marca nada e a
  linha volta à fila sozinha. Marcar uma queda de rede como falha jogaria fora
  uma campanha que ia sair no minuto seguinte.
- **A janela de silêncio e o teto de 24h são reconferidos no envio**, e não só
  no agendamento: entre agendar e enviar passa pelo menos uma hora, e um job
  atrasado por queda acordaria o cliente às três da manhã.
- **A assinatura do app é sobre o TEXTO do corpo**, nunca sobre o objeto
  parseado. Conferir depois do parse deixaria passar dois corpos diferentes com
  o mesmo JSON — e trocar `appId` é escrever na loja de outro cliente.
- **App inexistente e assinatura inválida dão a mesma resposta.** Diferenciar
  os dois transformaria o endpoint público num verificador de quais lojas
  existem.
- **SHA-256 e HMAC escritos à mão.** O React Native não tem `node:crypto`, e
  `expo-crypto` só digere string — HMAC precisa de bytes arbitrários, que se
  perdem no caminho do UTF-8. O teste compara com o `node:crypto` em centenas
  de entradas, incluindo as fronteiras de padding e de tamanho de chave.
- **O deep link do push só abre caminho da própria loja.** Uma notificação é
  texto escrito num painel; abrir host de terceiro numa WebView sem barra de
  endereço, com o ícone da loja em volta, é uma tela de phishing pronta. A
  comparação usa o `mesmoDominio` do `@storefy/bridge`, e não uma segunda
  cópia.
- **Estatística que não chegou é `null`, e a tela mostra traço.** "0 aberturas"
  é uma afirmação sobre o desempenho da campanha; dita antes de o número
  chegar, faz o lojista concluir que ela fracassou.
- **Campanha com segmento não entra na caixa de avisos de ninguém.** A
  segmentação acontece dentro do OneSignal e a Storefy não guarda quem estava
  nela; mostrá-la a todos poria na caixa de um cliente uma oferta que não era
  para ele, muitas vezes com preço diferente.
- **`rate_limits` nasce com RLS ligada e sem policy.** No PostgREST toda tabela
  de `public` é uma rota; sem isso, qualquer visitante leria quantas
  requisições cada app faz por minuto.
- **Os stubs de teste passaram a reproduzir o grant de EXECUTE do Supabase.**
  Sem isso, um `revoke ... from public` sozinho fechava a função no teste local
  e a deixava aberta em produção.
- **Só as duas automações do MVP aparecem na tela.** "De volta ao estoque",
  "pedido enviado" e "inativo há 7 dias" estão no plano para depois, e um card
  deles agora seria um botão que não faz nada.

**Achado que fica para a Fase 6**

A tela de logs do admin diz "Quem fez o quê", mas não tem coluna de autor —
mostra quando, organização, ação, entidade e campos alterados. O `actor_id` é
gravado; falta um jeito de resolver vários ids em e-mail de uma vez, no padrão
das outras funções `admin_*`. Fica para a Fase 6, que é a do painel admin
completo. Vale notar que uma ação feita pela service role (como ligar as
notificações) grava `actor_id` nulo de qualquer forma: quem agiu foi o sistema,
a pedido de alguém.

### Fase 4 — Build e publicação automatizados (5–8 dias)
**Tarefas**
- Tabela `builds` e wizards C13 (Apple: upload da ASC API Key + APNs .p8 com validação via App Store Connect API; Google: service account JSON com validação).
- Script de geração de assets (`sharp`): ícone iOS/Android (adaptive), splash e ícone de notificação Android.
- Workflow `build-store-app.yml` (seção 7), `eas.json` com perfis `development`, `preview` e `production`.
- Webhook do EAS, Realtime na tela C12, submit automático, cron de status da revisão.
- Geração da política de privacidade por loja e rascunho da ficha da loja.
- Canal de EAS Update por loja e botão admin "enviar correção OTA para todas as lojas".

**Pronto quando:** a partir do painel, uma loja de teste (com a sua própria conta Apple/Google) chega ao TestFlight e à trilha interna do Play sem nenhum comando manual depois do setup das chaves.

**Progresso (19/09/2026)**

| Item | Situação |
|---|---|
| Tabela `builds`, enums e auditoria da criação | ✅ RLS só de leitura: criar e atualizar é caminho de servidor |
| Assistentes C13 (Apple e Google) com validação real antes de gravar | ⚠️ implementados e testados; a chamada à API da Apple e à do Google nunca rodou daqui (rede bloqueada) |
| Geração de assets (`pnpm assets`) com ícone, adaptativo, notificação e splash | ✅ recusa o que a Apple recusaria, em segundos |
| Envio do ícone e da splash pelo painel, em bucket privado | ✅ caminho `<store_id>/…`, com policy por loja |
| Checklist de publicação e botão de publicar (C12) | ✅ o checklist é refeito no servidor antes de disparar |
| `build-store-app.yml` e `/api/internal/build` | ⚠️ escritos e testados; nunca executados no GitHub Actions |
| Criação do projeto Expo da loja no primeiro build (`eas init`) | ⚠️ escrita; quando não der, o workflow para com a mensagem dizendo o que fazer, e o build vira "falhou" com ela na tela |
| Webhook do EAS (`/api/webhooks/eas`) | ⚠️ assinatura, tradução de status e trava de reentrega testadas; nunca recebeu um POST do Expo de verdade |
| Realtime na tela C12 | ✅ conferido no navegador nos dois caminhos: canal de pé (recarrega no evento, sem consulta de reserva) e canal bloqueado (recarrega a cada 20s) |
| `eas submit` automático (`submit-store-app.yml`) | ⚠️ escrito e testado; o disparo sai do webhook, porque o build roda com `--no-wait` |
| Primeiro envio manual ao Play Console, guiado na tela | ✅ passo a passo com o arquivo para baixar, conferido no navegador em 1280 e 390 px |
| Cron de status da revisão (App Store Connect) | ⚠️ escrito e testado; a consulta à API da Apple nunca rodou daqui (rede bloqueada) |
| Aviso por e-mail da decisão da Apple (Resend) | ⚠️ escrito e testado; depende de `RESEND_API_KEY` e `EMAIL_REMETENTE`. Sem eles o aviso NÃO é descartado: volta para a fila e sai quando as chaves existirem |
| Política de privacidade por loja (`/privacy/<store>`) | ✅ pública, sem login, montada a partir do que o app realmente faz — sem push ligado, a seção de notificações não existe |
| E-mail de atendimento da loja | ✅ campo na edição da loja; sem ele a política manda o cliente pelo site, em vez de inventar um endereço |
| Rascunho da ficha do app | ✅ cinco campos, cada um no limite da loja de aplicativos, com botão de copiar |
| Capturas de tela | ✅ a tela diz a medida exata de cada loja e como tirá-las no aparelho. A Storefy NÃO as gera: uma imagem montada no computador não tem a barra de status nem a tab bar nativas, e a Apple recusa screenshot que é claramente montagem — a recusa chega dias depois sem dizer qual imagem estava errada |
| Canal de EAS Update por loja | ✅ `production-<storeId>`, um por loja: o pacote carrega o segredo daquela loja |
| Projeto EAS por loja | ✅ slug `storefy-<storeId>`, derivado no servidor e injetado como `APP_SLUG`; o workflow cria o projeto na primeira publicação e registra nele o webhook de status. Um slug fixo faria a segunda loja entrar no projeto da primeira, e as duas dividiriam o canal de update |
| Botão admin "enviar correção OTA para todas as lojas" | ⚠️ tela, trava de rodada única, trilha de auditoria e workflow em matriz escritos e testados; o `eas update` nunca rodou daqui |
| Chegar ao TestFlight e à trilha interna do Play | ⬜ depende das contas Apple/Google de uma loja real e dos segredos do repositório |

> **O que trava o ponta a ponta:** `EXPO_TOKEN`, `EXPO_OWNER`, `GITHUB_DISPATCH_TOKEN`,
> `GITHUB_REPO`, `BUILD_API_SECRET`, `EAS_WEBHOOK_SECRET`, `STOREFY_API_URL`,
> `RESEND_API_KEY` e `EMAIL_REMETENTE`. O `EAS_WEBHOOK_SECRET` é um valor que NÓS geramos
> (`openssl rand -hex 32`) e que vive nos dois lados: o workflow o usa para registrar o
> webhook no projeto EAS de cada loja, e a rota o usa para conferir a assinatura. Sem ele
> a rota responde 503 de propósito, em vez de aceitar qualquer POST. Não há
> `EAS_PROJECT_ID` de configuração: o projeto é por loja, criado pelo workflow na primeira
> publicação e guardado em `apps.expo_project_id`. As duas do e-mail são as únicas cuja
> ausência não perde nada: o aviso volta para a fila e sai no ciclo seguinte, quando elas
> existirem.

### Fase 5 — Shopify app + analytics (5–7 dias)
**Tarefas**
- OAuth Shopify, webhooks (incluindo os de GDPR), Theme App Extension (banner do app + snippet do bridge).
- **Conexão pelo app do próprio lojista** (`grant_type=client_credentials`), ao lado do OAuth: o lojista cria um app na conta Shopify dele e cola Client ID + Client Secret. Não passa por revisão da Shopify, então é o caminho que funciona ANTES da aprovação do app público — e continua valendo depois, para quem preferir. Muda três coisas: o token vence em 24h e é renovado no ponto de uso (sem job — token só serve para chamada nossa, e renovar o de uma loja parada seria gasto à toa); o webhook passa a ser assinado pelo segredo DAQUELA loja, e não por um segredo único da Storefy; e um domínio Shopify só pode estar conectado a uma loja do painel por vez, por índice único parcial — duas deixariam o webhook sem dono.
- Seletor de produto/coleção no composer de push (pela Admin API, e não pela Storefront: o token do Admin já está guardado desde o OAuth e o escopo `read_products` já cobre a busca — a Storefront exigiria um token a mais, outra tela de configuração e outra coisa para o lojista errar).
- Atribuição de pedidos: `ORDER_COMPLETED` do bridge e webhook `orders/create` com a marca `source=app` (via atributo de carrinho `_storefy=1` injetado pelo bridge com `/cart/update.js`).
- `analytics_daily` + tela C11 + cards do dashboard C05.
- Automações extras: pedido enviado e de volta ao estoque.

**Pronto quando:** o lojista conecta a loja em dois cliques, e o painel mostra quanto o app vendeu — separado do site — com o número batendo com o extrato da Shopify.

**Progresso (21/09/2026)**

| Item | Situação |
|---|---|
| OAuth da Shopify (`/api/shopify/install` e `/callback`) | ⚠️ as quatro conferências do retorno (assinatura, domínio, `state` em cookie e loja de origem) escritas e testadas; nunca rodou contra a Shopify de verdade, porque falta o app no Partner Dashboard |
| Tela C14 — Integrações, com conectar, reconectar e desconectar | ✅ conferida no navegador em 1280 e 390 px nos seis estados, com o POST e a validação do domínio |
| Webhooks, incluindo os três de privacidade da Shopify | ⚠️ uma rota para todos os tópicos, com assinatura base64 sobre o corpo cru; tópico desconhecido responde 200 de propósito, porque uma cadeia de 4xx faz a Shopify DESATIVAR o webhook da loja |
| Atribuição de pedido pelo atributo de carrinho `_storefy` | ⚠️ a corrente inteira existe: o app grava o atributo, a Shopify carrega até o pedido e `orders/create` o lê sem duplicar na reentrega. Nunca rodou contra uma loja de verdade |
| `shop_orders` e `analytics_daily` com RLS | ✅ leitura só para membros da organização; quem escreve é o webhook e o job, com a service role |
| Desconectar para de receber pedido | ✅ apaga os webhooks na Shopify com o token que ainda existe, e só então apaga o token; `app_da_loja_shopify` passa a não achar a loja |
| `shop/redact` e `app/uninstalled` | ✅ tratados ANTES de procurar o app: precisam funcionar para quem já desinstalou e não está mais no nosso banco |
| Segredo não se escreve pelo painel | ✅ `insert`/`update` das colunas `_enc` revogados de `authenticated` e `anon`, com asserção que vale para o schema inteiro |
| Injeção do `_storefy=1` no carrinho pelo app | ✅ grava depois da mudança de carrinho e ao abrir `/cart`, uma vez por página, com o `fetch` original. Os 22 testes EXECUTAM o script gerado num `node:vm`, e cada decisão foi conferida por mutação |
| `store.platform` na `AppConfig` | ✅ campo novo com `default('shopify')` e teste de compatibilidade: config publicada antes continua válida e a atribuição não se desliga sozinha |
| Job de agregação do `analytics_daily` | ✅ recalcula (não acumula) os últimos dias no fuso de CADA loja, de hora em hora. Dia sem número não vira linha, e linha que zerou é apagada |
| `device_days`, a fonte de ativos e sessões | ✅ uma linha por aparelho por dia, escrita junto com o ping do app. `last_seen_at` sozinha daria ativos errados para qualquer dia passado |
| Tela C11 — Analytics | ✅ receita app x site, uso do app e notificações, com período de 7, 30 ou 90 dias na URL. Conferida no navegador em 1280 e 390 px |
| Cards de receita no C05 | ✅ resumo de 30 dias da loja ativa. Some quando não há número: um zero grande na primeira tela diria ao lojista que o app fracassou antes de ele publicar |
| Ativos do período (MAU) | ✅ distinto de `device_days`, por `ativos_no_periodo`. Somar `active_users` daria "aparelho-dias" — quem abre todo dia contaria trinta vezes |
| Seletor de produto/coleção no composer de push | ⚠️ busca produto e coleção na loja e preenche o deep link; conferido no navegador em 1280 e 390 px com a Shopify falsa. Nunca rodou contra uma loja de verdade |
| Automação "pedido enviado" | ✅ `fulfillments/create` avisa o APARELHO que fez o pedido, achado pelo token do carrinho. Um aviso por pedido, mesmo com o pedido saindo em três caixas, e respeitando o silêncio noturno |
| Automação "de volta ao estoque" | ⚠️ ponta a ponta: botão no tema › bridge › endpoint assinado › `products/update` › push com link do produto. Nunca rodou contra uma loja de verdade |
| O botão "me avise" só dentro do app | ✅ a inscrição é por aparelho; fora do app não há para onde mandar a notificação, e o botão não aparece |
| A inscrição é consumida no aviso | ✅ quem pediu recebe uma vez e sai da lista. Com a automação desligada nada é avisado E nada é apagado: o pedido espera o lojista ligar |
| Bloco "avise-me quando voltar" no tema | ⚠️ escrito e testado (o script roda num DOM falso); falta o `shopify app deploy` |
| Theme App Extension — banner do app | ⚠️ bloco, script e endereço público escritos e testados (o script roda num DOM falso, e cada guarda foi conferida por mutação). Falta o `shopify app deploy`, que depende do app no Partner Dashboard |
| Banner sem configuração no editor de tema | ✅ o bloco sabe só o domínio da loja, que o Liquid dá de graça, e pergunta o resto ao servidor. O lojista não cola link de loja de aplicativos em lugar nenhum |
| Smart App Banner do iOS | ✅ no iPhone entra a meta `apple-itunes-app` e NÃO desenhamos tarja por cima: o convite nativo mostra ícone, nota e "abrir" quando o app já está instalado |

> **O que trava o ponta a ponta:** `SHOPIFY_API_KEY` e `SHOPIFY_API_SECRET` de um app criado
> uma única vez no Partner Dashboard, com a URL de retorno apontando para
> `https://app.storefy.com.br/api/shopify/callback`. Sem eles a tela C14 diz "em preparação"
> em vez de mostrar um botão que leva a erro, e o webhook responde 503 — e não 200 —, para a
> Shopify reentregar quando o ambiente existir, em vez de dar o evento por entregue.

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

## 11.1 Reaproveitamento — o que existe nos nossos repositórios

Levantamento feito em 18/09/2026 sobre `matheusmarques6/*`. Registrado aqui
para não repetir a busca a cada fase.

### `admin-convertfy` — mesma stack, aproveitável de verdade

Next 15 · React 19 · Supabase SSR · Tailwind · Radix · Zod 4 · shadcn.
É a stack do Storefy, então o código é adaptável quase direto.

| O que | Onde | Para qual fase |
|---|---|---|
| `reactflow` montado para editor de fluxo | `src/components` | **Fase 3** — editor de `push_automations` (gatilho → espera → ação), exatamente o que a seção 6 pede |
| `@hello-pangea/dnd` para arrastar e soltar | `src/components` | **Fase 2** — reordenar abas em C06b |
| `save-bar.tsx` | `src/components/ui` | **Fase 2** — a barra fixa "Publicar alterações" com contador de pendências (seção 10) |
| `data-table.tsx` + `@tanstack/react-virtual` | `src/components/ui` | **Fase 6** — tabelas do admin com virtualização |
| `recharts` + `kpi-card.tsx` + `period-picker.tsx` | `src/components/ui` | **Fase 5** — analytics C11 |
| `date-range-picker.tsx`, `filter-select.tsx`, `status-tabs.tsx` | `src/components/ui` | **Fases 5–6** — filtros de listagem |
| `command-palette.tsx` | `src/components/ui` | **Fase 6** — busca rápida no admin |

Já aproveitado nesta fase: o padrão de `loading.tsx` por rota com
`PageSkeleton`, e a acessibilidade do esqueleto (`role="status"`,
`aria-live="polite"` e texto `sr-only` anunciando uma vez, com os retângulos
em `aria-hidden`).

### `app.fy22` — mesmo produto, arquitetura diferente

Tentativa anterior de transformar loja em app. **O shell mobile não serve**:
usa Capacitor, e a seção 5 do nosso plano é Expo + react-native-webview. O
`TenantConfig` deles também é bem mais pobre que o nosso `AppConfig` — sem
abas, sem `hideSelectors`, sem onboarding, sem `minSupportedBuild`.

Vale, porém:

| O que | Onde | Para qual fase |
|---|---|---|
| Verificação HMAC de webhook Shopify, com testes | `packages/integrations/src/shopify/webhooks.ts` | **Fase 5** — é segurança fácil de errar sutilmente |
| Cliente Klaviyo | `packages/integrations/src/klaviyo` | **Fase 5** — integração do C14 |
| Adapter Shopify com testes | `packages/integrations/src/shopify/adapter.ts` | **Fase 5** — referência de chamadas à Admin API |

**Não usar:** os parsers de seção de tema (`parsers/*.ts`). Eles servem para
renderizar o tema nativamente, que é outro produto. O nosso espelha o site
pela WebView.

### Descartados

`app.fy`, `Appsfy1`, `app.fy-0002` (variações da mesma tentativa),
`track-convertfy`, `convertfy_admin2`, `convertfy-growth-hub` — nada que o
`admin-convertfy` atual já não cubra melhor.

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
