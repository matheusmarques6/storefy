/** Nova campanha de push (C08). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { estadoDasNotificacoes } from '@/lib/ativar-push';
import { aparelhosRecentes, appDaLoja } from '@/lib/push-servidor';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { PushNaoConfigurado } from '../nao-configurado';
import { NovaCampanha } from './nova-campanha';

export const metadata: Metadata = { title: 'Nova campanha' };

export default async function PaginaDeNovaCampanha() {
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

  if (papel !== 'owner' && papel !== 'admin') {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Você não tem permissão para criar campanhas"
        descricao="Apenas proprietários e administradores enviam notificações. Peça acesso a quem administra a organização."
        acao={
          <Button asChild variant="outline">
            <Link href="/push">Voltar</Link>
          </Button>
        }
      />
    );
  }

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  const [aparelhos, notificacoes] = await Promise.all([
    app == null ? Promise.resolve([]) : aparelhosRecentes(supabase, app.id),
    estadoDasNotificacoes(criarClientServiceRole(), lojaAtiva.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/push"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Notificações
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Nova campanha</h1>
        <p className="text-muted-foreground text-sm">
          Escreva a mensagem e veja como ela vai aparecer no celular do seu cliente.
        </p>
      </div>

      {notificacoes.ligado ? null : (
        <PushNaoConfigurado pendencias={notificacoes.pendencias} podeEscrever />
      )}

      <NovaCampanha
        nomeDoApp={lojaAtiva.name}
        urlDaLoja={lojaAtiva.primary_url}
        aparelhos={aparelhos}
      />
    </div>
  );
}
