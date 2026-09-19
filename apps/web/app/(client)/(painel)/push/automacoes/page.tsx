/** Automações de push (C09). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja, listarAutomacoes } from '@/lib/push-servidor';
import { TIPOS_DE_AUTOMACAO } from '@/lib/automacao';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { AbasDoPush } from '../abas';
import { PushNaoConfigurado } from '../nao-configurado';
import { CartaoDaAutomacao } from './cartao';

export const metadata: Metadata = { title: 'Automações' };

export default async function PaginaDeAutomacoes() {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Cadastre uma loja primeiro"
        descricao="As automações são de uma loja. Cadastre a sua para começar."
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
        icone={Smartphone}
        titulo="Não encontramos o app desta loja"
        descricao="Recarregue a página. Se continuar assim, fale com o suporte."
      />
    );
  }

  const salvas = await listarAutomacoes(supabase, app.id);
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-muted-foreground text-sm">
          Mensagens que saem sozinhas, no momento certo, sem você precisar lembrar.
        </p>
      </div>

      {app.oneSignalAppId === null ? <PushNaoConfigurado /> : null}

      <AbasDoPush atual="automacoes" />

      <div className="grid gap-4">
        {TIPOS_DE_AUTOMACAO.map((tipo) => (
          <CartaoDaAutomacao
            key={tipo}
            tipo={tipo}
            salva={salvas.find((automacao) => automacao.type === tipo) ?? null}
            urlDaLoja={lojaAtiva.primary_url}
            nomeDoApp={lojaAtiva.name}
            podeEscrever={podeEscrever}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Outras automações — aviso de volta ao estoque, pedido enviado e cliente inativo — entram em
        uma próxima atualização. Elas aparecem aqui quando estiverem prontas para usar.
      </p>
    </div>
  );
}
