# Builds do app por loja

O `apps/mobile` é **um repositório para todos os apps**. O que muda entre lojas
chega por variável de ambiente, lida no `app.config.ts`. Nada de config de loja
fica no código.

## Um projeto EAS por loja

Cada loja tem o seu próprio app nas lojas de aplicativos, então tem também o seu
próprio projeto no Expo: slug, `projectId`, canal de update e credenciais
separados. Misturar duas lojas num projeto só faria um update OTA de uma cair no
app da outra.

O slug do projeto é derivado do id da loja, por `slugDoProjeto`
(`apps/web/lib/build-interno.ts`), e chega ao runner pela rota interna do
build. Ele não é configuração de ninguém: um slug fixo faria a segunda loja a
publicar entrar no projeto EAS da primeira.

O webhook de status do EAS também é por projeto, e quem o registra no projeto
novo é o próprio workflow, com o `EAS_WEBHOOK_SECRET` dos segredos do
repositório. Um projeto sem webhook gera o binário e nunca avisa.

Na Fase 4 o workflow `build-store-app.yml` cria o projeto e injeta as variáveis.
Até lá, para levantar um app à mão:

```bash
# 1. logar com o token de robô da organização
export EXPO_TOKEN=...

# 2. apontar para o projeto EAS daquela loja
export EXPO_OWNER=...            # conta ou organização dona do projeto
export EAS_PROJECT_ID=...        # UUID que o painel do Expo mostra
export APP_SLUG=...              # o slug do projeto no Expo, igual ao do painel
                                 # (no build por loja: `storefy-<id da loja>`)

# 3. identidade da loja
export STORE_ID=oakvintage
export APP_NAME="Oak Vintage"
export APP_SCHEME=oakvintage
export STORE_DOMAIN=oakvintage.com.br
export IOS_BUNDLE_ID=me.convertfy.storefy.oakvintage
export ANDROID_PACKAGE=me.convertfy.storefy.oakvintage

# 4. build de desenvolvimento (dev client), um por plataforma
pnpm --filter @storefy/mobile exec eas build --profile development --platform ios
pnpm --filter @storefy/mobile exec eas build --profile development --platform android
```

## Variáveis lidas pelo `app.config.ts`

| Variável                                            | Para quê                                      | Sem ela                             |
| --------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| `STORE_ID`                                          | pasta em `brands/` e chave da config embutida | cai em `oakvintage`                 |
| `APP_NAME`, `APP_SLUG`, `APP_SCHEME`, `APP_VERSION` | identidade do app                             | valores de desenvolvimento          |
| `EXPO_OWNER`                                        | conta dona do projeto no Expo                 | o EAS pergunta na hora              |
| `EAS_PROJECT_ID`                                    | projeto EAS e canal de update                 | o app fica sem update OTA           |
| `IOS_BUNDLE_ID`, `IOS_BUILD`, `APPLE_TEAM_ID`       | build iOS                                     | valores de desenvolvimento          |
| `ANDROID_PACKAGE`, `ANDROID_VC`                     | build Android                                 | valores de desenvolvimento          |
| `STORE_DOMAIN`                                      | Universal Links e App Links                   | `oakvintage.com.br`                 |
| `SPLASH_BG`                                         | cor de fundo da splash                        | branco                              |
| `APNS_MODE`                                         | `production` ou `development`                 | `production`                        |
| `STOREFY_APP_ID`, `API_BASE`                        | config remota                                 | o app roda só com a embutida        |
| `ONESIGNAL_APP_ID`                                  | push (Fase 3)                                 | push desligado, sem pedir permissão |

**`STORE_ID` definido torna ícone e splash obrigatórios.** `brands/$STORE_ID/`
precisa ter `icon.png` (1024×1024) e `splash.png`. Sem `STORE_ID`, o
`expo start` local usa o ícone padrão do Expo — num build de loja isso seria um
app chegando à App Store com a marca errada, e por isso ali é erro.

## Perfis do `eas.json`

| Perfil        | Para quê                                                      |
| ------------- | ------------------------------------------------------------- |
| `development` | dev client, instalado direto no aparelho, canal `development` |
| `preview`     | build interno para o lojista aprovar antes da loja            |
| `production`  | build que vai para App Store e Play Store                     |

`autoIncrement` fica **desligado** no `production`: quem manda no número do build
é o `builds` do banco, via `IOS_BUILD` e `ANDROID_VC`. Deixar o EAS contar por
conta dele faria o número do banco e o da loja divergirem na primeira rejeição.

## Push (Fase 3)

Dois valores por loja entram no build, além do que já estava:

| Variável                | De onde vem                              |
| ----------------------- | ---------------------------------------- |
| `ONESIGNAL_APP_ID`      | app criado na OneSignal para aquela loja |
| `STOREFY_DEVICE_SECRET` | painel da Storefy, na tela do app        |

`STOREFY_DEVICE_SECRET` é o segredo com que o app assina o que manda para
`/api/public/devices`, `/api/public/events` e `/api/public/inbox`. Ele acaba
dentro do binário, como toda chave de cliente de app móvel, e o desenho conta
com isso: o que ele garante não é sigilo, é que o acesso é **por loja** e
revogável. Gerar outro no painel invalida o anterior na hora.

**Nunca reaproveite o mesmo segredo entre lojas.** Um segredo compartilhado
transforma um vazamento em problema de todos os clientes de uma vez, que é
exatamente o que a separação por loja existe para evitar.

Sem `ONESIGNAL_APP_ID` o app abre igual, só sem push: `recursosDoBuild` devolve
`push: false`, a aba de avisos não aparece e a página que pedir permissão
recebe um `ignorar` com motivo, em vez de um botão que não faz nada.

Sem `STOREFY_DEVICE_SECRET` o push ainda chega (quem envia é a OneSignal), mas
o aparelho não é registrado na Storefy: a contagem de instalações, o carrinho
abandonado e a caixa de avisos ficam de fora.
