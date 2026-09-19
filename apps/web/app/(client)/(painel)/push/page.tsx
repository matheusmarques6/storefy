/** Campanhas de push da loja ativa (C07). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell, Plus, Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja, contarAparelhos, listarCampanhas } from '@/lib/push-servidor';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { PushNaoConfigurado } from './nao-configurado';
import { AbasDoPush } from './abas';
import { ListaDeCampanhas } from './lista-de-campanhas';
import { ResumoDoPush } from './resumo';

export const metadata: Metadata = { title: 'Notificações' };

export default async function PaginaDeCampanhas() {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Cadastre uma loja primeiro"
        descricao="As notificações são de uma loja. Cadastre a sua para começar."
        acao={
          <Button asChild>
            <Link href="/lojas/nova">Cadastrar loja</Link>
          </Button>
        }
      />
    );
  }

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);

  if (app == null) {
    return (
      <EstadoVazio
        icone={Bell}
        titulo="Não encontramos o app desta loja"
        descricao="Recarregue a página. Se continuar assim, fale com o suporte."
      />
    );
  }

  const [campanhas, aparelhos] = await Promise.all([
    listarCampanhas(supabase, app.id),
    contarAparelhos(supabase, app.id),
  ]);

  const configurado = app.oneSignalAppId !== null;
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
          <p className="text-muted-foreground text-sm">
            Avise seus clientes sobre promoções, novidades e pedidos.
          </p>
        </div>
        {podeEscrever ? (
          <Button asChild>
            <Link href="/push/nova">
              <Plus className="size-4" aria-hidden />
              Nova campanha
            </Link>
          </Button>
        ) : null}
      </div>

      {configurado ? null : <PushNaoConfigurado />}

      <ResumoDoPush aparelhos={aparelhos} campanhas={campanhas} />

      <AbasDoPush atual="campanhas" />

      <ListaDeCampanhas campanhas={campanhas} podeEscrever={podeEscrever} />
    </div>
  );
}
