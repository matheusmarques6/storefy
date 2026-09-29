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
 | { type: 'OPEN_APP_SETTINGS' }                                            // abre a M12
 | { type: 'OPEN_EXTERNAL'; url: string }
 | { type: 'NOTIFY_WHEN_BACK'; variantId: string; path?: string };          // botão "me avise" do tema

// Nativo → Web (webviewRef.injectJavaScript)
type NativeToWeb =
 | { type: 'APP_CONTEXT'; platform: 'ios' | 'android'; appVersion: string; pushEnabled: boolean }
 | { type: 'NAVIGATE'; path: string }
 | { type: 'NOTIFY_WHEN_BACK_RESULT'; variantId: string; ok: boolean;       // o pedido foi gravado?
     reason?: 'permission' | 'unavailable' };
```
O site do lojista também pode chamar `window.Storefy.share()` e as demais funções por um snippet opcional, que é instalado pelo app Shopify (Theme App Extension).

### 5.6 Push no app
- `OneSignal.initialize(appId)`. Com `OneSignal.login(externalId)`, o `externalId` é o `customerId` quando conhecido. Antes disso, usa o ID anônimo do dispositivo.
- Tags: `cart_count`, `cart_value`, `last_cart_at`, `has_purchased`, `app_version`.
- Clique no push: `data.deep_link` → a aba correta executa `NAVIGATE`. Se o app estiver fechado, a config carrega primeiro e a navegação vem depois.
- Registro do device: `POST /api/public/devices` com a subscription ID. Isso permite métricas próprias e segmentação.
- **Inbox nativo** (aba opcional "Notificações"): lista as campanhas enviadas pela API da Storefy e controla lidas/não lidas localmente. Esse recurso conta muito na revisão da Apple.

### 5.7 Recursos nativos mínimos (checklist Apple 4.2)
Conferido contra o código na Fase 8a (ver "Fase 8a — Entregue").
- [x] Tab bar nativa
- [x] Push com deep link
- [x] Inbox de notificações
- [x] Tela offline nativa
- [x] Onboarding nativo
- [x] Compartilhamento nativo — o botão "Compartilhar" dos temas abre a folha do sistema
- [x] Haptics — ao entrar item no carrinho, e ao trocar de aba (com o esmaecer do conteúdo e o pulo do ícone; sem movimento com "Reduzir movimento" ligado — ver Fase 8w)
- [x] Face ID opcional — aba Conta, ligado em Recursos
- [x] Pedido de avaliação do app — depois da compra, vista pela página de obrigado
- [x] Universal Links — o app declara o domínio, e a C12 manda a Shopify publicar a associação (ou entrega os arquivos, fora da Shopify). Ligar em produção depende da Shopify liberar a permissão (ver Fase 8a)
- [x] Busca nativa (M08) — o campo é do app, no topo da aba Busca, e o resultado é a página de busca da loja (`/search?q=`)
- [x] Ajustes do app (M12) — desligar as notificações dentro do app (diretriz 4.5.4, obrigatória para push de promoção) e a política de privacidade a um toque (5.1.1). Entrada pela engrenagem da caixa de avisos ou pelo topo da aba Conta; sem nenhuma das duas, a C12 trava o envio (ver Fase 8c)

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
- **Fase posterior:** "de volta ao estoque", "pedido enviado" (webhook `fulfillments/create`), "inativo há 7 dias" e webhook customizado (integração com Klaviyo/Omnisend/n8n). ✅ todos entregues: os três primeiros nas Fases 5 e 8d, o webhook na 8e ("Klaviyo, Omnisend e outras ferramentas", com o endereço `POST /api/webhooks/automacao` e a chave da loja).
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
| A14 | Chamados | Fila dos chamados abertos pela Ajuda do painel (C17): quem espera resposta, conversa, responder, fechar e reabrir |

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
| Face ID opcional (`features.biometricLogin`) | ✅ Fase 8a, na aba Conta |
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
| Detecção automática de nome, cor e logo (C02–C04) | ✅ 24 testes. Os passos guiados C03 e C04 entraram na Fase 8g |
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
  área de conta. **(Entrou na Fase 8a: a chave está em Recursos, e o app tranca
  a aba Conta.)**

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
- **Conexão pelo app do próprio lojista** (`grant_type=client_credentials`), ao lado do OAuth. **ATENÇÃO — esta linha nasceu errada, e a correção custou uma sessão inteira:** ela dizia que este era "o caminho que funciona ANTES da aprovação do app público". Não é. A documentação da Shopify é explícita: *every option except the client credentials grant works on any merchant's stores, including your clients'*. `client_credentials` só funciona quando o app e a loja estão na MESMA organização da Shopify — ser dono da loja não basta, e instalar o app nela também não. Na loja real de um lojista a resposta é `shop_not_permitted`, sempre. O caminho manual serve, então, a dois casos e só a eles: **loja de teste da nossa organização**, e **app antigo criado dentro do admin da loja**, que vem com um token `shpat_` pronto (a Shopify não deixa mais CRIAR um desses, mas os existentes seguem valendo). Quem conecta a loja real do lojista é o **OAuth**, e é por isso que ele vem primeiro na tela. Muda três coisas: o token vence em 24h e é renovado no ponto de uso (sem job — token só serve para chamada nossa, e renovar o de uma loja parada seria gasto à toa); o webhook passa a ser assinado pelo segredo DAQUELA loja, e não por um segredo único da Storefy; e um domínio Shopify só pode estar conectado a uma loja do painel por vez, por índice único parcial — duas deixariam o webhook sem dono.
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
| Ordem dos dois caminhos na C14 | ✅ o OAuth vem primeiro quando existe, e o manual virou plano B. Estava invertido: a tela oferecia primeiro o único caminho que não podia funcionar na loja do lojista |
| `shop_not_permitted` traduzido | ✅ mensagem própria, antes do ramo genérico de 401 — a Shopify manda esse erro COM 401, e cair no ramo de baixo mandava conferir uma credencial que já estava correta |
| Token `shpat_` do app do admin da loja | ✅ campo opcional, conferido por `access_scopes.json`; `shopify_token_expires_at` nulo significa "não vence" e impede renovação impossível |
| `NEXT_PUBLIC_SITE_URL` sem esquema | ✅ `urlDoSite` normaliza. Sem isso o `redirect_uri` ia sem `https://` e a Shopify recusava — e os webhooks eram registrados errado em silêncio |
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
| Automação "de volta ao estoque" | ⚠️ ponta a ponta: botão no tema › bridge › endpoint assinado › `products/update` › push com link do produto. Nunca rodou contra uma loja de verdade. **Até a Fase 8b o elo do app faltava:** o pedido chegava ao app e não ia ao endpoint (ver a Fase 8b) |
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

### Auditoria do que já existe (23/09/2026)

O que foi conferido RODANDO, e não só lido:

| Verificação | Resultado |
|---|---|
| A aplicação sobe a partir do build de produção e responde | ✅ `next start` + requisições reais |
| Rotas públicas são mesmo públicas | ✅ `privacy/[loja]` e o banner do tema respondem sem sessão; o matcher do proxy exclui `privacy/` |
| Guardas de sessão | ✅ painel e admin redirecionam para o login; as rotas novas da Fase 6 também |
| Webhook da Shopify sem segredo configurado | ✅ responde 503, e não 200 — a Shopify reentrega em vez de dar o evento por entregue |
| Os quatro jobs do cron estão agendados | ✅ `vercel.json` cobre dispatch-push, push-stats, review-status e analytics |
| `NEXT_PUBLIC_SITE_URL` passa por um único funil | ✅ só `lib/env.ts` lê a variável crua |
| `.env.example` x o que o código lê | ✅ completo (conferido por `grep process.env`) |
| `catch` que engole erro | ✅ nenhum na nossa lógica; os que existem estão em script injetado na página do lojista, onde estourar quebraria a loja dele |
| RPC declarada e nunca chamada | ✅ nenhuma; `contar_abertura` e `dia_da_loja` são chamadas de dentro de outras funções SQL |

### O e2e rodou pela primeira vez (29/09/2026) — e achou o que nenhum outro teste achava

`./scripts/e2e-local.sh` sobe a pilha OFICIAL do Supabase (Postgres 17, Auth, REST, Storage)
no Docker, aplica as migrations, faz o build de PRODUÇÃO apontando para ela e roda o Playwright
contra `next start`. As 35 migrations aplicaram limpas no Postgres do Supabase — até então só
tinham rodado contra os stubs da suíte de RLS. O script também reprova a rodada se o servidor
registrar erro, mesmo com todo teste verde.

| Defeito achado pelo e2e | Por que nada antes pegava |
|---|---|
| **O "Sair" não funcionava.** Era um `<form action={sair}>` dentro de um `DropdownMenuItem`: o Radix fecha o menu e desmonta o formulário antes do submit | Nenhum teste de unidade renderiza o menu e clica |
| **A navegação saía da tela** em toda largura abaixo de 1440px. No celular, seis das oito seções e o menu da conta ficavam inalcançáveis | Cada fase somou uma seção ao cabeçalho, e ninguém voltou a medir |
| **Páginas do admin executavam para quem não era admin.** No App Router, layout e página renderizam em paralelo: o redirect do layout não impede a página de rodar, e a A02 estourava `resumo_do_admin` num 500 por trás de um redirect que parecia funcionar | O teste via o redirect e passava; o erro só aparecia no log do servidor |
| **Botão "Entrar com Google" desabilitado** na tela de login, com "ainda não configurado neste ambiente" — jargão de operador que o lojista não pode resolver. E a A13 afirmava o contrário ("o botão não aparece") | Ninguém tinha olhado a tela sem o Google configurado |
| **Dica e erro repetindo a mesma regra** em todo formulário ("Pelo menos 8 caracteres." em cima de "A senha precisa de pelo menos 8 caracteres."), e o leitor de tela lia as duas | O componente `Campo` nunca tinha sido renderizado com erro num navegador |

Travas que ficaram, para não voltar: `admin-guardado.test.ts` exige guarda em toda página do
admin (e antes da primeira consulta); `campo-de-formulario.test.ts` exige que o
`aria-describedby` só aponte para o que está na tela.

O que continua sem dar para conferir aqui:
- **O ponta a ponta com a Shopify, a EAS, a Apple e a Google**: continua dependendo das contas
  reais, como a Fase 5 já registrava.

### Segunda rodada do e2e (29/09/2026): push pela tela, fuso e formulários

O e2e passou a cobrir as campanhas de ponta a ponta (`e2e/push.spec.ts`: agendar, rascunho,
editar, cancelar, excluir, confirmar envio) e os formulários depois de um erro. Foram 22 testes
verdes contra o Supabase local, e o que eles e a revisão acharam:

| Defeito | Gravidade | Como ficou |
|---|---|---|
| **Campanha agendada saía 3 horas antes.** O `datetime-local` manda "…T20:00" sem fuso, e o servidor lia no fuso DO PROCESSO — UTC na Vercel. A edição convertia de volta em UTC e mostrava "20:00" de novo: o erro era invisível dos dois lados | Alta | `lib/fuso.ts` lê a hora no fuso da LOJA. O e2e agenda 20:00 e confere 23:00 UTC no banco; troca a loja para Manaus e confere que a mesma campanha aparece às 19:00 |
| **Dezessete telas mostravam hora em UTC**, e as de cliente trocavam o texto na hidratação | Média | Todas passam pelo fuso da loja (ou o padrão, no admin). `datas-com-fuso.test.ts` varre o código e falha em `toLocale…` sem `timeZone` |
| **Editar um RASCUNHO e clicar "Salvar alterações" ENVIAVA a campanha para todos os clientes.** O formulário abria com "Agora" marcado e o único botão agendava | Alta | Rascunho tem "Salvar rascunho" separado; o botão principal diz o que faz ("Enviar agora", "Agendar campanha"); enviar agora pede confirmação dizendo para quantos aparelhos vai |
| **"Agendar para" com a data em branco enviava na hora** — horário vazio queria dizer "agora" | Alta | É erro no campo. Teste de unidade e e2e |
| **Cancelar, excluir e editar diziam "pronto" quando nada tinha mudado** — RLS recusa em silêncio, e o job pode pegar a campanha entre a leitura e o clique | Média | As três conferem a linha gravada; o papel é conferido antes, com mensagem clara |
| **O fuso da loja não tinha tela**, apesar de "o lojista ajusta" no comentário da coluna. E um fuso inválido gravado direto pela API derrubava o `consolidar_analytics` de TODAS as lojas (o laço é um só) | Alta (entre clientes) | Campo "Fuso horário" na loja, com os estados do Brasil e a diferença para Brasília; trigger `conferir_fuso_da_loja` recusa no banco. A asserção de RLS mostra o job caindo sem a trigger |
| **Formulário se apagava depois de um erro.** O React 19 limpa todo `<form action>` no fim da ação, erro ou não: errar a senha apagava o e-mail; a Shopify recusar a credencial apagava o Client ID colado. Num `<select>` era pior: voltava ao valor inicial calado, e o papel "superadmin" virava "suporte" no envio seguinte | Média | A ação devolve o que foi digitado (`valoresDigitados`, lista explícita — senha nunca volta) e o campo usa como `defaultValue`; `<select>` remonta pela `key`. `formularios-controlados.test.ts` varre os formulários; e2e cobre login, cadastro, loja e o preenchimento automático antes da hidratação |
| **Mensagem crua do banco na tela** ("new row violates row-level security policy…", em inglês). E o login do admin respondia "senha incorreta" para qualquer falha, inclusive limite de tentativas | Média | `mensagemDaFalha`: só atravessa o texto das NOSSAS funções SQL (P0001); o resto vira frase em português e o original vai para o log. `erros.test.ts` varre o código atrás de `.message` montando mensagem |
| **Admin da plataforma no painel do cliente caía na organização de OUTRO cliente**, com o papel de outra pessoa. O contexto buscava os vínculos confiando só na RLS — e a RLS deixa a equipe ler todos | Alta (entre clientes) | `user_id` explícito no contexto e na troca de loja/organização. O e2e cria um cliente antes do admin e confere que o admin vê a própria organização |
| **A13 mostrava as integrações OPCIONAIS como "Faltando"**, com a chave tracejada em vermelho, ao lado de "Nada quebra" | Baixa | Três níveis (essencial, recurso, opcional); opcional desligada é "Não usado", neutro, e não entra na conta |
| **A prévia devolvia 415 para loja fora do ar** e o analytics mostrava "America/Sao_Paulo" cru | Baixa | Resposta de erro da loja explica o que houve; o analytics diz "horário de Brasília" e leva à tela da loja |

Travas novas: `formularios-controlados.test.ts`, `erros.test.ts` (varredura de `.message`),
`datas-com-fuso.test.ts`, o grupo "fuso" do `rls.test.sql` e os 9 testes novos do e2e.

Depois dela, `e2e/visita.spec.ts` (3) e `e2e/plataforma.spec.ts` (4: chaves da A13 com um
cadastro aberto no meio do caminho, suporte só lendo, atualização obrigatória do editor até a
config no ar e a ficha A04 com e sem app publicado), `e2e/convites.spec.ts` (3) e
`e2e/conta.spec.ts` (1). A suíte está em 33 testes verdes contra o Supabase local, com o log do
servidor limpo.

### C16 — Equipe e convites (29/09/2026)

A revisão das telas achou que a C16 prevê "equipe (convites e papéis)" e que isso **não existia**:
não havia como pôr uma segunda pessoa numa empresa, e a regra 2 ("uma organização pode ter vários
usuários com papéis diferentes") não era alcançável pela interface. O cadastro fechado da A13
piorava: ninguém novo entrava (nem o lojista piloto, nem um colega da equipe), e a tela mandava
"entrar com o e-mail do convite" sem convite existir.

| Entrega | Situação |
|---|---|
| **Equipe da empresa** (`/configuracoes/equipe`) | ✅ quem está na equipe, com papel, desde quando e último acesso; o proprietário convida, muda papel (com confirmação dizendo o que muda) e tira gente; cada um sai da empresa, menos o último proprietário. Admin e membro veem, sem os botões |
| **Convite por link** | ✅ segredo de 256 bits; o banco guarda só o sha256, e o link aparece UMA vez para quem convidou. Vale 7 dias, só para o e-mail convidado; reenviar gera outro link e mata o anterior; cancelar mata na hora. Dono não se convida (um link vazado dá no máximo administrador). Sem a Resend, a tela mostra o link para copiar e diz que o e-mail não saiu |
| **Aceitar** (`/convite/…`) | ✅ sem conta, cria ali mesmo (nome e senha; o e-mail é o do convite) e entra só na empresa convidada, sem ganhar uma empresa vazia; com conta, entra e aceita; logado com OUTRO e-mail, a tela explica e oferece trocar |
| **Conta sem empresa** (`/sem-empresa`) | ✅ quem saiu da única empresa (ou foi tirado) via o erro "fale com o suporte". Agora vê os convites em aberto para o e-mail dela (aceita sem o link) e, com o cadastro aberto, cria a própria empresa |
| **Lojista piloto (A03) e colega (A11)** | ✅ os convites da plataforma, com a mesma regra: lojista qualquer pessoa da equipe convida; colega, só superadmin |
| **Cadastro fechado no banco** | ✅ era só a tela e a ação. O Auth aceitava cadastro direto pela chave pública, e o Google criava conta por fora. Agora um gatilho no FIM da transação da conta nova desfaz tudo — salvo convite aceito, conta criada pela equipe (`criado_pela_equipe` no `app_metadata`, que só a service role escreve) ou o "convidar" do próprio Auth. Conferido contra o Auth de verdade: cadastro pela chave pública com o cadastro fechado volta 500 e nada fica gravado |
| **`pnpm bootstrap:admin`** | ✅ cria a conta marcada como da equipe e imprime um link de "definir senha" — funciona com o cadastro fechado e sem SMTP. O convite do Auth que ele usava seria barrado justamente quando é a única porta |
| **Excluir minha conta** (LGPD) | ✅ a Fase 0 consertou a cascata "porque a LGPD exige", mas não havia botão. Agora a tela diz ANTES o que acontece com cada empresa, com a mesma regra da cascata (`consequencias_de_excluir_minha_conta`): a empresa em que a pessoa é sozinha vai junto, com as lojas; na do único dono, quem herda (administrador antes de membro); nas outras, só a saída. Pede o e-mail digitado e a senha; o último superadmin não sai; a trilha de cada empresa registra quem saiu e o que aconteceu. Também em "sem empresa" |

> **FALHA DE SEGURANÇA CORRIGIDA: administrador virava dono.** A policy "owner e admin adicionam
> membros" deixava um ADMIN inserir um vínculo com papel OWNER para qualquer conta — uma segunda
> conta dele, por exemplo — e passar a excluir lojas e tirar o dono verdadeiro. O cabeçalho da
> própria migration dizia que admin "não mexe em membros". Vínculo novo agora só nasce de convite
> (nem o proprietário insere direto), e o UPDATE do vínculo ficou restrito à coluna `role` — trocar
> o `user_id` era pôr outra pessoa na empresa sem convite. A asserção de RLS da escalada cai quando
> a policy antiga volta.

> **Defeito que o e2e da exclusão de conta achou nos convites.** A restrição "aceite com autor"
> exigia `accepted_at` e `accepted_by` juntos, e `accepted_by` tem `on delete set null`: excluir
> uma conta que tinha aceitado um convite zerava o autor, violava a restrição, e o Auth respondia
> "Database error deleting user" — justamente quem entrou por convite não conseguia se excluir. A
> regra ficou numa direção só (não há autor sem aceite), com asserção que cai sem a correção.

> **Por que a conferência do cadastro fechado é no COMMIT, e não no INSERT.** A primeira versão
> conferia no INSERT e barrou o próprio `pnpm bootstrap:admin`: a API admin do Auth grava o
> `app_metadata` numa segunda instrução, depois do INSERT, na mesma transação. O teste contra o Auth
> real pegou. O gatilho de restrição adiado relê a linha no fim da transação, quando a marca já
> está lá.

Travas novas: 70 asserções no grupo "convites" do `rls.test.sql` (com mutações conferidas: a
policy antiga de volta, o gatilho do cadastro fechado removido e o aceite sem conferir o e-mail),
`lib/convites.test.ts`, `lib/convites-servidor.test.ts` (o hash é o mesmo que o banco calcula,
pelo vetor do SHA-256) e `e2e/convites.spec.ts` (3 cenários, com várias sessões ao mesmo tempo).

**Depende de ação humana**

| Item | O que falta |
|---|---|
| Envio do convite por e-mail | `RESEND_API_KEY` e `EMAIL_REMETENTE` (A13). Sem elas tudo funciona, e a tela mostra o link para copiar |
| Confirmação de e-mail no Supabase | Deixar ligada em produção (Authentication → Email → Confirm email). Aceitar convite pela lista "convites para você" confia que a conta é dona do e-mail — é a confirmação que garante isso |
| Criar conta pelo painel do Supabase | Com o cadastro fechado, o "Create user" do painel do Supabase é barrado (ele não marca a conta como da equipe). Use um convite (A03/A11), o `pnpm bootstrap:admin` ou o "Invite user" do Supabase |

### C16 (avisos por e-mail), C17 — Central de ajuda e A14 — Chamados (29/09/2026)

A revisão das telas achou mais duas lacunas do inventário: a C17 ("artigos e contato com o
suporte") **não existia** — o lojista não tinha onde ler como publicar nem como falar com a
Storefy pelo painel — e a C16 prevê "notificações por e-mail", mas o aviso da revisão do app ia
para todo proprietário e administrador, sem como desligar.

| Entrega | Situação |
|---|---|
| **Central de ajuda** (`/ajuda`) | ✅ sete guias, um por parte do painel (primeiros passos, publicar nas lojas, Shopify, notificações, analytics, atualização obrigatória, equipe e papéis), escritos a partir das telas que existem, com o nome que elas têm e atalhos para elas. Moram no código (`lib/ajuda.ts`), versionados junto com as telas: `ajuda.test.ts` falha se um atalho apontar para uma página que não existe. Pelo menu da conta e pelo rodapé do painel |
| **Chamados do lojista** (C17) | ✅ abrir (assunto, título, loja opcional — a ativa já vem escolhida — e mensagem), acompanhar a conversa, responder e fechar (com confirmação; escrever num fechado o reabre). A empresa inteira vê os chamados da empresa. A resposta aparece como "Equipe Storefy", sem o e-mail de quem atendeu. Limite por empresa de 10 chamados e 30 mensagens por hora (cada um avisa a caixa do suporte). Em "Ver como cliente", só leitura |
| **A14 — Chamados** (admin) | ✅ fila em três recortes com contagem — esperando resposta (do mais antigo para o mais novo), aguardando o cliente e fechados —; conversa com empresa, loja, assunto e quem abriu; responder, fechar e reabrir. "Chamados esperando resposta" entrou no "precisa de você" da visão geral |
| **A vez é de quem não escreveu por último** | ✅ no banco (`situacao_pela_mensagem`): mensagem do cliente põe o chamado em "esperando resposta"; da equipe, em "aguardando o cliente". O lojista só consegue FECHAR — a RLS recusa qualquer outra mudança, e ele não escreve como equipe. A abertura e cada mudança de situação vão para a trilha da empresa, com o autor certo |
| **Avisos por e-mail de cada pessoa** (C16) | ✅ em Configurações › Empresa, cada um escolhe para si, só nesta empresa: resultado da revisão do app (só proprietários e administradores recebem; para o membro a caixa aparece travada, dizendo por quê) e resposta do suporte. O aviso da revisão (`emails_do_build`) e o da resposta (`email_do_autor_do_chamado`, só para quem continua na empresa e confirmou o e-mail) respeitam a escolha. Convites e avisos de segurança chegam sempre |
| **Aviso para a equipe** | ✅ chamado novo e resposta de cliente vão para `EMAIL_SUPORTE` (opcional, descrita na A13). Sem ela nada quebra: a fila da A14 recebe tudo do mesmo jeito |

> **Defeito achado na revisão: salvar os avisos desligava a revisão do membro.** A caixa da
> revisão aparece travada para o membro, e o navegador não envia caixa travada: o servidor lia
> "desmarcada" e gravava uma escolha que a pessoa nunca fez — e que passaria a valer no dia em que
> ela virasse administradora. Agora o servidor só grava a escolha da revisão de quem a recebe; o
> e2e cai quando a correção sai.

Travas novas: 28 asserções no grupo "avisos e chamados" do `rls.test.sql` (outra empresa não lê
nem escreve; o lojista não escreve como equipe, não muda a situação a não ser para fechar e não
abre chamado com loja de outra empresa; cada um só mexe na própria escolha de avisos; o aviso não
vai para quem saiu da empresa), `lib/chamados.test.ts` (validação e HTML escapado nos e-mails),
`lib/ajuda.test.ts` e `e2e/chamados.spec.ts` (2 cenários, com o lojista, a equipe, um membro e
uma segunda empresa ao mesmo tempo). A suíte e2e está em 35 testes.

**Depende de ação humana**

| Item | O que falta |
|---|---|
| Aviso de chamado novo por e-mail | `EMAIL_SUPORTE` (a caixa da equipe) e a Resend (`RESEND_API_KEY`, `EMAIL_REMETENTE`). Sem elas, os chamados chegam só pela tela A14, e o lojista acompanha a resposta pelo painel |

### Fase 6 — Painel Admin completo (4–6 dias)
- Telas A02–A13, impersonação com auditoria, presets por tema (A10), feature flags e reexecução de builds.
- Reaproveitar do admin Convertfy os padrões de tabela, filtros, página de detalhe com abas e notas internas.

**Progresso (22/09/2026)**

| Item | Situação |
|---|---|
| A01 — Login do admin | ✅ `exigirPlatformAdmin()` a cada request; quem não está em `platform_admins` vai para /admin/sem-acesso. O segundo fator (app autenticador) entrou na Fase 8o |
| **A02 — Visão geral** | ✅ os números numa chamada só (`resumo_do_admin`), com os chamados esperando resposta (A14) e a cobrança (Fase 7: MRR, testes que acabaram sem assinar, acima do limite de aparelhos), separados em "precisa de você" (só o que é > 0) e "a plataforma hoje" (aparece zerado, porque ali zero é informação). `/admin` passou a ser esta tela |
| A03 — Organizações (lista) | ✅ saiu de `/admin` para `/admin/organizacoes`, com busca e paginação. **Convidar lojista**: o convite que deixa o lojista piloto criar a conta com o cadastro fechado, com os convites em aberto (reenviar e cancelar) |
| A04 — Cliente (detalhe) | ✅ lojas, membros, últimos builds, **notas internas**, **"Ver como cliente"** (somente leitura, auditado — ver abaixo), **App e push** por loja (config no ar e desde quando, rascunho parado, atualização obrigatória, versão aprovada em cada loja de aplicativos, projeto Expo, identificadores, notificações, push de 30 dias e automações ligadas) e **Cobrança** (Fase 7): liberado ou travado e até quando, plano, faturas, quem paga, os últimos avisos da Asaas e "estender teste" |
| **A05 — Fila de builds** | ✅ recortes por situação na URL, abrindo no que quebrou; erro da EAS na própria linha; link dos logs; reexecutar com confirmação, travado para build que ainda roda ou que está com a loja |
| **A06 — Revisões das lojas** | ✅ ordenada do mais ANTIGO para o mais novo (aqui o interessante é o que está parado), com alerta a partir de 7 dias e o motivo da recusa na linha |
| **A07 — Contas de desenvolvedor** | ✅ estado e identificadores públicos (Team ID, Key ID) de cada cliente. Nenhuma coluna `_enc` é lida: o segredo não passa pela tela |
| **A08 — Push global** | ✅ envios, falhas e aparelhos ativos por app, ordenado por ativos (é o que a OneSignal cobra). "App com problema" é RAZÃO com piso de volume, não contagem: 1 falha em 1 envio não acusa ninguém |
| **A11 — Equipe interna** | ✅ convidar, trocar papel e remover, com três travas — só superadmin mexe, ninguém altera a si mesmo, e o último superadmin não sai. Conferidas de novo no servidor, com a contagem vinda do banco. E-mail sem conta recebe um **convite de equipe** (cria a conta pelo link, mesmo com o cadastro fechado, e já nasce com o papel) — antes a tela mandava "se cadastrar primeiro" |
| A12 — Logs de auditoria | ✅ |
| **A13 — Configurações do sistema** | ✅ as 19 variáveis que a aplicação lê, em três níveis (essencial, por recurso, opcional) pelo que quebra sem cada uma, com um teste que varre o código e falha quando alguém soma uma variável sem descrevê-la; opcional desligada aparece como "Não usado". **Chaves de funcionamento**: cadastro aberto/fechado e um aviso no topo do painel de todos os lojistas, com prévia, só superadmin muda (o servidor confere de novo) e cada chave mudada vai para a auditoria com o antes e o depois. **Versão mínima**: a lista dos apps que estão exigindo atualização, com link para o cliente. O cadastro fechado vale **no banco**, para toda porta de entrada (ver "C16 — Equipe e convites") |
| **A10 — Presets por tema** | ✅ os dois lados: a equipe cria o preset COPIANDO de uma loja publicada, e o lojista aplica no editor com a troca descrita antes de confirmar |
| **A09 — Planos e preços** | ✅ Fase 7 (ver lá) |

> **"Entrar como cliente" virou "Ver como cliente": somente leitura.** Entrar COMO o cliente
> exigiria uma sessão com a identidade dele, e tudo que a equipe fizesse iria para a trilha como
> se o cliente tivesse feito — inclusive publicar o app ou mandar push para os clientes DELE. Para
> o que o suporte precisa, que é ver o que o lojista está vendo, ler basta, e ler não tem como
> dar errado em nome de ninguém. Como funciona:
>
> - a pessoa da equipe continua com a PRÓPRIA sessão; o painel lê o cliente pelas policies de
>   sempre (`or is_platform_admin()`), e nenhuma policy de escrita dá passagem à equipe — o
>   "somente leitura" é do banco (conferido no `pg_policies`);
> - por cima, o proxy recusa toda ação de formulário durante a visita (e2e manda um POST direto
>   e recebe 403), e as telas escondem o que escreve;
> - abrir exige MOTIVO, e o começo (com o motivo) e o fim vão para a auditoria com ações
>   próprias (`view_as_start`/`view_as_end`) — a auditoria é gravada antes, e sem ela a visita
>   não abre;
> - o convite é assinado, vale 5 minutos e só abre na sessão do mesmo admin; a visita dura 1
>   hora, e cai na hora se a pessoa sair da equipe;
> - uma visita esquecida no navegador não trava quem entra depois: o proxy descarta o cookie
>   que não é da pessoa logada, e "Sair" apaga a visita.
>
> O e2e navega por TODAS as telas durante a visita e confere que nenhuma linha nova apareceu na
> trilha do cliente — toda escrita nas tabelas dele passa por trigger de auditoria.
>
> **Dois defeitos que o e2e da visita achou no caminho**: um `redirect()` de server action para
> uma rota interna faz o Next renderizar o destino NO SERVIDOR, seguindo o 303 com os cookies de
> antes — o cookie da visita nunca chegava ao navegador. E `new URL(caminho, requisicao.url)`
> numa rota leva o host em que o servidor escuta (`localhost` no `next start`), e não o que o
> navegador pediu; as rotas do OAuth da Shopify tinham o mesmo problema. `redirecionarPara` usa
> `Location` relativo, que o navegador resolve contra o endereço que ele mesmo pediu.

> **O preset nasce de uma loja que já funciona, e não de um editor próprio no admin.** Duas
> razões: um segundo editor de abas seria uma cópia do C06 envelhecendo em paralelo, e um preset
> escrito à mão é um palpite — um copiado de loja no ar já foi conferido por alguém olhando a
> tela do celular.
>
> **O preset troca o TEMA, nunca a MARCA.** Abas, elementos escondidos e CSS entram; nome,
> cores, ícone, splash e recursos ficam. Um preset que sobrescrevesse a identidade faria o
> lojista perder a tarde que passou ajustando para ganhar três seletores. Há asserção para isso.
>
> **O lojista LÊ os presets, ao contrário das notas internas.** É conteúdo do produto, não dado
> de cliente: saber que existe um preset para Dawn não conta nada sobre ninguém. Sem essa
> leitura ele não teria como aplicar, e a curadoria do admin viraria dado morto. O que ele não
> pode é ver os desligados nem escrever.

> **As notas internas têm uma propriedade que um descuido destruiria: o cliente nunca as lê.**
> Nem o dono da organização. A policy natural de escrever — "membros leem as notas da própria
> organização" — é exatamente a errada, e entregaria ao lojista tudo que a equipe anotou sobre
> ele: reclamação, desconto negociado, risco de cancelamento. A policy certa não tem cláusula
> por organização nenhuma, só `is_platform_admin()`. Escrevi a policy errada de propósito para
> conferir: a asserção do dono cai. É ela que segura isso no lugar.
>
> `org_notes` não tem UPDATE, de propósito: uma nota é o registro do que se sabia NAQUELE dia, e
> reescrevê-la apaga a razão de ela existir. Quem mudou de ideia escreve outra. Apagar continua
> possível — engano de digitação acontece —, e apagar É auditado, com o texto da nota junto:
> escrever não precisa, porque a nota que existe já diz quem a escreveu e quando.

> **A atualização obrigatória agora é alcançável — e o que a travava era o pipeline de build.**
> `minSupportedBuild` existia na `AppConfig` e o app a respeitava, mas nenhuma tela a gravava.
> Ao ligar, apareceu por que ninguém tinha conseguido: **todo binário de toda loja saía como
> versão 1.0.0, build 1**. O workflow nunca definia `APP_VERSION`, `IOS_BUILD` nem `ANDROID_VC`.
> A primeira publicação passava; a SEGUNDA (trocar o ícone, reenviar depois de uma recusa) seria
> recusada pela Apple ("the bundle version must be higher") e pelo Google ("version code already
> used"), e a loja ficaria presa na primeira versão. E "exigir o build mais novo" não significava
> nada com todos sendo o 1.
>
> O que mudou:
>
> - **o banco reserva o número e a versão de cada build** (`reservar_versao_do_build`): um
>   contador POR APP (e não por plataforma, porque `minSupportedBuild` é um número só, comparado
>   nas duas), sob trava para iOS e Android disparados juntos não pegarem o mesmo número,
>   idempotente para o workflow reexecutado, e versão `1.0.<n>` — depois de aprovada, a Apple não
>   aceita outro binário com o mesmo texto de versão;
> - **o lojista escolhe no editor** (C06 › Recursos › Atualização obrigatória), e só pode exigir
>   o número que JÁ ESTÁ aprovado nas duas lojas. Exigir uma versão que ainda não existe travaria
>   todo cliente numa tela de "Atualize" sem atualização para baixar — por isso o
>   `publicar_config` recusa no banco, e não só a tela;
>   a equipe vê na A04 (por loja) e na A13 (quem está exigindo). O admin não grava a config do
>   cliente: publicar iria junto com o rascunho que ele está editando;
> - **a EAS passou a receber as variáveis da loja**: o `app.config.ts` é avaliado DE NOVO no
>   servidor da EAS, onde só existem as variáveis do `env` do perfil. As exportadas no runner
>   ficavam no runner, e o binário sairia com o nome, o bundle e o domínio da loja de
>   desenvolvimento. O workflow escreve todas no `eas.json` do perfil antes do build (o segredo
>   do aparelho, mascarado no log);
> - **a config embutida passou a ser registrada**: o workflow gravava o JSON da loja em
>   `brands/`, mas sem a linha de `import` o Metro não o empacotava — o primeiro uso sem internet
>   abria em erro. `registrar-config-embutida.ts` escreve a linha entre marcadores, com teste;
> - **o runtime do OTA ficou fixo** (`1.0.0`, o que os binários já publicados têm): com a versão
>   subindo a cada binário, a política `appVersion` daria um runtime por build, e uma correção OTA
>   só alcançaria os apps daquele número exato;
> - **domínio da loja, esquema de URL e endereço da API** passaram a ir para o build: todo app
>   reclamava o domínio da loja de desenvolvimento para os links universais, dividia o esquema
>   `storefy://` com os outros e chamava um endereço fixo.
>
> Nada disso rodou contra a EAS, a Apple e o Google de verdade neste ambiente (sem as contas);
> está coberto por testes do número (SQL), da rota que entrega os dados do build e do registro da
> config embutida.

> **Dois defeitos que o e2e das chaves da A13 achou.** A tela `/cadastrar` não lê cookie nem
> cabeçalho, e o Next a gerava ESTÁTICA no build: fechar o cadastro não mudava a tela, que
> continuava com o formulário das chaves do dia do deploy. `configuracoesDaPlataforma()` chama
> `connection()`, e toda tela que lê as chaves passa a ler na hora. E a caixa "Cadastro aberto"
> voltava a aparecer MARCADA logo depois de a equipe fechar o cadastro: no fim de toda ação, o
> React devolve o formulário ao padrão, e numa caixa de marcar controlada o padrão é o do
> primeiro desenho (num campo de texto controlado o React acompanha o padrão; numa caixa, não).
> O salvamento seguinte gravava o contrário do que a tela mostrava. A caixa passou a ser livre,
> com o padrão devolvido pela ação, e a varredura `formularios-controlados.test.ts` ganhou a
> regra — conferida pondo o defeito de volta.

> **A A13 nasceu de um prejuízo real.** `NEXT_PUBLIC_SITE_URL` foi colada sem o `https://`, e o
> efeito não foi erro na tela: foi o OAuth da Shopify recusando o retorno e os webhooks sendo
> registrados errado em silêncio — a loja conectava e nenhum pedido chegava. O que faltava era
> poder olhar numa tela e ver o estado de cada integração. Daqui só sai booleano: o nome do que
> falta e o que quebra sem aquilo, nunca o valor.

> **O teste que impede a lista de envelhecer.** Ele varre os arquivos atrás de `process.env.X`
> (ignorando comentários, que citam o mecanismo em prosa) e falha nomeando a variável que o
> código lê e a tela não descreve — e também o contrário, uma variável descrita que ninguém lê.
> A seção 12 deste plano já envelheceu desse jeito: perdeu seis variáveis, entre elas
> justamente a do `https://`.

> **Até a A11 existir, somar um colega à equipe exigia rodar `pnpm bootstrap:admin` com acesso
> ao banco de produção.** Uma tarefa de trinta segundos dependia de quem tinha a chave.

> **O custo em reais não aparece na A08**, pelo mesmo motivo do MRR na A02: converter aparelho
> ativo em dinheiro depende da tabela de preços do plano contratado, que é Fase 7. A tela mostra
> o número de ativos — que é o que a OneSignal cobra — e diz o que falta.

> **`push_do_admin` trata o `stats` da OneSignal como hostil.** Um cast direto
> (`(stats->>'entregues')::bigint`) derruba a consulta INTEIRA quando um único app tem lixo ali,
> e a tela do admin some por causa de um cliente. A asserção de RLS planta uma campanha com
> `"entregues": "n/d"` de propósito; com o cast direto no lugar da guarda, a suíte não falha —
> ESTOURA, que é o que se quer impedir.

> **`admin_equipe` é `security definer`, e dessa vez com razão.** O e-mail mora em `auth.users`,
> que não é nossa e não tem policy para o `authenticated`: não há RLS a respeitar, há um schema
> fora de alcance. Diferente do caso do `resumo_do_admin`, onde definer era desnecessário.

> **Todo número da A02 leva a algum lugar.** Enquanto a A05/A06/A07 não existiam, três cartões
> apontavam um problema sem oferecer caminho — meia informação. O teste
> `toda pendência leva a algum lugar` agora falha se alguém acrescentar uma pendência sem destino.

> **Faturamento não aparece na A02 de propósito.** Não existe tabela de cobrança (Fase 7), e
> a regra 1 do CLAUDE.md proíbe número inventado — ainda mais em tela de dinheiro, onde ninguém
> confere o que já parece plausível. A tela mostra um aviso dizendo o que falta e para onde ir
> enquanto isso.

> **`resumo_do_admin` é `security invoker`, e isso foi uma correção.** A primeira versão era
> `definer`, com o argumento de que um `count` sob RLS devolveria o que o usuário enxerga e não
> o que existe. O argumento é bom e estava errado aqui: toda policy de leitura dessas tabelas já
> termina em `or is_platform_admin()`, conferido no `pg_policies`. Invoker não abre porta
> paralela à RLS, e a asserção "conta o que existe" no `rls.test.sql` pega o dia em que uma
> tabela nova esquecer essa cláusula.

### Fase 7 — Cobrança, planos e limites (3–5 dias)
- Asaas/Stripe (ou Shopify Billing, se a distribuição for pela App Store da Shopify), webhooks de assinatura, trial de 14 dias e bloqueio suave (o app continua funcionando e o push/editor ficam limitados).
- Medição de MAU por app (custo OneSignal) e exibição de uso no C15.

**Entregue (29/09/2026)**

| Entrega | Situação |
|---|---|
| **Trava de colunas da empresa** (antes de tudo) | ✅ FALHA CORRIGIDA: a policy de edição da empresa liberava a linha inteira, e um administrador podia esticar o próprio teste ou se declarar "active" pela API. Agora a pessoa só escreve o `name` (grant por coluna); o resto é do banco e da equipe. A coluna solta `plan` saiu: o plano é o da assinatura |
| **O que libera é uma data** | ✅ `cobranca_da_org`: liberado até o maior entre o fim do teste e o fim do período pago, mais 7 dias de tolerância enquanto houver assinatura viva (boleto demora a compensar). Calculado das faturas, então não depende da ordem dos avisos da Asaas, e aviso repetido não muda nada. Datas no horário de Brasília, a mesma régua que o lojista lê |
| **Bloqueio suave, no banco** | ✅ gatilhos nas quatro coisas que custam: loja nova, campanha que entra na fila, publicar mudança no app e versão nova para as lojas (vale também para a reexecução do admin). O app no ar, as automações e os rascunhos continuam. A frase diz o motivo e o caminho ("O período de teste acabou. Assine um plano em Configurações › Plano e cobrança para enviar campanhas."). Campanha agendada que vence com a empresa travada não sai, e diz por quê |
| **Limites do plano** | ✅ lojas, aparelhos ativos (o MAU, pela OneSignal) e campanhas por mês (no mês de Brasília; automação não conta). Nulo é sem limite. Lojas e campanhas travam no banco, com a frase do limite; aparelhos acima do limite avisam (o app nunca sai do ar por isso). Durante o teste valem os limites do plano que a equipe marcar "vale no teste" |
| **C15 — Plano e cobrança** (`/configuracoes/plano`) | ✅ situação com as datas (teste, aguardando o primeiro pagamento, em dia e pago até, fatura em atraso e até quando pagar, cancelada e até quando vale), uso contra os limites com os aparelhos loja por loja, os planos, as faturas com o link de pagar e quem paga. Assinar pede nome, CPF ou CNPJ (com o CNPJ alfanumérico da Receita, em vigor desde julho de 2026) e o e-mail da fatura; a primeira cobrança vence no fim do teste. Trocar de plano (o valor novo vale a partir da fatura em aberto) e cancelar (com confirmação dizendo até quando vale). Só o proprietário mexe; administrador vê tudo; membro vê a situação e o uso |
| **Faixa da cobrança** no topo do painel | ✅ teste acabando (7 dias), fatura em atraso com a data-limite, e travado — sempre dizendo que o app continua funcionando para os clientes da loja |
| **A09 — Planos e preços** | ✅ criar, editar, tirar da vitrine e excluir (só plano nunca assinado), com o número de assinantes; só superadmin escreve, e a trilha grava quem mudou o quê. Mostra se a chave e o token da Asaas estão configurados, o endereço do webhook para copiar e o último aviso recebido |
| **A02** | ✅ MRR (assinaturas em dia, pelo valor contratado), testes que acabaram sem assinar nesta semana e empresas acima do limite de aparelhos |
| **A03 e A04** | ✅ A03 mostra o plano de cada cliente (ou "Teste até"); A04 ganhou a cobrança do cliente e o "estender teste" (superadmin, até 90 dias, na trilha com quem fez) |
| **Asaas** | ✅ cliente, assinatura mensal com "pergunte ao cliente" (Pix, boleto e cartão na fatura), troca de valor e cancelamento — rotas e cabeçalhos conferidos na integração oficial da Asaas (`@asaasbr/n8n-nodes-asaas`). Sempre a Asaas primeiro e o banco depois; se o banco falhar, desfaz lá. Webhook `/api/webhooks/asaas` com o token em tempo constante, idempotente pelo id do aviso, 500 só para erro nosso (a Asaas reenvia) |
| **Excluir conta com assinatura** | ✅ a empresa que vai junto com a conta tem a assinatura cancelada na Asaas antes; o banco recusa excluir empresa com assinatura viva |
| **Sem chave da Asaas** | ✅ a C15 mostra os planos e diz que a assinatura pelo painel ainda não está ligada, com o caminho para falar com a equipe (a Ajuda já abre com o assunto "Cobrança") |

> **Decisão: Asaas, e só ela.** O plano deixava "Asaas ou Stripe". A Asaas cobre o que o lojista
> brasileiro usa numa assinatura (Pix, boleto e cartão, escolhidos na fatura), e o enum do provedor
> nasceu só com ela: um provedor novo entra junto com o código que o atende. O `STRIPE_SECRET_KEY`
> saiu do `.env.example`. Se a distribuição for pela App Store da Shopify, a Shopify exige a Billing
> API dela — seria um segundo provedor, decidido antes de listar.

Travas novas: 88 asserções no grupo "cobrança" do `rls.test.sql` (com mutações conferidas: o grant
da empresa de volta, sem a tolerância, "paga" deixando de ser final, sem cada uma das quatro travas,
sem a trava de exclusão e a campanha vencida saindo de empresa travada), `lib/cobranca.test.ts`
(CPF e CNPJ, inclusive o exemplo alfanumérico da Receita, preço, leitura dos avisos, a faixa),
`lib/asaas.test.ts` (o que vai para a Asaas, recusas, HTTPS) e `e2e/cobranca.spec.ts` (2 cenários,
com um servidor no lugar da Asaas falando HTTP de verdade com o painel). A suíte e2e está em 37 testes.

**Depende de ação humana**

| Item | O que falta |
|---|---|
| Conta da Asaas | Uma conta da Storefy na Asaas, a chave em `ASAAS_API_KEY` e o webhook cadastrado lá (Integrações › Webhooks) com o endereço que a A09 mostra, o token de `ASAAS_WEBHOOK_TOKEN` e os eventos de cobranças e assinaturas |
| Conferir no sandbox | Antes de ligar em produção: `ASAAS_API_URL=https://api-sandbox.asaas.com/v3` com uma chave de sandbox, assinar um plano, pagar a fatura no sandbox e ver a C15 ficar "Em dia" |
| Preços | Criar os planos na A09 (preço e limites são decisão de negócio; nenhum nasce sozinho) e escolher qual vale no teste |
| Clientes piloto | O teste de quem já estava usando acaba na data de sempre (14 dias do cadastro). Para os pilotos, estender o teste na A04 |
| Shopify App Store | Se o Storefy for listado lá, a cobrança precisa passar pela Billing API da Shopify |

### Fase 8 — Polimento, QA e lançamento (5+ dias)
- Trocar os layouts provisórios pelos do Claude Design (tela por tela, usando os IDs C/A/M).
- Testes E2E com Playwright (onboarding → editor → publicar config → campanha). ✅ `e2e/jornada.spec.ts` faz a jornada inteira só pela tela (cadastro → loja → editor → publicar → campanha agendada), e a suíte tem 78 testes — na rodada de 29/09/2026, a suíte inteira passou (78 de 78, em 9 minutos), contra o Supabase local e o build de produção (`scripts/e2e-local.sh`)
- Maestro para fluxos do app (abrir, trocar aba, carrinho, offline). ✅ escritos em `apps/mobile/.maestro/` (abrir, trocar aba, busca, carrinho, offline, ajustes e desligar as notificações), conferidos pelo `maestro check-syntax` 2.10; `src/maestro.test.ts` quebra se um fluxo citar texto ou `id` que o app não tem. Rodar depende de simulador/emulador com o build da loja de teste (ver "Depende de ação humana" da Fase 8c)
- Sentry (web + mobile), logs estruturados, status page. ✅ Fase 8b
- Revisão de segurança: RLS, segredos, rate limit, HMAC. ✅ Fase 8b
- **Checklist App Store** (seção 5.7) + notas de revisão padrão explicando os recursos nativos. ✅ Fase 8a
- Três lojas piloto (clientes Convertfy) até ficarem live nas duas lojas.

#### Fase 8a — Entregue (29/09/2026): o app nativo contra o checklist 5.7

| Item | Estado |
|---|---|
| Identidade obrigatória no build de loja (`APP_NAME`, `APP_SLUG`, bundle, package) | ✅ build de loja sem elas falha com o nome da variável; sem `STORE_DOMAIN`, nada de `associatedDomains` vazio |
| Face ID ou digital na aba Conta (M06) | ✅ trava, desbloqueio automático ao abrir a aba, volta a trancar depois de 5 min fora |
| Chave "Proteger a conta com Face ID ou digital" (C06e) | ✅ explica sem a aba Conta, e continua podendo ser desligada |
| Links da conta abertos de outra aba vão para a aba Conta | ✅ com as portas (login, cadastro, senha) livres |
| Notas para a revisão da Apple (C12) | ✅ da config no ar, em inglês, só com o que está ligado |
| Política de privacidade | ✅ conta o Face ID e tudo o que a OneSignal recebe |
| Compra, checkout e saída da conta vistos pelo endereço | ✅ `webview/jornada.ts`, 13 testes |
| Cliente logado identificado no OneSignal | ✅ pelo `__st.cid` que a Shopify põe na página |
| Compartilhar e vibrar sem código do lojista | ✅ `navigator.share` pela ponte; vibração ao entrar item no carrinho |
| Contas de cliente novas da Shopify (`shopify.com/<id>/account`) dentro do app | ✅ antes abriam no navegador |
| Token do carrinho sem a chave secreta, em todas as camadas | ✅ trava no banco, 6 asserções de RLS |
| Face ID num iPhone de verdade | ⬜ depende de aparelho físico (ver abaixo) |
| Universal Links e App Links publicados no domínio da loja (C12) | ✅ pela API de Mobile Platform Applications da Shopify, idempotente; fora da Shopify, os dois arquivos prontos |
| Impressão digital do Android (SHA-256) conferida e guardada | ✅ trava no banco; trocar desfaz o vínculo do Android |
| Vínculo gravado só pelo servidor, com quem pediu na trilha | ✅ 13 asserções de RLS |

**O que a auditoria achou, e por que importava**

- **Três mensagens do contrato nunca eram enviadas.** `ORDER_COMPLETED`,
  `CHECKOUT_STARTED` e `CUSTOMER_IDENTIFIED` existiam no bridge e no app, mas
  nada na página as mandava — o checkout da Shopify não é do tema, e o
  lojista não tem como pôr código lá. Resultado: a chave "Pedir avaliação"
  do editor não fazia nada, o evento de compra que cancela o push de carrinho
  abandonado nunca saía, o token do carrinho não chegava no checkout e o
  OneSignal nunca soube quem era o cliente. Agora o app lê o que a URL conta
  (página de obrigado, entrada no checkout, saída da conta) e o id do cliente
  que a própria Shopify publica na página.
- **O carrinho só era observado com o número na aba.** Tirar o badge da barra
  desligava em silêncio o carrinho abandonado que o lojista ligou em outra
  tela. Numa loja Shopify, o observador agora roda sempre.
- **O deep link perdia a query.** `destinoDoPush` preservava `?q=tenis` de
  propósito, e a casca cortava na hora de abrir: o push "procure por tênis"
  caía numa busca vazia. E a aba era escolhida por letras em comum
  (`/cartao-presente` abria no carrinho); agora é por segmento inteiro.
- **A aba Conta mandava o cliente para o navegador** nas lojas com as contas
  de cliente novas da Shopify, que moram em `shopify.com/<id>/account` — o
  padrão depois que as antigas foram aposentadas.
- **O token do carrinho ia com a chave secreta.** Desde julho de 2025, o
  `/cart.js` devolve `<token>?key=<segredo>`; a chave dá acesso aos dados do
  comprador, e a Shopify manda tratá-la como senha. Ela ia inteira para
  `cart_events` — e, como o pedido do webhook traz o token SEM a chave, o
  pedido nunca casava com o aparelho, e o push de "seu pedido saiu" não tinha
  para quem ir. Agora a chave é tirada na página, de novo no app, de novo no
  servidor, e o banco tem trava (migration 45, com a limpeza do que já estava
  gravado).

**Decisões**

- **Nunca tranca quem não tem como abrir.** Sem sensor, sem biometria
  cadastrada, num binário sem a permissão de Face ID ou se o aparelho perde o
  cadastro no meio da sessão, a aba abre normalmente. A senha do celular vale
  como alternativa, oferecida pelo próprio sistema.
- **A página da conta só carrega depois do primeiro desbloqueio**, e fica
  montada por baixo da trava quando ela volta — o cliente reencontra a conta
  onde deixou. Só o `background` conta como sair: o próprio Face ID deixa o
  app `inactive` no iOS.
- **Com a conta protegida, os dados dela só abrem na aba Conta.** Sem isso, o
  ícone de conta do cabeçalho do tema, tocado na aba Início, mostraria os
  pedidos sem Face ID nenhum. Login, cadastro e recuperação de senha ficam
  livres: o "Entrar" do checkout passa por eles.
- **A compra vista pela URL vai sem valor.** O app sabe QUE comprou, não
  QUANTO; o valor de verdade chega pelo webhook `orders/create`. Um total
  estimado gravado como valor do pedido seria dado falso.
- **Identificação só de quem está logado.** Página sem cliente não manda
  "ninguém": o checkout novo não tem o objeto da Shopify, e isso desligaria a
  identificação no meio da compra. Quem desfaz é a saída explícita da conta.
- **`navigator.share` só onde o sistema não tem o seu** (a WebView do
  Android). Instalado antes do conteúdo, porque o tema decide o botão ao
  montar a página.
- **Notas da revisão em inglês**, que é a língua da equipe de revisão, e da
  config no ar, que é a que o revisor abre. Prometer um recurso desligado é
  recusa na certa.
- **Universal Links pela Shopify, e não por arquivo nosso.** Numa loja
  Shopify, ninguém sobe arquivo em `/.well-known/` do domínio: quem publica o
  `apple-app-site-association` e o `assetlinks.json` é a Shopify, a partir do
  cadastro pela API de Mobile Platform Applications. O cadastro é
  idempotente (atualiza o do mesmo app, não mexe no de outra ferramenta), e
  a data de vínculo é gravada só pelo servidor, depois de a Shopify
  confirmar — com quem pediu na trilha. Uma falha não apaga o vínculo
  anterior: o que já está publicado continua publicado.
- **A permissão fica fora dos escopos padrão.** A Shopify libera
  `write_mobile_platform_applications` sob pedido; pedi-la na instalação
  antes disso quebraria a conexão de todo lojista. A tela distingue os três
  casos: a Shopify ainda não liberou para a Storefy, o lojista precisa
  reconectar para conceder, ou o app que o próprio lojista criou precisa da
  permissão.

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Testar o Face ID num iPhone e a digital num Android de verdade | time | build de desenvolvimento via EAS |
| Colar as notas na App Store Connect a cada envio | lojista | C12 › Notas para a revisão da Apple |
| Pedir à Shopify a permissão `write_mobile_platform_applications` para o app da Storefy e, liberada, somá-la a `SHOPIFY_SCOPES` | time | suporte da Shopify (Partner Dashboard) e Vercel |
| Colar a impressão digital SHA-256 do Play Console | lojista | C12 › Links da loja abrindo no app |

#### Fase 8b — Entregue (29/09/2026): observabilidade, status e revisão de segurança

| Item | Estado |
|---|---|
| Logs estruturados (`lib/log.ts`) | ✅ uma linha de JSON por acontecimento, com um `evento` estável para filtrar (`webhook-shopify.assinatura-invalida`, `job-despacho.falhou`). O que tem cara de segredo (token, senha, chave, cookie, DSN, coluna `_enc`) vira `[oculto]` em qualquer profundidade. Os cerca de 70 `console.*` soltos do servidor foram trocados |
| Erros do servidor para o Sentry | ✅ `instrumentation.ts` (`onRequestError`): página, rota de API, Server Action e proxy. Vai só o caminho, sem a query — um convite leva o token na URL |
| Erros do navegador | ✅ `instrumentation-client.ts`, a tela de erro e o `global-error`, por `sendBeacon` para `/api/erros`: corpo pequeno e conferido, teto por pessoa (o IP vira um resumo, e não é guardado) e no total, no máximo 5 por página; ruído de extensão e de rede fica de fora |
| Erros do app | ✅ o manipulador global do React Native relata e devolve o erro ao de antes; 5 por abertura, sem repetir o mesmo. `/api/public/errors` é assinado como os outros endpoints do app, com teto de 100 por app por hora. A pilha do Hermes é lida sem o `address at` |
| Sem `SENTRY_DSN` | ✅ nada sai e nada gasta banco; a A13 mostra "Alerta de erros (Sentry)" como opcional não configurado. O log estruturado registra tudo do mesmo jeito: o Sentry é o alarme, o log é o registro |
| Batimento das rotinas (`job_heartbeats`) | ✅ os quatro jobs do cron anotam sucesso, falha, desde quando falham sem parar e quanto levaram. Só o servidor grava; a equipe lê tudo; o público, só as datas |
| Página pública de status (`/status`) | ✅ sem login, com dados reais: o banco (e se está lento) e cada rotina pelo intervalo dela — "Funcionando", "Instável", "Parado" ou "Aguardando". Uma falha só é "Instável" (a próxima tenta de novo); "Parado" conta de quando começou a falhar. O texto do erro nunca sai para o público. Atualiza sozinha a cada minuto |
| A13 — Rotinas automáticas | ✅ a equipe vê a situação, a última execução, a duração e o último erro de cada rotina, com o link para a página de status |
| Revisão de segurança | ✅ ver abaixo |

**O que a revisão achou**

- **A política de privacidade pública lia o segredo cifrado do app.** A página
  `/privacy/<loja>` selecionava `device_secret_enc` só para saber se o app tinha
  push. O valor não chegava à tela, mas passava pela página pública. Virou uma
  contagem que não lê a coluna, e o teste falha se um `_enc` voltar a ser
  selecionado ali.
- **A A13 dizia "faltando" para variáveis configuradas.** A presença de cada
  variável vinha de uma lista escrita à mão, que tinha ficado sem
  `EMAIL_SUPORTE`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` e `ASAAS_API_URL`:
  configurar a Asaas não mudava nada na tela. Um teste novo confere que toda
  variável descrita é lida pelo nome.
- **O anônimo enxergava a tabela dos batimentos** — vazia pela RLS, mas
  enxergava. O `select` foi revogado; a página pública usa uma função que
  devolve só as datas.
- **Varredura de RLS.** Toda tabela do schema `public` tem RLS ligada, e
  nenhuma policy vale para `anon` ou `public`. Uma tabela nova que esquecer
  entra reprovando no `rls.test.sql`.
- **O teto do relatório de erros confundia "acima do limite" com "banco
  fora".** Agora banco fora é erro no log, e nada vai para o Sentry sem o teto
  — um erro em laço num aparelho esgotaria a cota do Sentry da Storefy.
- **O e2e usaria as integrações do `.env.local`.** Com o `SENTRY_DSN` de
  verdade lá, a suíte mandaria erro de mentira para o Sentry da Storefy (e a
  Resend, e-mail de verdade). O `scripts/e2e-local.sh` agora as deixa vazias,
  e reprova também quando o log estruturado registra `requisicao.falhou`.
- **O "Me avise quando voltar" nunca gravou um pedido.** O botão do tema
  mandava a mensagem, o app a transformava na ação `avisar-de-volta` — e o
  `switch` que executa as ações não tinha esse `case`. Nada chamava o
  endpoint, e o botão dizia "Pronto! Você será avisado." porque confirmava a
  ENTREGA ao app, e não a gravação. Agora o app pede a permissão de
  notificação antes (quem recusa não entra numa lista que nunca vai avisá-lo),
  grava o pedido (registrando o aparelho e tentando de novo se o servidor
  ainda não o conhece) e RESPONDE à página pelo bridge
  (`NOTIFY_WHEN_BACK_RESULT`). O botão só diz "pronto" com a resposta; sem
  ela, diz onde ligar as notificações ou que dá para tentar de novo. O lint
  agora exige `switch` exaustivo sobre uniões
  (`switch-exhaustiveness-check`), conferido pondo o defeito de volta.
- **Endpoints públicos conferidos um a um.** Os que o app escreve
  (`devices`, `events`, `back-in-stock`, `inbox`, `errors`) exigem a
  assinatura HMAC do app e têm teto por app — o do `back-in-stock` faltava, e
  entrou junto com um teto por aparelho; os webhooks conferem a
  assinatura (Shopify, EAS) ou o token (Asaas) em tempo constante; os jobs
  exigem o `CRON_SECRET`; os de leitura (`app-config`, `banner`,
  `preview-config`) só devolvem o que é público — a prévia, por um código de
  minutos guardado como hash.

**Decisões**

- **Sentry sem o SDK.** O `@sentry/nextjs` embrulha o build, o servidor e o
  navegador, e cada versão do Next muda o jeito de fazer isso — o painel roda
  num Next que o SDK ainda não acompanha. O que precisamos é pouco e estável:
  mandar o erro para a API de envelopes, o mesmo formato que o SDK usa por
  baixo. Sem dependência nova no build nem no app.
- **O relatório de erro nunca vira outro erro.** Sentry fora do ar, cota
  estourada ou DSN errado: o envio desiste em 3 segundos (5 no app) e deixa o
  motivo no log.
- **O critério de "parado" é o intervalo de cada rotina.** Cinco minutos sem o
  despacho de notificações é problema; cinco minutos sem o acompanhamento da
  revisão é o normal. Os intervalos da página são conferidos contra o
  `vercel.json` por teste.

Travas novas: grupos "batimento" e "varredura" no `rls.test.sql` (682
asserções no total), `lib/log.test.ts`, `lib/sentry.test.ts`,
`lib/erros-do-navegador.test.ts`, `lib/status.test.ts`, as rotas `/api/erros`
e `/api/public/errors` exercitadas de ponta a ponta, `nucleo/erros.test.ts` e
o contrato do relatório em `push/api.test.ts` no app, e `e2e/status.spec.ts`
(a página pública, o batimento e o erro visível só para a equipe). A suíte e2e
está em 40 testes.

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Criar o projeto no Sentry e pôr o DSN em `SENTRY_DSN` | time | sentry.io e Vercel |
| Configurar um alerta no Sentry (e-mail ou Slack) para erro novo | time | sentry.io › Alerts |
| Enviar os source maps do app ao Sentry, para a pilha do app sair legível | time | EAS (build) e sentry.io |
| Divulgar o endereço `/status` aos lojistas (Ajuda, e-mail de boas-vindas) | time | — |
| Publicar a extensão de tema com o botão novo do "Me avise" (`shopify app deploy`) | time | Shopify CLI, com o app no Partner Dashboard |
| Mandar a correção do app para as lojas por OTA | time | admin › "enviar correção OTA para todas as lojas" |

#### Fase 8c — Entregue (29/09/2026): Ajustes do app (M12) e busca nativa (M08)

A M12 estava no plano (9.3) e nos comentários do código ("quem já recusou é
atendido pela tela de ajustes do app (M12)") — mas não existia. E ela não é
enfeite: a Apple exige que o cliente possa parar de receber push de promoção
por um caminho DENTRO do app (4.5.4), e o Storefy é campanha de promoção.

| Item | Estado |
|---|---|
| Tela M12 | ✅ `telas/ajustes.tsx`: "Receber notificações" liga e desliga no app (`optIn`/`optOut` do OneSignal, sem mexer na permissão do sistema); bloqueadas no sistema, a tela diz isso e abre os ajustes do celular; política de privacidade; versão e build |
| Estado real, e atualizado | ✅ lido ao abrir a tela e quando a permissão muda — inclusive nos ajustes do celular, com o app em segundo plano; carregando e erro com "tentar de novo" |
| Entradas | ✅ engrenagem na caixa de avisos (M07); sem ela, a linha "Ajustes do app" no topo da aba Conta; e `Storefy.openAppSettings()` para a loja pôr um link onde quiser |
| Política pelo id do app | ✅ `/privacy/app/<appId>` leva à política da loja dona do app (o app sabe o próprio id, não o da loja) |
| Painel | ✅ o editor avisa quando o app fica sem entrada para os ajustes; a C12 trava o envio no item "Ajustes do app ao alcance do cliente"; as notas da revisão dizem ao revisor onde desligar as notificações; a política conta o caminho |
| "Me avise" com as notificações desligadas no app | ✅ pergunta antes de religar — religar liga também as promoções que a pessoa desligou |
| Checklist da C12 acessível | ✅ cada item diz "Pronto", "Falta" ou "Recomendado" a quem usa leitor de tela (antes, só o ícone dizia) |
| Fluxos do Maestro | ✅ sete fluxos em `apps/mobile/.maestro/`, com ids estáveis nas abas (pelo tipo, porque o nome muda de loja para loja) e um teste que confere cada texto e cada `id` contra o app — conferido pondo um botão renomeado e uma aba inexistente |
| Busca nativa (M08) | ✅ também faltava: a aba Busca só abria a página da loja, e um comentário dizia que o campo era nativo. Agora o campo é do app (tecla "Buscar", limpar, termo cortado em 100 caracteres) e leva a aba a `/search?q=` na busca da própria loja; as notas da revisão contam o recurso |

#### Fase 8d — Entregue (29/09/2026): "Sentimos sua falta" e as automações que nunca ligavam

| Item | Estado |
|---|---|
| Automação "Inativo há 7 dias" (C09) | ✅ o tipo existia no banco desde a Fase 3, sem gatilho. `agendar_inativos` acha quem abriu o app pela última vez há 7 a 9 dias (a folga cobre o cron parado), um aviso por sumiço (`trigger_ref`), na hora escolhida do 7º dia no fuso da loja; o despacho cancela o de quem voltou antes do envio. Job próprio de hora em hora (`/api/jobs/inactive-devices`), com batimento e linha na página de status. 14 asserções de RLS |
| Hora do envio, e não "atraso" | ✅ no "sentimos sua falta" o campo é "Horário do envio, no 7º dia" (8h a 20h); o resumo do card diz "envia no 7º dia sem abrir o app, às 10h" — e sempre do que está SALVO, não do que está sendo editado |

**O que o teste novo achou**

- **Três automações nunca ligavam pelo painel, e ligar uma delas estragava o
  carrinho abandonado.** O "estreitador" de tipo da ação de salvar foi escrito
  na Fase 3, quando só existiam boas-vindas e carrinho, e devolvia
  `abandoned_cart` para todo o resto: ligar "Pedido enviado" ou "De volta ao
  estoque" regravava o título, o texto e o atraso do carrinho abandonado. E a
  leitura da tela filtrava os mesmos dois tipos, então as outras apareciam
  sempre desligadas. Os dois lados agora usam `ehTipoDeAutomacao`, e o
  `e2e/automacoes.spec.ts` liga cada uma pela tela e confere o banco.
- **Leitura com erro virava lista vazia** nas telas de notificações: "nenhuma
  campanha" com o banco fora do ar, e o lojista criaria de novo a campanha que
  existe. Agora vira a tela de erro, com "tentar de novo".
- **A mesma doença em outras telas e rotas: leitura que joga o erro fora.**
  Uma varredura achou 32 leituras de tela, rota e loader do tipo
  `const { data } = await ...`, sem olhar o `error`. Com o banco fora do ar,
  a C12 dizia "não encontramos o app", o editor dizia "nunca publicado", a
  política pública (que o revisor da Apple abre) respondia 404, o job da
  revisão da Apple deixava de gravar uma decisão sem avisar ninguém, e o
  workflow do build ouvia "build não encontrado" sobre um build que existe.
  Agora cada uma passa por `lido()` (vira a tela de erro, ou 503 nas rotas)
  ou trata o erro; os testes de autorização continuam negando na dúvida, mas
  registram por quê. O job da revisão conta as decisões que não gravou, e o
  batimento dele fica "instável". `lib/leituras-com-erro.test.ts` reprova
  leitura nova que jogue o erro fora — conferido pondo uma de volta. As ações
  de servidor ficam fora da varredura: nelas a falha já vira mensagem de erro
  para quem clicou (às vezes "não encontrada" quando o certo seria "tente de
  novo"), nunca um sucesso falso.
- **Dois textos de "em breve" que envelheceram:** a tela de automações
  prometia "numa próxima atualização" três automações que já estavam nela, e a
  A08 dizia que o custo em reais "entra na Fase 7" — que já foi entregue e não
  é de onde esse custo vem (ele depende do contrato da Storefy com a
  OneSignal).

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Rodar os fluxos do Maestro num simulador do iOS e num emulador do Android, com o build de desenvolvimento da loja de teste | time | `apps/mobile/.maestro/README.md` |
| Conferir o "Desligar notificações" num iPhone de verdade antes do primeiro envio à Apple | time | build de desenvolvimento via EAS |

#### Fase 8e — Entregue (29/09/2026): Klaviyo, Omnisend e outras ferramentas (C09 e C14)

| Item | Estado |
|---|---|
| Automação "Klaviyo, Omnisend e outras ferramentas" (C09) | ✅ o `custom_webhook` existia no enum desde a Fase 3, sem quem o chamasse. Agora o fluxo da ferramenta (a ação "Webhook" do Klaviyo, a do Omnisend, um nó do n8n ou do Zapier) chama `POST /api/webhooks/automacao` com a chave da loja e diz quem recebe — `customerId`, `customerIds` (até 50) ou `email` — e, se quiser, o título, o texto, o link e o id do evento. A Storefy acha os aparelhos desse cliente no app da chave, até 10 por cliente, e agenda pelo mesmo despacho das outras automações, com a madrugada respeitada. Sem texto no chamado, vai o da automação |
| A chave | ✅ gerada no servidor (`sfy_wh_` + 32 bytes aleatórios), mostrada uma vez, guardada só como sha256 numa coluna que ninguém do painel lê (grant de coluna: nem o `select *` passa). Trocar derruba a anterior na hora; desativar tira do ar; as duas pedem confirmação. Gerar, trocar e desativar entram na trilha em nome de quem fez, sem o hash; os avisos recebidos não enchem a trilha. Só proprietário e administrador mexem — o membro vê a dica, a data e a contagem |
| Cliente pelo e-mail | ✅ a ferramenta de e-mail conhece o cliente pelo e-mail; o app, pelo id da Shopify. A ponte é a busca de clientes da Admin API, com a conexão da loja, e o e-mail não é guardado em lugar nenhum. As recusas respondem diferente porque pedem coisas diferentes: loja sem conexão ou sem permissão (422, reconectar), Shopify sem liberar dados de cliente ao app público (422, mandar o `customerId`), Shopify fora do ar (503, tentar de novo) |
| O app diz quem é o cliente | ✅ o app já detectava o cliente logado (`__st.cid`), mas não gravava no aparelho: agora `vincularCliente` registra o `externalId`, que é o que o webhook procura |
| Respostas que dizem o que fazer | ✅ 401 chave errada ou trocada ("gere outra no painel"), 403 automação desligada — e a chegada fica anotada, para o card avisar "a sua ferramenta está chamando, mas a automação está desligada" —, 400 com o campo e o formato certo (id de cliente que não é da Shopify, e-mail inválido, texto longo), 413 corpo acima de 8 KB, 429 acima de 600 por minuto por automação, 202 com quantos aparelhos vão receber (cliente sem o app é 0, não erro). O mesmo `id` de evento não agenda duas vezes, nem com as duas entregas chegando juntas: quem segura é um índice único |
| C14 — Integrações | ✅ cartão "Klaviyo, Omnisend e outras ferramentas" com o estado (não conectada, ligada, desligada, último aviso), levando à automação — a chave mora num lugar só, porque duas telas gerando chave seriam duas chaves, uma desfazendo a outra. Cartão do Meta Pixel explicando que o pixel da loja já registra o que acontece no app (as páginas e o checkout abrem na WebView com os scripts do site), sem botão, porque não há o que configurar |
| Testes | ✅ 40 asserções de RLS (hash ilegível, só o servidor grava, isolamento entre organizações, dez aparelhos por cliente, evento repetido, texto do envio no despacho, troca, desativação, trilha sem hash); 27 casos da rota; 9 da busca pelo e-mail; 20 da chave e do corpo. O e2e gera a chave pela tela, chama o endereço com a automação desligada e ligada, repete o evento, troca a chave (a velha vira 401), desativa, confere a trilha e a C14; e o membro vê a chave sem poder mexer. Conferido em 1280 e 390 px, sem rolagem lateral |

**O que a revisão achou**

- **O teto de aparelhos era da chamada, e não do cliente.** Com 50 clientes
  numa chamada, só os 10 aparelhos mais recentes do conjunto recebiam o push.
  O teto agora é por cliente, e o teste de RLS pega a volta do erro —
  conferido pondo o `limit 10` de volta.
- **A recusa da Shopify por "dados protegidos" virava "falta permissão".** O
  app público precisa da aprovação da Shopify para ler clientes, e reconectar
  a loja não resolve isso. `consultarAdmin` agora diz a causa da recusa, e a
  rota responde o que de fato resolve.
- **Um `customerId` que não é da Shopify respondia 202 com 0 aparelhos**, e
  quem configurava a ferramenta achava que o cliente só não tinha o app.
  Agora é 400, dizendo o formato.
- **O teto por minuto era contado antes de achar a chave**: cada chave
  inventada por quem varresse a rota viraria uma linha no banco. Agora a
  chave é conferida primeiro, e o teto é da automação.
- **"Zapier" reprovava o teste de jargão**, por conter "api". O teste agora
  olha a palavra inteira.

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Pedir à Shopify o acesso a dados protegidos de cliente (incluindo o e-mail) para o app público da Storefy. Sem ele, as lojas conectadas pelo OAuth mandam o `customerId` no lugar do e-mail — a resposta 422 diz isso a quem configura | time | Partner Dashboard › app › API access › Protected customer data |
| Conferir num fluxo real do Klaviyo (ação "Webhook") e do Omnisend (plano pago) com uma loja piloto | time | contas da loja piloto |

#### Fase 8f — Entregue (29/09/2026): o segredo do app, que nenhum build levava

| Item | Estado |
|---|---|
| O defeito | ❌→✅ nada criava o segredo com que o app assina o que manda. A função que o gerava não tinha quem a chamasse, `apps.device_secret_enc` ficava nulo, e todo build saía com `deviceSecret` nulo. O app, sem com que assinar, desistia em silêncio: não registrava o aparelho nem mandava evento de carrinho, erro ou "me avise" — push, automações e números paravam na origem, e nenhum teste via, porque cada ponta era testada com um segredo que o teste mesmo punha |
| O segredo nasce no build | ✅ `garantirSegredoDoApp` cria o segredo no primeiro build da loja (32 bytes, gravado cifrado) e o devolve em claro só ao workflow; os builds seguintes levam o MESMO — é com ele que os apps instalados assinam. O iOS e o Android pedindo ao mesmo tempo não criam dois: a gravação só vale com a coluna vazia, e quem perde a corrida usa o do vencedor |
| A correção OTA leva o segredo aos apps antigos | ✅ a etapa da loja cria o segredo se ela ainda não tem, e o pacote OTA o entrega aos apps gerados antes desta correção |
| Segredo que não abre | ✅ falha alto (503, o build fica na fila, `segredo-do-app.ilegivel` no log) em vez de gerar outro por cima: quase sempre é a `ENCRYPTION_KEY` errada no servidor, e trocar derrubaria todos os apps instalados da loja |
| Os workflows | ✅ o de build e o de OTA param com erro se a resposta vier sem segredo, em vez de gerar um binário mudo; o da OTA passou a mascarar o segredo no log, como o de build já fazia |
| Testes | ✅ 9 da função (inclusive a corrida), 3 na rota do build, 3 na da OTA; e um e2e que faz o papel do workflow: publica pela tela, pede o build, recebe o segredo, registra o aparelho com uma assinatura calculada do zero, vê a assinatura falsa ser recusada e o build da outra plataforma levar o mesmo segredo |

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Se um dia o log mostrar `segredo-do-app.ilegivel`: conferir a `ENCRYPTION_KEY` do servidor. Só se o valor estiver de fato perdido, zerar `apps.device_secret_enc` daquele app — o próximo build cria outro, e os apps já instalados voltam a falar com o servidor quando receberem o build ou a correção OTA | time | Vercel (variáveis) e SQL no Supabase |

#### Fase 8g — Entregue (29/09/2026): o começo guiado (C03 e C04) e o checklist do painel

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o plano pedia três passos no começo de cada loja — a URL (C02), o visual rápido com prévia ao vivo (C03) e o app no celular com o "tudo pronto" (C04) —, e o cadastro caía direto na página da loja. A seção 10 pedia um checklist de progresso no painel até o app estar no ar, e o painel tinha só quatro atalhos fixos |
| C03 — visual rápido | ✅ o cadastro segue para `/lojas/<id>/comecar`: a cor da marca (a detectada na página, editável), o ícone e as abas sugeridas, com a MESMA prévia ao vivo do editor. "Salvar e continuar" grava no rascunho (nada vai ao ar); sem mudança, segue sem tocar no rascunho; "Pular por agora" não grava nada; o mínimo de duas abas é travado na tela; membro vê e não muda |
| C04 — no celular e tudo pronto | ✅ o código do Storefy Preview (QR e texto) e o checklist com o estado de verdade. Aberto com OUTRA loja ativa no painel, avisa e oferece a troca — os atalhos valem para a loja ativa |
| Onde baixar o Storefy Preview | ✅ duas chaves novas na A13 (migration 50), conferidas (só App Store/TestFlight no iPhone, só Google Play no Android, sempre `https`) e auditadas. Sem link, o editor e o C04 dizem que o app ainda não está disponível, em vez de um botão para lugar nenhum |
| Checklist dos primeiros passos | ✅ sete passos — loja, ícone e tela de abertura, app publicado, Shopify, contas Apple e Google, enviado às lojas, aprovado —, calculados do mesmo estado da tela de publicação (C12), no C04 e no topo do painel até o app ser aprovado |
| Leituras em `Promise.all` que jogavam o erro fora | ✅ a varredura da Fase 8d só via `const { data } = await`; a mesma doença morava em 15 leituras dentro de `Promise.all`. A pior: com a leitura do rascunho falhando, `garantirRascunho` criava um rascunho NOVO, com a config padrão, por cima do que o lojista vinha editando — o editor passava a abrir esse. As outras: "nada publicado" na publicação, "sem empresa" para quem tem, "convite indisponível" com o banco fora, 404 de cliente que existe no admin, e o destravar dos envios presos falhando calado. `lib/leituras-com-erro.test.ts` agora pega as duas formas (conferido pondo uma de volta) |
| Testes | ✅ 7 do checklist, 4 do rascunho com o banco falhando, 5 dos links do Preview; RLS da chave nova; e2e do começo inteiro (cor e abas gravadas no rascunho, código gerado, checklist no C04 e no painel, pular, a troca de loja, os links publicados na A13 com a recusa do link errado e a trilha), do membro e do 404 |

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Publicar o app Storefy Preview (uma vez, na conta da Storefy) e colar os dois links na A13 | time | App Store Connect, Google Play Console e `/admin/sistema` |

#### Fase 8h — Entregue (29/09/2026): o editor que salva sozinho e a moldura de iPhone e Android

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ a seção 10 pede salvamento automático do rascunho, um botão fixo "Publicar alterações" com o contador de mudanças pendentes e a moldura alternando entre iPhone e Android. O editor tinha "Salvar rascunho" e "Publicar" separados — quem esquecia de salvar perdia o que fez —, e a moldura era só de iPhone |
| Salvamento automático | ✅ o rascunho grava um segundo depois da última mudança, uma gravação por vez: a seguinte espera a anterior, e uma mais velha nunca termina por cima de uma mais nova. A barra diz "Salvando o rascunho…", "Rascunho salvo às 14:32" (no fuso da loja) ou o motivo de não ter salvo, com "Tentar de novo" ali mesmo. Com um ponto a corrigir (duas abas com o mesmo nome, por exemplo) não grava: o rascunho no banco continua publicável |
| O que se digita com a gravação a caminho | ❌→✅ achado pelo e2e: cada gravação atualiza a página, e o editor adotava a config que voltava do servidor — apagando o que a pessoa digitou enquanto a gravação ia e voltava, com a barra dizendo "salvo". Agora a config do servidor só substitui a tela quando traz OUTRO conteúdo (uma versão restaurada); a volta de uma gravação, ou a publicação do que já estava salvo, passam direto. A comparação ignora `version` e `store`, que o servidor reescreve, e a ordem das chaves, que o jsonb não guarda |
| Sair da tela no meio da pausa | ❌→✅ também achado pelo e2e: mudar a cor e clicar em outra seção do menu antes de um segundo perdia a mudança — o aviso do navegador só pega fechar ou recarregar a aba. A gravação que esperava sai na hora, na mesma fila, e um erro nela vira aviso na tela seguinte. Trocar de loja monta outro editor: nada da loja anterior passa para a nova |
| "Publicar alterações" fixo, com contador | ✅ fixo no rodapé, com quantas mudanças o rascunho tem em relação à versão no ar — por ajuste, e não por campo do JSON: cada cor conta uma; nas abas, cada aba nova, removida ou alterada conta uma, e mudar a ordem conta uma a mais. Só destrava com o rascunho salvo: publicar lê o rascunho do banco, e publicar com uma mudança ainda não gravada poria no ar a versão anterior dela. Sem mudanças, diz "Igual à versão no ar" e o botão fica desligado |
| Desfazer mudanças | ✅ o descarte que o salvamento automático tinha tirado (achado pela auditoria da Fase 8j): volta o rascunho ao que está no ar, com uma confirmação que diz quantas mudanças se perdem e que nome, ícone e tela de abertura não entram. Feito na tela e gravado pela mesma fila do salvamento — sem ida ao servidor para "restaurar", nenhuma gravação atrasada desfaz o desfazer. O diálogo dos presets, que prometia "dá para descartar antes de publicar", voltou a dizer a verdade |
| Moldura de iPhone e Android | ✅ a ilha e o indicador de início no iPhone, a câmera furada e a barra de gestos no Android, no editor (C06) e no visual rápido (C03). A escolha é de quem olha e fica no navegador (não é dado sensível), lida sem brigar com a hidratação; com o armazenamento bloqueado, vale até fechar a página |
| Claro e escuro | ➖ fora de propósito: o app roda sempre claro (`userInterfaceStyle: 'light'` no `app.config.ts`), com as cores da loja; um modo escuro na prévia mostraria um app que não existe. Se o app ganhar tema escuro, a alternância entra junto |
| Testes | ✅ 9 do contador (inclusive a mesma aba com as chaves em outra ordem) e 6 da escolha do aparelho (inclusive armazenamento bloqueado na leitura e na gravação). E2e do editor: primeira publicação, a cor gravada sozinha (no banco e depois de recarregar), a gravação segurada por duas abas com o mesmo nome, o contador em 1 e 2, a nova publicação, a moldura trocando e lembrando o Android, a restauração de uma versão trocando a tela; e, com a gravação presa no caminho, o nome digitado que fica na tela e vai ao banco, e a mudança gravada ao sair pelo menu |

#### Fase 8i — Entregue (29/09/2026): o aviso no topo do app (C06e)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C06e pede "aviso no topo", e o campo `announcement` existia no contrato desde a Fase 2 sem ninguém que o escrevesse nem o desenhasse: nem o editor, nem o app |
| No editor (C06e › Recursos) | ✅ ligar e desligar, o texto (até 80 caracteres, com o contador — é o que cabe em duas linhas ao lado do "fechar" num celular pequeno) e um link opcional. Ligado sem texto, texto longo demais ou link de fora da loja são pontos a corrigir, e o rascunho não grava até resolver. Desligar guarda o texto para a próxima vez. A moldura da prévia mostra a faixa enquanto se digita |
| O link | ✅ só endereço DA LOJA — caminho (`/collections/promo`) ou URL de um domínio dela, com os subdomínios. É a mesma regra do toque numa notificação: um aviso escrito num painel levando a um site qualquer, sem barra de endereço e com o nome da loja em volta, seria uma tela de phishing pronta. No app, link que escape disso vira aviso só de texto |
| No app (casca da loja, M04) | ✅ a faixa nas cores da marca, abaixo da barra de status e em cima de todas as abas; com link, o toque abre a página na aba que cuida dela. O "fechar" tem área de toque própria, e o aviso fechado só volta quando o TEXTO muda (guardado no aparelho): ver o mesmo aviso a cada abertura ensina a ignorá-lo |
| Compatibilidade | ✅ o campo já era opcional no contrato: config antiga, sem ele, é "desligado" no editor e no app |
| Testes | ✅ 6 do editor (config antiga, link apagado, texto vazio e longo, links da loja e de fora); 7 no app (config antiga, desligado, texto, links da loja com busca e âncora, link de fora e `javascript:`, fechar por texto); e2e do editor (ligar, recusas, prévia, gravação, desligar guardando o texto); fluxo do Maestro `aviso.yaml` (aparece, fecha e não volta) |

#### Fase 8j — Entregue (29/09/2026): a identidade do app — identificador, app na Apple e nome

Achado pela auditoria das telas contra o plano (seções 9 e 10), feita por um agente e conferida no código.

| Item | Estado |
|---|---|
| O defeito | ❌→✅ o checklist da publicação exigia o identificador do app no iPhone e no Android e dizia "a Storefy define" — e nada definia. `bundle_id_ios` e `package_android` ficavam nulos para sempre: o botão de publicar nunca destravava, ligar as notificações recusava por falta do identificador e o banner "baixe o app" nunca aparecia. Nenhum lojista conseguia publicar |
| O identificador, preenchido pela Storefy | ✅ cartão no topo da Publicação (C12), com a sugestão já no campo: o domínio da loja ao contrário (`oakvintage.com.br` → `br.com.oakvintage.app`), sem hífen, acento ou número na frente, sem palavra reservada do Android e sem carregar "myshopify". A sugestão pula para `…app2` quando outro app da Storefy já tem a primeira. O mesmo identificador nas duas lojas; o formato é o que a Apple E o Google aceitam, conferido na tela e no banco |
| Trava depois de usado | ✅ no banco (migration 51): o identificador não muda depois que um binário foi gerado ou que o app foi criado na Apple — trocar criaria outro app, sem as avaliações nem os downloads do primeiro. Build que morreu antes do binário não trava. A tela deixa de oferecer a troca e diz por quê |
| O app na Apple | ✅ com a conta Apple conectada, o identificador é registrado na conta do lojista pela API (Certificates, Identifiers & Profiles) — ao salvar, ao conectar a conta, ou pelo botão de tentar de novo. Criar o app no App Store Connect a API da Apple não deixa ninguém fazer: o cartão guia o passo com os valores prontos para copiar (nome, idioma, ID do pacote, SKU), e o "Já criei o app" procura o app na conta do lojista e guarda o número dele. Novo item obrigatório no checklist do iPhone: "App criado no App Store Connect" — sem ele, o envio morreria no fim de um build de vinte minutos |
| O envio à App Store | ✅ o número do app segue para o `eas submit` (`ascAppId`, pelo `eas.json`): com chave de API, o EAS não cria o app nem garante achá-lo sozinho. O workflow de envio para com erro claro se o número faltar |
| O nome do app (C06a) | ✅ campo "Nome do app" na Aparência do editor, com o contador dos 30 caracteres da App Store e o aviso de que embaixo do ícone o iPhone mostra uns 12. Fora do rascunho, com botão próprio: o nome vai no binário e muda no próximo envio. Antes, o nome nascia do nome da loja e não mudava nunca — uma loja de nome longo ficava presa no item do checklist |
| Só o servidor escreve no app | ✅ o dono e o administrador podiam mudar pela API, direto, o projeto do Expo, o app do OneSignal e os identificadores. Agora a sessão grava só as impressões digitais do Android e a versão no ar (esta por `publicar_config`, que roda com o papel de quem publica — o teste de RLS pegou a quebra antes de ir ao ar). Identificador, nome e número da Apple passam por funções que conferem e creditam quem pediu na trilha |
| Testes | ✅ 9 do identificador (sugestão, limpeza, palavras reservadas, formato), 9 do cliente da Apple contra uma App Store Connect falsa (já registrado, prefixo parecido, 409 de outra conta, 401 e 403, sem rede, app achado ou não), 2 do checklist; RLS: 22 da identidade (sessão sem escrita, funções só do servidor, formato, unicidade, trava pelo binário e pelo app na Apple, trilha) e a lista nominal do que a sessão grava em `apps`; e2e: sugestão, recusa do hífen, gravação, checklist, troca, trava; a sugestão que pula a ocupada; o membro só lendo; o nome no editor |

**Depende de ação humana**

| O quê | Quem | Onde |
|---|---|---|
| Conferir numa loja piloto, com uma conta Apple de verdade, o registro do identificador pela chave de API (papel Admin) e o `eas submit` achando o app pelo `ascAppId` | time | App Store Connect da loja piloto |
| Criar o app no App Store Connect (uma vez por loja, guiado na Publicação) | lojista | App Store Connect |

#### Fase 8k — Entregue (29/09/2026): o status da loja segue o app

Também achado pela auditoria das telas contra o plano.

| Item | Estado |
|---|---|
| O defeito | ❌→✅ `stores.status` aparece no painel (C05, lista e página da loja) e no admin (o A02 conta "apps no ar" e "em revisão" por ele) — e nada o mudava. Toda loja era "Rascunho" para sempre, mesmo com o app aprovado, e o A02 dizia zero apps no ar. A coluna ainda era gravável pela sessão: o dono podia se declarar "No ar" pela API |
| Derivado dos builds, no banco | ✅ um gatilho em `builds` recalcula o status da loja a cada build novo, mudança de status ou exclusão (migration 53): "No ar" com algum build aprovado — e continua no ar enquanto uma atualização passa pela revisão —, "Em revisão" com algum enviado, "Gerando app" com algum na fila, gerando ou pronto para enviar, "Revisão recusada" quando o último desfecho foi a recusa e nada novo está em curso, e "Rascunho" sem nada disso. "Pausada" é decisão de pessoa, e o gatilho não a desfaz. As lojas que já existiam foram recalculadas na migração |
| "Revisão recusada" | ✅ estado novo (migration 52, numa migração só dele: valor novo de enum não pode ser usado na transação em que nasce). No painel, em vermelho, com a frase de onde está o motivo; antes, um app recusado aparecia como rascunho |
| Só o banco escreve | ✅ a sessão perdeu o `insert` e o `update` da coluna; a varredura de colunas graváveis da RLS lista a exceção pelo nome |
| Testes | ✅ RLS: 11 do status (rascunho, a API recusada, gerando, em revisão, recusado, gerando de novo, no ar, atualização em revisão sem tirar do ar, trilha, pausada que não muda, o cálculo) e o resumo do A02 agora plantado com builds de verdade; e2e: o cartão do painel passando por gerando, em revisão, recusado (com a frase do motivo) e no ar, e a lista de lojas |

#### Fase 8l — Entregue (29/09/2026): A12 e A04 — quem fez o quê

| Item | Estado |
|---|---|
| O defeito | ❌→✅ a A12 promete "quem fez o quê", e a tela mostrava só o quê: `actor_id` era gravado desde a Fase 0 e nunca lido. A Fase 3 deixou o autor para a Fase 6, e a Fase 6 fechou a A12 sem ele. A A04 também não tinha a trilha do cliente |
| Quem, em cada linha | ✅ coluna "Quem" na A12: o nome (com o e-mail embaixo) de quem fez; "Equipe" quando foi alguém da Storefy — uma ação do suporte num cliente não pode parecer do cliente —; "O sistema" quando não há autor (gatilho, rotina, aviso da Shopify, do EAS ou do Asaas); "Conta excluída" quando a pessoa já saiu. O e-mail vem de `admin_autores_da_auditoria` (migration 54), que só responde à equipe da plataforma e só dos ids pedidos |
| A trilha do cliente | ✅ cartão "Últimas ações" na A04, com o autor, e "Ver toda a trilha" abrindo a A12 filtrada pela organização (`?org=`); a busca por entidade mantém o filtro; um id que não é de nada não quebra a tela |
| Testes | ✅ 4 do rótulo do autor; RLS: 4 (usuário comum recusado, e-mail lido pela equipe, marca de equipe, lista vazia); e2e: o lojista pelo e-mail na A04 e na A12, o filtro que sobrevive à busca, "O sistema" para o build movido pelo workflow e o filtro inválido |

#### Fase 8m — Entregue (29/09/2026): comparar versões (C06f) e o que vai ao ar

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C06f pede "comparar e restaurar", e o histórico só restaurava: o lojista escolhia uma versão por número e data, sem saber o que ela trazia. E o "Publicar a versão N?" não dizia o que ia ao ar |
| As mudanças em frases | ✅ `diferencasDaConfig` descreve o que muda de uma config para outra, por seção do editor e sem jargão: "Cor principal: #111827 → #be123c", "Aba “Buscar” agora se chama “Procurar”", "Aba nova", "Nova ordem das abas", "Itens escondidos da loja: passa a esconder…; volta a mostrar…", "Aviso no topo: ligado", "Atualização obrigatória: exige a versão 1.0.12". Um campo que o contrato ganhe depois aparece como ajuste genérico em vez de sumir da conta |
| Uma fonte só para o contador | ✅ o número do "Publicar alterações" passou a ser o tamanho desta lista: o botão nunca discorda do que o diálogo mostra |
| Ao publicar | ✅ o diálogo lista "O que vai ao ar", agrupado por seção (até oito, e "e mais N"); na primeira publicação, diz que o app passa a usar tudo o que está no rascunho |
| Comparar no histórico | ✅ cada versão tem "Comparar": o que muda no rascunho se ela for restaurada, com carregando, erro com "Tentar de novo" e "igual ao seu rascunho"; dali, "Restaurar esta versão" leva à confirmação de sempre. Quem é membro compara e não restaura |
| Testes | ✅ 8 das frases (cores, abas em todas as formas, itens escondidos, recursos, aviso, config antiga, dados da loja) e os 9 do contador, agora sobre a mesma lista; e2e: o diálogo de publicar com as frases e a comparação levando à restauração |

#### Fase 8n — Entregue (29/09/2026): arrastar e soltar as abas (C06b)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C06b pede "arrastar e soltar", e as abas só mudavam de ordem pelas setas, uma posição por clique |
| O gesto | ✅ cada aba tem pontinhos à esquerda: pega com o mouse ou com o dedo, a aba acompanha o ponteiro com sombra, e as vizinhas deslizam para abrir o espaço onde ela vai cair. Soltar grava sozinho, como toda mudança do editor, e a prévia troca a ordem na hora. Escape (ou o sistema tirando o ponteiro, numa ligação) desiste sem mudar nada |
| Lista maior que a janela | ✅ levar a aba até a borda de cima ou de baixo rola a página, e a roda do mouse no meio do arraste também vale: a conta é feita a partir do topo da lista, e não da janela, então a aba segue debaixo do ponteiro enquanto a página rola |
| Teclado e leitor de tela | ✅ as setas continuam sendo o caminho de quem não arrasta, e ficaram melhores: o foco acompanha a aba ao subir e ao descer (antes, descer tirava a aba do lugar na página e o foco sumia), e passa para a outra seta quando a aba chega ao topo ou ao fim. Toda mudança de ordem é anunciada ("“Conta” agora é a 1ª de 4 abas."), e remover uma aba leva o foco para a que ficou no lugar |
| Sem biblioteca nova | ✅ o levantamento apontava `@hello-pangea/dnd`; o arraste saiu com eventos de ponteiro, em pouco mais de cem linhas, porque as abas têm campos de texto dentro e a biblioteca traria um modo de teclado próprio competindo com eles — as setas já resolvem isso |
| Quem é membro | ✅ vê a ordem, sem pontinhos e com as setas desligadas |
| Testes | ✅ 13 da conta do arraste (destino, quem desliza, velocidade da rolagem na borda, anúncio); e2e com o mouse de verdade: arrastar para o topo (lista, prévia e banco), Escape desiste, setas com foco e anúncio, remover, rolagem pela borda numa janela baixa, "Nova ordem das abas" no diálogo de publicar e o membro sem o que arrastar |

#### Fase 8o — Entregue (29/09/2026): a equipe entra com dois fatores (A01)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o plano pede "Apenas `platform_admins` + 2FA" na A01, e o admin entrava só com a senha. Quem é da equipe enxerga todos os clientes: uma senha vazada virava esse acesso inteiro |
| Primeiro acesso | ✅ depois da senha, quem é da equipe e ainda não tem o app autenticador vai para /admin/ativar-2fa (A01b): explica o porquê, mostra o QR code e a chave para digitar (em grupos de quatro, com botão de copiar) e pede o primeiro código. Código errado ou incompleto é recusado embaixo do campo, com o número ainda lá e selecionado; "Gerar outro QR code" recomeça, e o cadastro abandonado antes sai do Auth. A ativação fica na auditoria |
| Acessos seguintes | ✅ senha e depois o código em /admin/verificar (A01c). Toda tela do painel, e toda ação, passa pela mesma guarda: com a senha certa e sem o código, nenhuma abre |
| A mesma trava no banco | ✅ `is_platform_admin()` passou a exigir a sessão `aal2`, que o Auth só emite depois do código. Sem isso, a sessão só da senha chamaria a API do Supabase direto com a chave anônima do navegador, e cada policy que termina em `or is_platform_admin()` abriria os dados de todos os clientes — a tela guardada não serviria de nada |
| Perdeu o celular | ✅ na A11, a coluna "Verificação em duas etapas" diz quem já ativou; o superadmin tem "Redefinir verificação" (com confirmação) nas linhas de quem tem o app: numa transação só, os fatores saem, as sessões abertas da pessoa acabam — o celular perdido perde o acesso agora, e não quando o token vencer — e a auditoria registra quem fez. Suporte não redefine, ninguém redefine o próprio. Sem outro superadmin, `pnpm bootstrap:admin email --redefinir-2fa` é a saída de emergência |
| Sair | ✅ o "Sair" do admin e das telas do segundo fator volta ao login do admin, e não ao do lojista |
| Testes | ✅ 16 das regras do segundo fator (situação, código digitado, chave, QR, mensagens do Auth), 5 da permissão de redefinir; RLS: 19 (só com a senha a equipe é usuário comum, lê a própria linha e nada mais; com o código volta a ser equipe; redefinir é só do servidor e só de superadmin, apaga fatores e sessões e audita); e2e: primeiro acesso com QR, erro e troca de chave, acesso seguinte com código, a API direto com a sessão só da senha, e a redefinição pela A11 derrubando a sessão aberta do suporte. As 9 suítes que usam o admin passam pelo segundo fator de verdade (TOTP calculado como o celular, RFC 6238) |
| Depende de ação humana | ⏳ conferir no Supabase de produção, em Authentication → Multi-Factor, que o app autenticador (TOTP) está ligado — no hospedado ele vem ligado; no local, o `config.toml` agora liga. Cada pessoa da equipe cadastra o próprio app no primeiro acesso |

#### Fase 8p — Entregue (29/09/2026): imagem, público e emoji na campanha (C08)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C08 pede "título, texto, emoji, imagem, deep link, público". As colunas `image_path` e `segment` existiam, mas nenhuma tela as preenchia: toda campanha ia sem imagem e para todo mundo |
| Imagem | ✅ o lojista escolhe a foto que tiver (JPG, PNG ou WebP, até 8 MB); o servidor gira pela câmera, reduz para 1440 px, tira a transparência (que vira preto em muitos Androids) e regrava em JPEG leve. Vai para o bucket público `push-imagens` com um nome aleatório na pasta da loja — a OneSignal e o celular baixam sozinhos, na hora da entrega. Foto pequena demais ou que não é imagem é recusada com o motivo; fora da proporção 2:1, entra com o aviso do corte no Android. Enquanto ela sobe, salvar e enviar esperam: a campanha não sai sem a imagem que o lojista acabou de escolher. Sai nos dois campos da OneSignal: `big_picture` (Android) e `ios_attachments` (a extensão de notificação que o plugin da OneSignal põe no app baixa no iPhone) |
| A imagem é da loja, e some quando sobra | ✅ o banco só aceita caminho do bucket, da loja da própria campanha (trava + gatilho); ao salvar, o servidor confere que o arquivo ainda existe. Imagem que ninguém usa há um dia (formulário abandonado, trocada, campanha excluída) o job de estatísticas apaga pelo Storage |
| Público | ✅ "Quem recebe": todos; quem já comprou pelo app; quem ainda não comprou; quem está com o carrinho aberto; quem não abre o app há N dias; quem abriu nos últimos N dias — as marcas que o app já grava no OneSignal, viradas filtro na hora do envio. O banco só aceita esses públicos (o CHECK com `coalesce`, porque um CHECK que dá nulo passa). A tela avisa que campanha com público não entra na caixa de avisos do app, e a confirmação de "enviar agora" diz para quem vai |
| Emoji | ✅ um seletor ao lado do título e da mensagem, com os emojis que o comércio usa, cada um com nome para o leitor de tela. Entra onde o cursor estava (ou no fim, se o campo nunca foi tocado), respeita o limite de caracteres e devolve o cursor para logo depois dele |
| Prévia, teste, lista e detalhe | ✅ a prévia mostra a imagem como cada aparelho mostra (miniatura no iPhone, larga no Android); o envio de teste leva a imagem; a lista e o detalhe (C10) dizem para quem foi a campanha |
| Defeito achado no caminho | ❌→✅ as Server Actions do Next aceitam 1 MB por padrão, e o ícone e a tela de abertura prometiam 8 MB: acima de 1 MB o envio morria antes da validação, com erro genérico. O limite subiu para 9 MB (o arquivo mais a folga do multipart), e a tela confere os 8 MB antes de subir |
| Testes | ✅ 10 do público, 7 do preparo da imagem (com imagens reais do sharp: 2:1, foto grande reduzida, transparência virando branco, orientação da câmera, pequena, não-imagem), 4 novos do corpo da OneSignal, 5 dos jobs (imagem e público no despacho, limpeza das órfãs, Storage fora do ar); RLS: 15 (imagem de outra loja e de fora recusadas, públicos válidos e inválidos, policies do bucket por papel e por organização, órfãs só as velhas, despacho levando imagem e público); e2e: emoji no cursor e no fim, imagem recusada de três jeitos, aviso de proporção, prévia, público com prazo e erro, confirmação dizendo o público, banco com JPEG da própria loja, lista, detalhe e edição tirando a imagem |

#### Fase 8q — Entregue (29/09/2026): quanto cada notificação vendeu (C07, C09 e C10)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C07 pede "receita" por campanha e o C10 pede "funil", mas nada ligava um pedido à notificação que o trouxe: a receita do app existia (marca `_storefy`), a do push, não |
| A corrente | ✅ a mesma da marca do app, com um elo a mais. O despachante põe o id da campanha (ou da automação) nos dados da notificação; o app, quando o cliente toca, guarda a origem e a hora do toque (na memória e no disco); a página grava `_storefy_push` no carrinho junto com `_storefy`; a Shopify leva o atributo até o pedido; e o webhook `orders/create` passa a origem para `registrar_pedido`. O envio de teste não leva origem: o toque do lojista no próprio celular não é venda |
| Três dias, conferidos dos dois lados | ✅ um toque responde pela compra por 3 dias. O app só grava o atributo enquanto o toque vale, e o webhook confere a hora do toque (que viaja no próprio atributo, `c:<id>:<segundos>`) contra a hora do pedido, com uma hora de folga para o relógio do celular: um carrinho parado guarda o atributo, e a compra feita nele um mês depois não é mérito da notificação de hoje |
| Toque com a loja aberta | ✅ a origem mora numa variável da página que o app atualiza em cada aba já carregada, e a trava da gravação é por conteúdo: a próxima mudança de carrinho já sai com a origem nova. Vencido o toque, o atributo simplesmente não vai — nem vazio, para uma aba antiga não apagar a origem que outra acabou de gravar |
| O atributo qualquer um escreve | ✅ `registrar_pedido` só dá o crédito a uma campanha ou automação DO MESMO APP, e só em pedido do app; origem que não confere é descartada e o pedido entra sem o crédito. O banco recusa receita de push em pedido do site e crédito duplo (campanha e automação) por CHECK. As somas são `security invoker`: pela RLS de `shop_orders`, outra organização soma zero, mesmo sabendo o id |
| C07 | ✅ cada campanha enviada mostra enviados (e entregues), aberturas (e quanto abriu) e receita (e quantos pedidos); no celular, tudo numa linha embaixo do texto. No topo, "Vendas pelas notificações": campanhas e automações dos últimos 30 dias |
| C10 | ✅ "Do envio à venda": enviados → entregues → aberturas → pedidos, com a barra de cada etapa e quanto da anterior chegou até ela, e a receita com o ticket médio. Etapa sem número fica com traço e sem barra; taxa acima de 100% (pedido que chega depois da última leitura das aberturas) não aparece |
| C09 | ✅ cada automação salva mostra os últimos 30 dias: quantas notificações saíram, os pedidos e a receita |
| Sem a Shopify, traço | ✅ os pedidos chegam pelo webhook da Shopify; sem a conexão, a receita seria sempre zero — um zero dizendo que as notificações não vendem, quando a Storefy só não está vendo os pedidos. A tela mostra traço e "Conecte a Shopify para ver quanto cada notificação vendeu", com o atalho para quem pode conectar |
| Testes | ✅ contrato (config-schema): 11 — vai e volta pela notificação e pelo carrinho, formatos forjados, janela e folga do relógio; webhook: 7 (dentro e fora da janela, relógio adiantado, pedido do site, forjado, sem data); despacho: origem da campanha e da automação nos dados; apresentação: 11 (receita, traço, funil, taxa acima de 100%); app: 10 (a origem sai antes de navegar, notificação sem origem, marca com e sem toque, vencido não apaga, toque com a página aberta, variável estranha, a variável antes da marca, fora da Shopify); RLS: 16 (crédito do mesmo app, outra loja e inexistente descartados, pedido do site, CHECKs, somas, janela da automação, total do topo, isolamento e anônimo); e2e: pedidos pelo webhook assinado de verdade (do toque, reentregue, da automação, toque vencido, sem toque) até a lista, o funil, o card da automação e a linha do celular, sem Shopify mostrando traço, e outra organização sem acesso |

#### Fase 8r — Entregue (29/09/2026): o domínio da Shopify protegido (achado na revisão)

| Item | Estado |
|---|---|
| Editar a loja desligava os pedidos | ❌→✅ a edição da loja regravava `shop_domain` com o host do site. Numa loja conectada, o `.myshopify.com` virava `minhaloja.com.br`, e os webhooks — que chegam dizendo o domínio da Shopify — paravam de achar a loja: trocar o e-mail de atendimento fazia os pedidos sumirem do painel, sem erro nenhum. A edição agora só acompanha o endereço enquanto o domínio é o provisório do cadastro; o `.myshopify.com` fica (o da loja desconectada também, porque preenche a reconexão). O banco recusa o painel trocar o domínio de uma loja conectada (gatilho, migration 58), e "Reconectar" para OUTRA loja da Shopify, com a atual conectada, diz em frase que é preciso desconectar antes |
| Outra empresa derrubava os webhooks de uma loja | ❌→✅ `shop_domain` é gravável pelo painel, e nada impedia uma organização de pôr no cadastro dela o domínio da loja de outro cliente. A busca do segredo do webhook e a rota pública do banner liam por domínio com `maybeSingle()`: com duas linhas, a rota respondia 503 a todo webhook da loja vítima (e a Shopify desativa webhooks depois de alguns dias de erro) e o banner saía desligado. As duas passaram a olhar só a loja CONECTADA, que é uma só pelo índice da migration 30 |
| O `shop/redact` podia não apagar a loja certa | ❌→✅ `apagar_dados_da_shopify` apagava os dados de UM app com o domínio, escolhido por `limit 1`. Agora apaga os de todos os cadastros com aquele domínio — tudo o que a Storefy guardou daquela loja da Shopify, como a LGPD e a Shopify exigem |
| Testes | ✅ RLS: 9 (painel não troca o domínio conectado, edita o resto, reconexão com o mesmo domínio, domínio provisório livre, service role troca, o intruso consegue pôr o domínio mas o webhook acha só a conectada, redact apaga todos e desconecta); unidade: domínio ao editar, busca do segredo e do banner só na conectada, reconexão para outra loja recusada e para a mesma aceita; e2e: loja conectada editada pela tela continua recebendo pedido pelo webhook assinado, e segue recebendo depois de outra empresa pôr o mesmo domínio no cadastro dela |

#### Fase 8s — Entregue (29/09/2026): a plataforma e o logo do site no começo (C02 e C03)

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ o C02 detectava se a loja é Shopify e achava o logo, mas nada disso ficava: toda loja nascia "Shopify", não havia onde dizer que ela é de outra plataforma (e a associação dos links por arquivos no site, feita para essas lojas, era inalcançável), e o logo encontrado não servia para nada além da miniatura no cadastro |
| Plataforma | ✅ "Plataforma da loja" no cadastro — a detecção sugere, o lojista confirma — e na edição, dizendo em linguagem simples o que muda (a separação das vendas do app e o caminho dos links). Com a Shopify conectada, o campo trava e diz para desconectar antes; o banco recusa loja conectada marcada como outra (migration 59), e a conexão pelo app da loja grava `shopify` junto com o token, como o OAuth já fazia |
| O app acompanha a loja | ✅ o bloco `store` do rascunho (nome, endereço, domínios, plataforma) agora é reconciliado com o cadastro sempre que o rascunho é aberto — antes, trocar o endereço ou a plataforma na tela da loja só chegava ao app se o lojista mexesse de novo no editor, e "Publicar" sem mexer punha no ar o antigo. Um só lugar monta esse bloco (`blocoDaLoja`) |
| Logo do site → ícone | ✅ "Usar o logo do site" no C03 e no editor. O servidor relê a página, tenta os candidatos do mais provável ao menos (o logo do cabeçalho do tema, `og:logo`, o `apple-touch-icon`, os ícones, a imagem de compartilhamento), pede ao CDN da Shopify o arquivo original em vez da miniatura, e monta um ícone de 1024 px: fundo sólido na cor que o logo pede (o próprio fundo dele, branco para logo escuro, a cor da marca ou quase preto para logo branco) e o desenho aparado, dentro da área que todo formato de Android mostra. O resultado passa pela mesma conferência do ícone enviado à mão. Logo pequeno demais é recusado com o motivo, em vez de virar um ícone borrado |
| Achado no caminho: SSRF por redirecionamento | ❌→✅ a detecção buscava o site com `redirect: 'follow'`: um site público podia mandar o nosso servidor, com um 302, para `169.254.169.254` ou `localhost`. A detecção e o logo passam por uma busca pública que confere cada salto, com teto de tempo e de tamanho |
| Testes | ✅ busca pública: 6 (salto para host interno recusado antes de buscar, saída interna, laço de redirecionamento, tamanho, erro e rede); ícone do logo: 7 com imagens reais (escuro no branco, miolo seguro sem a margem, branco na marca ou no quase preto, fundo próprio, pequeno, não-imagem) e a regra do fundo; logo do site: 9 (original da Shopify, ordem dos candidatos, fluxo inteiro com o ícone passando na régua, só pequeno, sem logo, fora do ar, logo apontando para endereço interno); rascunho: 2 (bloco da loja atualizado mantendo o resto; só a plataforma); RLS: 5 (cadastrar e trocar, membro não troca, conectada não vira outra nem pela service role); e2e: plataforma no cadastro e na edição até o rascunho, campo travado com a Shopify conectada, o botão do logo com o site fora do ar e o membro sem o botão |

#### Fase 8t — Entregue (29/09/2026): A03 — filtros e saúde de cada cliente

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ a A03 tinha busca e paginação; o plano pede filtros por plano, situação e etapa do começo, e a saúde de cada cliente — o que deixa a equipe achar quem está em atraso, quem parou no meio e quem precisa de alguém |
| No banco, numa função só | ✅ `admin_organizacoes` (só a equipe, com o segundo fator) calcula a etapa e a saúde e filtra ANTES de paginar — filtrar depois mostraria páginas meio vazias e um total errado. A busca trata `%` e `_` digitados como letras |
| Etapa do começo | ✅ pela loja mais adiantada: sem loja → montando o app → publicado no painel → enviado às lojas → no ar |
| Saúde, com o porquê | ✅ Crítica: cobrança em atraso, teste que acabou sem assinatura. Atenção: app recusado na revisão, build com erro nos últimos 7 dias, conta de desenvolvedor com erro, mais aparelhos do que o plano permite, ninguém da empresa mexe no painel há 30 dias (a equipe da plataforma mexendo na conta não conta como cliente ativo). Cada linha mostra o selo e os motivos |
| Filtros na URL | ✅ situação, plano (ou "em teste, sem plano"), etapa e saúde, por GET: o link de "clientes em atraso" se compartilha. Valor desconhecido na URL é ignorado; a busca e a paginação carregam os filtros, e "Limpar filtros" mantém a busca |
| Defeito achado no caminho | ❌→✅ os seletores (e o campo de busca do admin) só liam o valor da URL ao montar: depois de "Limpar filtros", a lista vinha inteira e os seletores ainda marcavam o filtro antigo. Os formulários remontam quando a URL muda |
| Testes | ✅ unidade: 5 (filtros lidos e ignorados, rótulos); RLS: 8 (cliente e equipe sem o segundo fator barrados, crítica, atenção com o motivo, boa, filtros combinados, paginação depois do filtro, curingas na busca); e2e: o filtro de saúde acha só o cliente parado com o motivo e a etapa, filtro sem resultado diz "nada encontrado", limpar volta os seletores a "Todos" e mantém a busca, filtro inventado na URL é ignorado |

#### Fase 8u — Entregue (29/09/2026): A06 com o próximo passo, e A07 revalidando credenciais

| Item | Estado |
|---|---|
| A06 — ações sugeridas | ❌→✅ a tela listava o estado e os dias; o plano pede o motivo E a ação sugerida. Cada app ganhou "Próximo passo", com quem age (a equipe, o lojista ou esperar a loja): esperar a Apple no prazo; cobrar quando passa de 7 dias; corrigir a ficha (recusa de metadados), gerar build novo (arquivo recusado), confirmar com o lojista (versão retirada por ele) e, na recusa por diretriz, o caminho do Resolution Center com os consertos das três que mais derrubam app de loja (4.2, 2.1, 5.1.1). O nome do cliente leva à A04 |
| A06 — o Android não estava em revisão | ❌→✅ o build do Android vai para a trilha interna do Play, que não passa por revisão: ele fica "enviado" até o lojista promover a versão para produção. A tela dizia "parado há 12 dias, vale abrir um chamado na loja" — cobrando da Google uma revisão que nunca começou. Agora aparece "Na trilha interna", com o passo "Promover para produção" (e onde fica no Play Console), sem alarme |
| A07 — revalidar | ✅ "Revalidar" em cada conta com credencial: a mesma conferência do envio (a chamada mais barata que prova que a chave ainda abre a conta), com o segredo aberto só no servidor. A recusa da Apple ou do Google, ou um arquivo guardado que não abre, deixa a conta "com erro" com o motivo; rede caída ou a loja fora do ar (5xx) não mudam nada — marcar erro por isso faria o cliente refazer uma credencial boa. O resultado é gravado pela sessão da equipe (`admin_gravar_revalidacao`, migration 61), e o gatilho de auditoria registra quem conferiu. A lista mostra quando cada conta foi validada ou conferida |
| Testes | ✅ próximo passo: 7 (esperar, cobrar com os dias, Android na trilha interna sem alarme, cada recusa conhecida, recusa antiga não vira cobrança, Google, o limite); revalidar: 6 (Apple e Google aceitam, a Apple recusa, rede e 5xx não mudam nada, o guardado que não abre ou não é credencial, sem credencial); RLS: 5 (cliente e equipe sem segundo fator barrados, a gravação com o motivo, a auditoria com quem conferiu, conta pendente recusada); e2e: A06 com o Android na trilha interna e a recusa da ficha; A07 revalidando uma credencial corrompida até a conta com erro e a trilha com o admin como autor |

#### Fase 8v — Entregue (29/09/2026): M11 com o caminho da loja, e a correção OTA que travaria todo mundo

| Item | Estado |
|---|---|
| M11 — o botão que faltava | ❌→✅ a atualização obrigatória dizia "atualize pela loja de aplicativos" e parava ali: o cliente saía do app, procurava a loja pelo nome e, com sorte, achava. Agora "Atualizar agora" abre a ficha do app — na App Store pelo número do app (a Apple não tem link pelo bundle ID), na Play Store pelo pacote —, primeiro no app da loja e, se ninguém atender (Android sem Google Play, simulador), no navegador. Nada abrindo, a tela diz onde procurar, com o nome do app; num build que não sabe o próprio número na App Store, não há botão, e o texto já diz onde procurar. A tela ganhou as cores da loja |
| O número da App Store dentro do app | ✅ o build de loja grava `apps.ios_asc_app_id` no binário (o checklist só libera o build de iPhone com o app criado na Apple, então todo build de loja o tem), e a correção OTA o leva aos binários gerados antes (`dados_da_ota` devolve o número, migration 62) |
| Achado: a correção OTA travaria todo mundo na tela de atualizar | ❌→✅ o app lia o número do build e a versão do manifesto EM USO — que, depois da primeira correção OTA, é o da correção, montado no runner para todos os binários da loja de uma vez: 1.0.0 (1) em todo aparelho. Com o lojista exigindo uma versão (C06d), todo app que recebeu uma correção caía na tela de atualizar, inclusive quem tinha acabado de atualizar — e a próxima correção travava de novo. Número, versão e plugins nativos agora vêm do próprio binário: o `app.config` que o build grava no pacote (o OTA não o troca) e, no iPhone, o `CFBundleVersion` do Info.plist. A versão nos Ajustes (M12), no aparelho registrado e na página passa a ser a verdadeira |
| Achado: o Face ID seguia a lista do OTA | ❌→✅ "o binário tem a permissão de Face ID?" era respondido pela lista de plugins do manifesto em uso — a do código novo, depois de uma correção. Um binário sem a permissão pediria o Face ID mesmo assim, e o iOS encerra o app que pede sem ela no Info.plist. Agora é a lista do binário |
| Achado: toda correção OTA morria antes de publicar | ❌→✅ o `eas update` avalia o `app.config.ts` com `STORE_ID` definido, e o runner da correção não baixa ícone nem splash — que são do binário: toda correção parava em "falta ./brands/<loja>/icon.png". O `app.config.ts` ganhou o modo de pacote (`STOREFY_OTA=1`), em que a arte não é exigida e o resto da identidade continua obrigatório |
| Achado: o manifesto da correção saía com valores de desenvolvimento | ❌→✅ a correção não passava a API da loja, o esquema de URL nem (agora) o número da App Store: o manifesto dela — que vira o de todo app que a recebe — saía com a API padrão e o `storefy://` genérico. E o pacote não levava a config da loja embutida, o último recurso de quando o app abre sem internet e sem cache: a rota da correção devolve a config no ar (loja sem config: 404 com o motivo, e só o job dela falha), e o workflow a embute como o build |
| A trava contra a próxima divergência | ✅ um teste lê os dois workflows e o `app.config.ts`: toda variável que o `app.config.ts` lê precisa estar classificada (do manifesto em uso, do binário ou de modo), o passo do build entrega cada uma e a manda para o `eas.json`, e o passo da correção entrega as do manifesto, em modo de pacote e com a config embutida. Rodado contra os workflows antigos, ele aponta exatamente as cinco falhas acima |
| Testes | ✅ app: ambiente 11 novos (o número e a versão do binário depois de um OTA nas duas plataformas, o Info.plist na frente, o `app.config` do Android em texto, as credenciais do manifesto em uso, o Face ID do binário, o número da App Store com o formato da trava, o OTA sem o número não apaga o do binário, o pacote Android), ficha na loja: 10 (endereços das duas lojas, sem identificador não há ficha, cai para o navegador, nada abre, os textos com e sem ficha e sem o nome do app), `app.config.ts`: 2 (o número vai para o extra; o pacote OTA sem a arte e com o resto obrigatório), workflows: 8, decisão: a tela de atualizar leva as cores da loja; rotas: o build leva o número da App Store, a correção leva o número, o esquema e a config no ar, e loja sem config falha com o motivo; RLS: `dados_da_ota` leva o número (e o lojista segue sem acesso); Maestro: `atualizacao.yaml` (a tela toma o app, o botão abre a loja, e na volta ela continua) |

#### Fase 8w — Entregue (29/09/2026): a troca de aba sentida e vista, e a página fora do entalhe

| Item | Estado |
|---|---|
| O que faltava | ❌→✅ a seção 10 pede "animações nativas de troca de aba, haptics sutis… nada pode parecer site dentro do app", e trocar de aba era trocar de página: o conteúdo novo aparecia de uma vez, sem nenhum sinal na mão |
| Na mão | ✅ o toque de seleção do sistema a cada troca — no iPhone, o mesmo de um seletor; no Android, o retorno de tecla, que respeita o "retorno ao toque" desligado nos ajustes e não pede a permissão de vibrar. Tocar na aba que já está aberta (que volta ao começo dela) não vibra: a página mudando já é o retorno |
| No olho | ✅ o conteúdo novo entra com um esmaecer de 180 ms a partir da cor de fundo da loja, e o ícone da aba escolhida dá um pulo pequeno, com mola. O esmaecer é de uma cobertura por cima do conteúdo, e não da WebView: opacidade animada numa WebView pisca em branco em muito Android. Tudo no driver nativo, fora da linha do JavaScript |
| Reduzir movimento | ✅ com "Reduzir movimento" ligado no aparelho (iOS ou Android), a troca é imediata e o ícone não pula — acompanhando a mudança com o app aberto. O toque na mão continua: ele não é movimento |
| Achado: a página embaixo do entalhe, e o aviso do topo escondido | ❌→✅ as abas de WebView cobrem o pai inteiro (`position: absolute`), e o pai era a área segura. O Yoga posiciona filho absoluto ignorando o padding do pai — conferido com o próprio Yoga, nos dois modos de conformidade: a página começava em y=0, embaixo do relógio e do entalhe, e cobria inteira a faixa de aviso do topo (C06e), que ficava por baixo dela e não recebia o toque de fechar. O conteúdo das abas agora mora numa caixa própria, depois da faixa: a página começa abaixo dela. O fluxo `aviso.yaml` do Maestro, que toca no "fechar" da faixa, é o que pega isso num aparelho |
| Testes | ✅ a decisão da troca: 4 (trocar vibra e anima, "Reduzir movimento" só vibra, reabrir não faz nada, a duração e o pulo dentro do limite); o layout conferido no Yoga (a página em y=0 como estava, abaixo da faixa com a caixa); lint, tipos, testes e o build do app nas duas plataformas |

#### Fase 8x — Entregue (29/09/2026): o acabamento do editor — três colunas, ícone e abertura na prévia, o número da aba, contraste AA, a Inter e o tema da loja (A10)

| Item | Estado |
|---|---|
| C06 em três colunas | ❌→✅ o plano pede "navegação de seções · propriedades · mockup", e o editor tinha duas: as seções eram uma fileira de botões em cima das propriedades. Na tela larga, as seções viram uma coluna à esquerda, com ícone, fixa ao rolar; na média, voltam para a faixa em cima; no celular, tudo empilha. A coluna da prévia (e a do começo, C03) grudava 24 px abaixo do topo — por baixo do cabeçalho fixo de 56 px, cortando o alto do celular ao rolar; agora gruda abaixo dele |
| A Inter, de verdade | ❌→✅ o CSS pedia "Inter", mas ninguém a carregava: quem não a tinha instalada via a fonte do sistema, e o painel mudava de cara de um computador para outro. Agora vem pelo `next/font`, servida pelo próprio painel (o navegador não fala com o Google) |
| O ícone e a abertura na prévia (C06a) | ✅ a prévia ganhou "Loja · Ícone · Abertura". Em "Ícone", a tela inicial com o ícone no tamanho de verdade e o nome embaixo (cortado como o celular corta), e grande, com o recorte de cada aparelho: cantos arredondados no iPhone, círculo no Android mostrando só o miolo do ícone adaptativo (72 de 108 dp). Em "Abertura", a imagem com a largura e a cor de fundo do build — a mesma função calcula as duas (`fundoDoApp`) —, e sem imagem, a tela branca que o app mostraria. Sem imagem enviada, cada vista diz onde enviar. A loja continua carregada por baixo: voltar para ela não recarrega a página |
| C06b — o número sobre o ícone | ❌→✅ o plano põe o badge entre o que se edita na aba, e ele nascia fixo pelo tipo. O carrinho ("Mostrar o número de itens sobre o ícone") e a caixa de avisos ("Mostrar quantos avisos não foram lidos") ganharam a chave; as outras abas não têm o que contar, e não têm chave. A prévia mostrava um "2" inventado no carrinho: agora mostra o lugar do número, com um ponto, nas duas abas |
| Achado: a comparação de versões falava do carrinho em toda aba | ❌→✅ desligar o número da caixa de avisos aparecia, no que vai ao ar, como "sem o número do carrinho". Agora cada aba diz o que o número dela conta |
| Contraste AA (seção 10) | ✅ o editor (e o começo, C03, onde a cor da marca é escolhida) avisa quando uma cor fica difícil de ler, com a razão e o mínimo da WCAG, nos pares que o app desenha: o texto das telas sobre o fundo (4,5:1), o texto dos botões e do aviso do topo sobre a cor principal (4,5:1), a aba selecionada (4,5:1), as outras abas (3:1) e os ícones da barra de status sobre o fundo (3:1) — este com o conserto ("Escolha Ícones claros em Barra de status"), porque preto ou branco sempre passa. É um aviso, e não uma trava: a cor é do lojista. A razão é arredondada para baixo: 4,47 não aparece como "4,5" |
| Achado: toda loja começava com as abas quase sumindo | ❌→✅ o cinza das abas não selecionadas do tema de partida (`#9ca3af`) ficava em 2,5:1 sobre o branco — o próprio aviso novo acenderia para toda loja nova. Passou a `#6b7280` (4,8:1); quem já tem config continua com a sua |
| A10 — o tema da loja | ❌→✅ os presets só poupam trabalho se o lojista achar o do tema dele, e ele não sabia qual era. Toda loja Shopify publica `Shopify.theme` na página, e vale o `schema_name` — o do tema ORIGINAL, que sobrevive a "Dawn - cópia de Natal". O cadastro (C02) já lê a página: o tema aparece no cartão da detecção e vai com a loja (`stores.shopify_theme`, migration 63, com grant por coluna e formato conferido no banco). No editor, "Sua loja usa o tema Dawn", o preset dele em primeiro, marcado "Feito para o seu tema", e "Descobrir o tema da minha loja" / "Ler o tema de novo" para a loja cadastrada antes ou que trocou de tema — pela busca pública, só o dono e o administrador, com o motivo quando a loja não responde ou a página não diz o tema. Tema sem preset diz que os outros podem servir de ponto de partida. A comparação ignora caixa, acento e espaço. Na curadoria (A10, admin), cada loja da lista mostra o tema dela, e escolher a loja preenche o "Tema da Shopify" do preset — sem apagar o que a equipe já tiver escrito |
| Achado: nenhum preset nascia na curadoria (A10) | ❌→✅ "Criar preset a partir de uma loja" chamava a cópia da config pela service role, e a função confere que quem pede é da equipe (com o segundo fator) — a service role não é ninguém, e a cópia era recusada SEMPRE. O erro era ignorado e virava "essa loja ainda não publicou uma configuração", para uma loja que a própria lista só oferecia por estar publicada. A cópia agora vai pela sessão da equipe, com o erro dito como erro. Nenhum e2e cobria a curadoria — agora cobre |
| Achado: a curadoria não ficava na trilha | ❌→✅ criar, desligar e apagar preset são ações da equipe, e nenhuma ia para a auditoria (regra 9). Agora cada uma grava quem fez, com o antes e o depois; desligar ou apagar um preset que sumiu diz isso, em vez de "pronto" |
| Testes | ✅ unidade: contraste 8 (valores de referência da WCAG, cada par, a barra de status nos dois sentidos, o tema de partida passa, a razão sem arredondar para cima), fundo do app 2, número da aba 2, comparação de versões 1, tema da página 4 (o original e não a cópia, o nome sem o esquema, página sem tema ou fora do JSON, espaço e tamanho), presets pelo tema 3, descobrir o tema 4 (lido, página sem tema, fora do ar e com erro, endereço interno não buscado), cadastro 1 (o tema vai junto; o estranho some sem virar erro); RLS: 6 (o dono grava, controle e tamanho recusados, o membro lê e não muda, outra empresa nem vê); e2e: as três colunas e a faixa na média, a Inter carregada; o ícone e a abertura sem e com imagem, nos dois aparelhos, e a volta à loja; o número da aba na prévia, no rascunho e no que vai ao ar; o aviso de contraste acendendo e apagando, com o conserto da barra de status; o preset do tema em primeiro e marcado, e a leitura que falha dizendo o porquê; A10 de ponta a ponta, que não tinha e2e: o preset nasce de uma loja no ar com o tema dela preenchido, chega em primeiro ao lojista daquele tema, desligado some da lista dele, e apagado some da curadoria — com a trilha de cada passo apontando o admin |

#### Fase 8y — Entregue (29/09/2026): o vídeo do passo a passo das contas Apple e Google (C13)

| Item | Estado |
|---|---|
| C13 — "wizards passo a passo com vídeo" | ❌→✅ os assistentes tinham os passos escritos, o envio das chaves e a validação, mas nenhum vídeo. A equipe grava o passo a passo (a tela do App Store Connect, a do Play Console), publica no YouTube, no Vimeo ou no Loom e cola o link na A13, em "Vídeos do passo a passo". O cartão de cada conta mostra o vídeo embutido enquanto a conta não está conectada — ou deixou de valer, quando o lojista precisa refazer os passos; conectada, o vídeo sai do caminho. Sem link, o cartão fica só com os passos escritos: nunca um player vazio |
| Só vídeo, e só desses três | ✅ o link vai para um iframe na tela de todo lojista, e aceitar qualquer endereço seria pôr uma página de fora dentro do painel. Só https, só YouTube (watch, youtu.be, embed, shorts, live, m.), Vimeo e Loom, e o que se grava é o endereço de incorporar do próprio serviço, montado a partir do id conferido — nunca o texto colado. O vídeo "não listado" do Vimeo (o jeito comum de publicar um tutorial) leva o hash dele para o player, sem o qual o player diz que o vídeo não existe. O YouTube entra pelo domínio sem cookies: o lojista que só abriu a tela não é rastreado. O link recusado diz o que é aceito. O banco só aceita as chaves conhecidas (migration 64), e a leitura confere o link de novo: um valor gravado à mão que não é vídeo vira "sem vídeo" |
| Quem muda e a trilha | ✅ só superadmin grava (o suporte vê); cada mudança vai para a auditoria com o antes e o depois, como as outras chaves da A13 |
| Depende de ação humana | ⏳ gravar os dois vídeos e colar os links na A13. Até lá, as telas mostram só os passos escritos, como antes |
| Testes | ✅ unidade: o link do vídeo 6 (cada forma do YouTube vira o endereço sem cookies; Vimeo e Loom pelo player; o não listado do Vimeo com o hash; o endereço gravado passa de novo pela conferência sem mudar; vazio tira o vídeo; recusa http, domínio parecido, id curto, canal, hash estranho, arquivo solto, `javascript:` e texto), chaves da plataforma 1 (o vídeo gravado volta; o que não é vídeo não chega à tela); RLS: 1 (as chaves novas passam pela trava do banco); e2e: o link recusado com a mensagem, os dois gravados e na trilha, o lojista vendo cada vídeo no cartão da conta ainda não conectada, e o vídeo apagado saindo da tela sem levar os passos junto |

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
| Cliente Klaviyo | `packages/integrations/src/klaviyo` | **Fase 5** — integração do C14. *Não foi preciso:* a integração entregue (Fase 8e) é a ferramenta chamando a Storefy, e não o contrário |
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

> A lista que vale é a do `.env.example`, conferida contra o que o código lê de
> verdade (`grep process.env`). Esta seção é o resumo; quando as duas
> divergirem, o `.env.example` está certo.

```
# Web (Vercel)
NEXT_PUBLIC_SUPABASE_URL=            NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=           ENCRYPTION_KEY=
ONESIGNAL_ORG_API_KEY=               ONESIGNAL_ORG_ID=
GITHUB_DISPATCH_TOKEN=               GITHUB_REPO=
EXPO_TOKEN=                          EAS_WEBHOOK_SECRET=
CRON_SECRET=
SHOPIFY_API_KEY=                     SHOPIFY_API_SECRET=      SHOPIFY_SCOPES=
ASAAS_API_KEY=  ASAAS_WEBHOOK_TOKEN=  RESEND_API_KEY=          EMAIL_REMETENTE=
SENTRY_DSN=                          BUILD_API_SECRET=

# Precisa de https:// na frente. A Vercel mostra o domínio sem o esquema, e
# colar exatamente o que ela mostra derruba o OAuth da Shopify e registra os
# webhooks errado, EM SILÊNCIO. Aconteceu.
NEXT_PUBLIC_SITE_URL=https://app.storefy.com.br

# Domínios próprios do painel e do admin. Vazios, tudo roda em /admin no
# mesmo domínio — é o que vale até o DNS existir.
NEXT_PUBLIC_CLIENT_HOST=             NEXT_PUBLIC_ADMIN_HOST=
NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=

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
