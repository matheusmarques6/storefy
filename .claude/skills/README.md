# Skills instaladas

Skills de design e frontend disponíveis neste projeto. O Claude Code carrega
automaticamente tudo em `.claude/skills/<nome>/SKILL.md`; o nome da pasta é o
nome de invocação (`/<nome>`).

Cada skill foi copiada do repositório de origem sem modificação. O nome da pasta
sempre corresponde ao campo `name` do frontmatter do `SKILL.md`.

## Origem

| Coleção | Repositório | Commit | Skills |
| --- | --- | --- | --- |
| Emil Kowalski | [emilkowalski/skills](https://github.com/emilkowalski/skills) | `85e8e23` | 13 |
| Impeccable | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `f2c7051` (skill v4.3.1, engine v0.1.5) | 1 |
| Taste Skill | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `e79ca9e` | 13 |

## Emil Kowalski — animação e design engineering

| Skill | Para quê |
| --- | --- |
| `emil-design-eng` | Skill principal: polimento de UI, design de componentes, decisões de animação |
| `animate` | Construir uma animação do zero na web (curva, duração, propriedades, interrupção) |
| `animate-expo` | O mesmo, para React Native e Expo (gestos, sheets, haptics, off-thread) |
| `review-animations` | Revisar animações existentes de forma rigorosa |
| `improve-animations` | Auditar a animação de todo o codebase e gerar planos priorizados |
| `find-animation-opportunities` | Achar onde faz sentido animar — e onde não faz |
| `animation-vocabulary` | Descobrir o termo exato de um efeito que você só sabe descrever |
| `apple-design` | Princípios da Apple para interface e movimento fluido, traduzidos para a web |
| `mobile-native` | Fazer um app web parecer nativo no celular (hover grudado, 100vh, safe areas) |
| `pick-ui-library` | Escolher a biblioteca certa em vez de reimplementar na mão |
| `prototype` | Construir várias versões de um componente e alternar entre elas |
| `ask-sonner` | Guia do Sonner: setup, receitas, estilização e problemas comuns |
| `write-swift` | Swift moderno: value types, concorrência Swift 6, generics, Swift Testing |

## Impeccable — design direction de ponta a ponta

| Skill | Para quê |
| --- | --- |
| `impeccable` | Criar, auditar, criticar e polir interfaces. Roteia subcomandos: `shape`, `audit`, `critique`, `animate`, `bolder`, `colorize`, `delight`, `layout`, `overdrive`, `quieter`, `typeset`, `adapt`, `clarify`, `distill`, `harden`, `onboard`, `optimize`, `polish`, `init`, `document`, `extract`, `live`, `generate` |

Uso: `/impeccable polish`, `/impeccable audit src/app`, `/impeccable init`.

Acompanha 4 subagents em `.claude/agents/`: `impeccable-asset-producer`,
`impeccable-documenter`, `impeccable-finish-reviewer` e
`impeccable-manual-edit-applier`.

### Hooks

`.claude/settings.json` registra o detector de design do Impeccable:

- **PostToolUse** (`Edit|Write`, timeout 5s) — checagens de tier imediato após editar arquivos de UI.
- **Stop** (timeout 30s) — passada completa de regras no fim do turno.

Ambos chamam `.claude/skills/impeccable/scripts/impeccable hook` e são
guardados por um teste de existência do arquivo, então viram no-op se a skill
for removida. O launcher baixa o binário do engine para `~/.impeccable/bin/` na
primeira execução — não precisa de Node.

Para desativar os hooks sem desinstalar a skill, remova o bloco `hooks` de
`.claude/settings.json`.

## Taste Skill — direções visuais e anti-slop

O nome da pasta é o nome de invocação, que difere do nome da pasta no repositório
de origem. A coluna "origem" registra essa correspondência.

| Skill | Origem | Para quê |
| --- | --- | --- |
| `design-taste-frontend` | `taste-skill` | Padrão v2 (experimental): lê o brief, infere a direção, entrega interface que não parece template |
| `design-taste-frontend-v1` | `taste-skill-v1` | v1 original, preservada para compatibilidade exata |
| `gpt-taste` | `gpt-tasteskill` | Variante mais rígida para GPT/Codex: mais variância de layout, GSAP forte |
| `image-to-code` | `image-to-code-skill` | Pipeline imagem-primeiro: gera referências, analisa, então implementa |
| `redesign-existing-projects` | `redesign-skill` | Projetos existentes: audita a UI antes de mexer em layout e hierarquia |
| `high-end-visual-design` | `soft-skill` | UI cara e calma: contraste suave, whitespace, fontes premium, spring |
| `full-output-enforcement` | `output-skill` | Quando o modelo entrega trabalho pela metade: saída completa, sem placeholder |
| `minimalist-ui` | `minimalist-skill` | UI editorial de produto (Notion/Linear), paleta contida |
| `industrial-brutalist-ui` | `brutalist-skill` | Linguagem mecânica dura: tipografia suíça, contraste agressivo |
| `stitch-design-taste` | `stitch-skill` | Regras compatíveis com Google Stitch, com formato de export `DESIGN.md` |
| `imagegen-frontend-web` | `imagegen-frontend-web` | Comps de site — só imagens, uma por seção |
| `imagegen-frontend-mobile` | `imagegen-frontend-mobile` | Telas e fluxos mobile — só imagens |
| `brandkit` | `brandkit` | Boards de brand kit: logo, paleta, tipografia, aplicações |

As três últimas produzem apenas imagens de referência, não código.

## Atualizando

Cada coleção tem seu instalador oficial, que sobrescreve as pastas em
`.claude/skills/` no lugar:

```bash
npx skills@latest add emilkowalski/skills
npx skills add https://github.com/Leonxlnx/taste-skill
npx impeccable update
```

Depois de atualizar, confira se o nome da pasta ainda bate com o campo `name` do
frontmatter — o Claude Code resolve a skill pelo nome da pasta.
