/**
 * Os quatro números do topo das notificações.
 *
 * Todos saem de dado real. Quando um número ainda não existe, vai traço — e
 * não zero: "0 aparelhos" é uma afirmação sobre o app do lojista, e dizê-la
 * porque a contagem falhou faria ele achar que ninguém instalou (regra 1).
 */
import { Bell, CheckCircle2, ShoppingBag, Smartphone } from 'lucide-react';
import { CartaoDeNumero } from '@/components/cartao-de-numero';
import { comoReais } from '@/lib/analytics';
import { numeroOuTraco } from '@/lib/campanha';
import type { ResumoDasCampanhas } from '@/lib/push-servidor';
import { MOTIVO_SEM_VENDAS, dicaDasVendas, type Vendas } from '@/lib/vendas-do-push';

export function ResumoDoPush({
  aparelhos,
  resumo,
  vendas,
}: {
  aparelhos: number | null;
  /**
   * De TODAS as campanhas, somado no banco — e não da página que a lista
   * mostra. A soma só conta o que o job de estatísticas já gravou: uma
   * campanha sem número ainda não entra como zero puxando o total para baixo.
   */
  resumo: ResumoDasCampanhas;
  /** Campanhas e automações nos últimos 30 dias. `null` sem a Shopify conectada. */
  vendas: Vendas | null;
}) {
  const { enviadas, entregues } = resumo;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CartaoDeNumero
        icone={Smartphone}
        rotulo="Aparelhos com o app"
        valor={numeroOuTraco(aparelhos)}
        dica="Quem instalou e pode receber notificações."
      />
      <CartaoDeNumero
        icone={CheckCircle2}
        rotulo="Campanhas enviadas"
        valor={enviadas.toLocaleString('pt-BR')}
        dica="Total já disparado por esta loja."
      />
      <CartaoDeNumero
        icone={Bell}
        rotulo="Notificações entregues"
        valor={numeroOuTraco(entregues)}
        dica={
          entregues === null
            ? 'Aparece algumas horas depois do primeiro envio.'
            : 'Soma das campanhas com estatística disponível.'
        }
      />
      <CartaoDeNumero
        icone={ShoppingBag}
        rotulo="Vendas pelas notificações"
        valor={vendas === null ? '—' : comoReais(vendas.receitaCents)}
        dica={vendas === null ? MOTIVO_SEM_VENDAS : dicaDasVendas(vendas)}
      />
    </div>
  );
}
