# Oak Vintage — configuração embutida no build

Esta é a config que vai **dentro do binário**, usada na primeira abertura,
antes de haver cache e antes de a rede responder. Depois disso, quem manda é a
config remota publicada pelo painel.

## O que está preenchido

Nome, URL e domínio da loja: `https://oakvintage.com.br`.
Quatro abas (início, busca, carrinho e conta), que é o arranjo mais comum e
cabe no limite de 2 a 5 do `AppConfig`.

## O que ainda falta, e por quê

**`theme`** está em tons neutros. As cores reais saem do site — favicon,
`theme-color` e `og:image` —, e a detecção automática disso é a tela C02 da
Fase 2. Até lá, dá para preencher à mão pelo painel.

**`webview.hideSelectors`** está vazio, e por isso o app mostra o cabeçalho e
o rodapé do tema. Os seletores dependem do tema que a loja usa: em Dawn são
`header.header` e `.footer`, mas cada tema pago muda os nomes. A Fase 1 prevê
testar em três lojas reais justamente para montar esses presets, e a tela A10
da Fase 6 os transforma em presets por tema.

Com a lista vazia o app funciona — só não parece nativo ainda. É o estado
correto para um valor que depende de inspecionar o tema, e não um campo por
preencher depois.

## Assets do build

`icon.png` (1024×1024) e `splash.png` não estão aqui: são arquivos que o
lojista envia pelo painel, e o workflow `build-store-app.yml` da Fase 4 os
baixa para cá e gera os tamanhos derivados com `sharp`.

Para rodar `expo start` localmente antes disso, coloque dois PNGs quaisquer
com esses nomes nesta pasta. Eles não vão para o repositório.
