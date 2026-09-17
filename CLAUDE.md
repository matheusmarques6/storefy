# CLAUDE.md — Storefy

## O que é
SaaS que transforma lojas Shopify em apps iOS/Android. O app é uma WebView com uma camada nativa por cima (abas, push, splash, deep links).
O plano completo e a fase atual estão em `PLANO-DESENVOLVIMENTO.md`. **Sempre leia o plano antes de começar uma tarefa.**

---

## Regras inegociáveis

Estas quatro regras valem para **todas as fases e todas as sessões**, sem exceção.
Se algo neste arquivo ou no plano conflitar com elas, elas prevalecem. Leia esta
seção antes de escrever qualquer linha de código.

### 1. Zero dados mock

- É proibido usar dados falsos, hardcoded, placeholders simulando resultados,
  arrays fake, respostas de API simuladas, "lorem ipsum" em dados ou números
  inventados em dashboards, em qualquer parte do produto.
- Toda tela lê e grava dados reais no Supabase. Toda integração chama a API real
  (ou fica claramente desabilitada, com um estado de "não configurado" explicando
  o que falta).
- Quando não houver dados, mostre um estado vazio bem desenhado com CTA. Nunca
  mostre números fictícios.
- **Exceção única:** testes automatizados podem criar dados de teste, desde que
  isolados no ambiente de teste e removidos ao final. Nada disso pode aparecer no app.
- Sem seed com dados fictícios. O primeiro `platform_admin` real é cadastrado pelo
  script de bootstrap (`pnpm bootstrap:admin`), a partir de um e-mail informado por
  variável de ambiente ou argumento.

> **Por quê:** este é um produto que vai para clientes reais. Mock esconde bugs de
> integração, cria falsa sensação de pronto e gera retrabalho quando for trocado
> pelos dados reais. Queremos que cada entrega já seja o sistema verdadeiro.

### 2. Multi-tenant desde o primeiro commit

- Uma organização (cliente) pode ter **várias lojas**, e cada loja tem seu próprio
  app, configs, pushes, builds e métricas. Uma organização também pode ter vários
  usuários com papéis diferentes.
- Todo dado pertence a uma organização (`org_id`) e, quando aplicável, a uma loja
  (`store_id`). Todas as tabelas têm RLS. **Nenhuma query confia em filtro feito só
  no front.**
- O painel do cliente tem, desde já, um seletor de loja ativa (store switcher) e o
  fluxo de criar uma nova loja. A loja selecionada define o contexto de todas as telas.
- O admin enxerga todas as organizações e lojas, sempre por rotas de servidor que
  validam `platform_admins`.

> **Por quê:** o Storefy é um SaaS para várias lojas e vários clientes ao mesmo
> tempo. Adaptar um sistema single-tenant depois é caro, arriscado e costuma vazar
> dados entre clientes. Por isso o isolamento precisa nascer junto com o projeto.

### 3. Cada fase entregue 100% funcional, sem pular nada

- Cada funcionalidade de uma fase deve ser entregue completa de ponta a ponta, do
  banco à tela final que o usuário usa, incluindo **todas** as subfuncionalidades:
  criar, listar, editar e excluir; validações de formulário com mensagens claras;
  estados de vazio, carregando, erro e sucesso; confirmações de ações destrutivas;
  permissões por papel; responsividade; mensagens em pt-BR; registros em `audit_logs`.
- É proibido deixar `TODO`, botão sem ação, tela "em breve", função vazia, `catch`
  que engole erro ou fluxo pela metade dentro do escopo da fase.
- Se algo realmente depender de uma ação humana (chave, conta, domínio), implemente
  todo o restante, deixe o ponto bloqueado com um estado claro na interface e avise
  no resumo final.

> **Por quê:** vamos avançar fase por fase sobre uma base confiável. Pendências
> escondidas se acumulam e quebram as fases seguintes.

### 4. Testar, caçar bugs e corrigir antes de entregar

Antes de dizer que terminou **qualquer** etapa:

- **a)** rode `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`, e corrija tudo;
- **b)** escreva e rode testes para a lógica nova (unidade, RLS e integração, quando
  fizer sentido);
- **c)** percorra manualmente cada fluxo do usuário no navegador (use Playwright para
  automatizar os fluxos principais), incluindo os caminhos de erro e os casos limite:
  campos vazios, dados inválidos, sessão expirada, usuário sem permissão, troca de
  loja, duas organizações diferentes;
- **d)** revise o próprio código procurando bugs, falhas de segurança, vazamento entre
  tenants e problemas de UX;
- **e)** corrija **imediatamente** qualquer problema encontrado e repita os testes até
  ficar tudo verde.

Nunca entregue com teste falhando, erro no console ou warning ignorado sem justificativa.

> **Por quê:** corrigir na hora é muito mais barato do que descobrir depois, com outras
> fases já construídas por cima.

---

## Stack
- Monorepo pnpm + Turborepo
- `apps/web`: Next.js (App Router) na Vercel, com painel do cliente em `app.` e admin em `admin.`
- `apps/mobile`: Expo + expo-router + react-native-webview + OneSignal
- Supabase: Postgres + RLS, Auth, Storage, Realtime, Edge Functions
- UI: Tailwind + shadcn/ui + lucide-react + Recharts
- Validação: Zod (`packages/config-schema` é o contrato painel ⇄ app)

## Regras técnicas

> As quatro regras inegociáveis acima têm precedência sobre esta lista.

1. TypeScript strict. Nada de `any` sem justificativa.
2. Toda tabela nova tem RLS e teste de RLS. A service role só roda no servidor, e o admin exige checagem de `platform_admins`.
3. Segredos (chaves Apple/Google/OneSignal/Shopify) ficam sempre criptografados e nunca chegam ao client.
4. Mudanças no `AppConfig` devem ser retrocompatíveis: campo novo sempre com `default`, e teste de compatibilidade.
5. O `onesignal-expo-plugin` fica sempre em **primeiro** no array `plugins` do `app.config.ts`.
6. Mensagens do bridge só pelos tipos de `packages/bridge`.
7. Toda tela precisa dos estados vazio, carregando (skeleton), erro e sucesso. Textos em pt-BR, simples e sem jargão técnico para o lojista.
8. Telas usam os IDs do plano (C01…, A01…, M01…) no nome do arquivo ou em comentário, para trocar pelo layout do Claude Design depois.
9. Ações do admin e mudanças sensíveis gravam em `audit_logs`.
10. Ao terminar cada tarefa: rodar `pnpm lint && pnpm typecheck && pnpm test`, resumir o que mudou e listar o que depende de ação humana (chaves, contas, DNS).

## Comandos
- `pnpm dev`: web
- `pnpm --filter mobile start`: app (dev client)
- `supabase db reset` / `supabase gen types typescript --local > packages/db/types.ts`
- `pnpm test` / `pnpm e2e`

## Não fazer
- Publicar apps de clientes na conta Apple/Google da Storefy (viola a diretriz 4.2.6 da Apple).
- Guardar config de loja hardcoded no app. Tudo que não exige build vem da config remota.
- Usar localStorage para dados sensíveis no painel.
