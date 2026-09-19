# Os jobs do push

Dois, os dois chamados pelo Vercel Cron (`apps/web/vercel.json`):

| Rota                      | Frequência        | O que faz                                            |
| ------------------------- | ----------------- | ---------------------------------------------------- |
| `/api/jobs/dispatch-push` | a cada minuto     | Envia as campanhas vencidas e os envios de automação |
| `/api/jobs/push-stats`    | a cada 15 minutos | Busca entregas e aberturas na OneSignal              |

## O que precisa estar configurado

| Variável                    | Onde               | Para quê                              |
| --------------------------- | ------------------ | ------------------------------------- |
| `CRON_SECRET`               | ambiente da Vercel | Provar que quem chamou o job é o cron |
| `SUPABASE_SERVICE_ROLE_KEY` | ambiente da Vercel | Ler e escrever fora da RLS            |
| `ENCRYPTION_KEY`            | ambiente da Vercel | Abrir a chave REST de cada loja       |

A Vercel gera e injeta `CRON_SECRET` automaticamente nos projetos que usam
Cron. Sem ele, o job responde **503 e não faz nada** — é proposital: um job sem
segredo é um endpoint público que dispara notificação para a base de todos os
clientes, e "ainda não configurei" não pode ser a porta de entrada disso.

## Por que não dá para enviar a mesma campanha duas vezes

A reserva acontece dentro do banco, em `reservar_campanhas`, num
`update ... returning` com `for update skip locked`. Duas execuções
sobrepostas do cron não disputam a mesma linha: a segunda pula o que a
primeira pegou e não tem o que enviar.

Ler no servidor web e marcar depois deixaria justamente a janela entre as duas
coisas — e um push duplicado para a base inteira de uma loja não tem desfazer.

## Quando um envio falha

- **Falha permanente** (chave errada, corpo recusado, nenhum destinatário): a
  campanha é marcada como `failed` com o motivo, que aparece na tela C10. O
  lojista precisa ver o motivo; repetir não conserta configuração.
- **Falha passageira** (rede, 5xx, tempo esgotado): nada é marcado. A linha
  fica reservada e `devolver_campanhas_presas` a recoloca na fila em 15
  minutos, quando o minuto seguinte tenta de novo.

Marcar uma queda de rede como falha jogaria fora uma campanha que ia sair no
minuto seguinte — e o lojista veria "falhou" sem nada de errado do lado dele.

## O que o job NÃO decide

A janela de silêncio (22h–8h no fuso da loja) e o teto de um push de carrinho a
cada 24 horas por aparelho são reconferidos em
`reservar_envios_de_automacao`, no banco, e não aqui. Entre agendar e enviar
passa pelo menos uma hora: um job atrasado por queda acordaria o cliente às
três da manhã, e outro envio pode ter acontecido no meio do caminho.
