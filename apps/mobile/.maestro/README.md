# Fluxos do app no Maestro (Fase 8)

Os fluxos daqui percorrem o app nativo como o cliente da loja percorre:
abrir, trocar de aba, buscar, pôr no carrinho, ficar sem internet e mexer nos
ajustes. Eles rodam num **simulador do iOS ou emulador do Android**, com o
build de desenvolvimento da **loja de teste** — por isso não entram no
`pnpm test`, que roda sem aparelho.

O que roda sem aparelho: `src/maestro.test.ts` confere que todo texto e todo
`id` citado aqui existe no app. Renomear um botão quebra esse teste na hora,
e não o fluxo semanas depois.

## Antes de rodar

1. Instale o Maestro: https://docs.maestro.dev/getting-started/installing-maestro
2. Tenha um simulador (Xcode) ou emulador (Android Studio) aberto.
3. Instale nele o build de desenvolvimento da loja de teste:
   `pnpm --filter @storefy/mobile ios` ou `pnpm --filter @storefy/mobile android`,
   com as variáveis da loja de teste (as mesmas do `app.config.ts`).
4. A loja de teste usa as abas padrão (Início, Buscar, Carrinho, Conta) e tem um
   produto com estoque que a busca por `TERMO` encontra.

## Rodar

```sh
cd apps/mobile
maestro test .maestro -e APP_ID=com.sualoja.app
```

Variáveis (todas com padrão, menos `APP_ID`):

| Variável        | Para quê                                        | Padrão                  |
| --------------- | ----------------------------------------------- | ----------------------- |
| `APP_ID`        | O bundle id (iOS) ou package (Android) do build | —                       |
| `TERMO`         | O que buscar                                    | `camiseta`              |
| `PRODUTO`       | O nome do produto nos resultados                | `Camiseta`              |
| `BOTAO_COMPRAR` | O botão de comprar do tema                      | `Adicionar ao carrinho` |

Filtros úteis:

- `--exclude-tags android` no iOS: o modo avião do `offline.yaml` só existe no
  emulador do Android.
- `--exclude-tags push` num build sem notificações (sem OneSignal).

## Os fluxos

| Arquivo                            | O que prova                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `fluxos/abrir.yaml`                | Primeira abertura: boas-vindas, convite das notificações e a barra de abas                  |
| `fluxos/trocar-aba.yaml`           | Cada aba guarda a sua página; a busca tem o campo nativo; a Conta tem a entrada dos ajustes |
| `fluxos/busca.yaml`                | O campo nativo (M08) leva à busca da loja e guarda o termo                                  |
| `fluxos/carrinho.yaml`             | Um produto entra no carrinho e o número aparece na aba                                      |
| `fluxos/offline.yaml`              | Sem internet, a tela nativa; com "Tentar de novo", a loja volta (Android)                   |
| `fluxos/ajustes.yaml`              | Os ajustes do app (M12): política de privacidade e versão                                   |
| `fluxos/ajustes-notificacoes.yaml` | Desligar e religar as notificações dentro do app (Apple 4.5.4)                              |
