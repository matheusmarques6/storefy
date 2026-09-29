/**
 * A faixa que diz, em cima de TODA tela, que é a equipe olhando o painel de um
 * cliente.
 *
 * Sem ela, a pessoa da equipe esqueceria em que painel está — o layout é o
 * mesmo do dela — e procuraria por que o botão de salvar sumiu. E quem estiver
 * compartilhando a tela com o cliente precisa que isso esteja escrito.
 *
 * O formulário daqui é o único jeito de encerrar que funciona dentro de um
 * menu: `id` fixo para o item "Encerrar visita" do menu da conta disparar ESTE
 * envio. Um `<form>` dentro do menu seria desmontado pelo Radix antes de
 * enviar — o defeito que já deixou o "Sair" sem funcionar.
 */
import { Eye, LogOut } from 'lucide-react';
import { FUSO_PADRAO, formatarHora } from '@/lib/fuso';
import { Button } from '@/components/ui/button';

export const ID_DO_FORMULARIO_DE_ENCERRAR = 'encerrar-visita';

export function FaixaDaVisita({ cliente, expiraEm }: { cliente: string; expiraEm: string }) {
  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <p className="flex min-w-0 items-center gap-2">
          <Eye className="size-4 shrink-0" aria-hidden />
          <span>
            Você está vendo o painel de <strong>{cliente}</strong> como cliente. Somente leitura,
            até {formatarHora(expiraEm, FUSO_PADRAO)}.
          </span>
        </p>
        <form id={ID_DO_FORMULARIO_DE_ENCERRAR} method="post" action="/visita/encerrar">
          <Button type="submit" size="sm" variant="outline" className="bg-background h-8">
            <LogOut className="size-4" aria-hidden />
            Encerrar visita
          </Button>
        </form>
      </div>
    </div>
  );
}
