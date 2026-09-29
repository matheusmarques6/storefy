/** Editar uma campanha que ainda não saiu (C08, no modo de edição). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { aparelhosRecentes, appDaLoja, buscarCampanha, contarAparelhos } from '@/lib/push-servidor';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { estadoDasNotificacoes } from '@/lib/ativar-push';
import { podeEditar } from '@/lib/campanha';
import { nomeDoFuso, paraCampoLocal } from '@/lib/fuso';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { EditarCampanha } from './editar-campanha';

export const metadata: Metadata = { title: 'Editar campanha' };

export default async function PaginaDeEdicao({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { lojaAtiva, papel } = await exigirContextoCliente();
  if (lojaAtiva == null) notFound();

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) notFound();

  const campanha = await buscarCampanha(supabase, app.id, id);
  if (campanha == null) notFound();

  const [aparelhos, alcance, notificacoes] = await Promise.all([
    aparelhosRecentes(supabase, app.id),
    contarAparelhos(supabase, app.id),
    // Service role porque precisa saber se os SEGREDOS existem; volta só
    // booleano e texto (ver a página da lista).
    estadoDasNotificacoes(criarClientServiceRole(), lojaAtiva.id),
  ]);

  if (papel !== 'owner' && papel !== 'admin') {
    return (
      <EstadoVazio
        icone={ChevronLeft}
        titulo="Você não tem permissão para editar campanhas"
        descricao="Apenas proprietários e administradores mexem nas notificações."
        acao={
          <Button asChild variant="outline">
            <Link href="/push">Voltar</Link>
          </Button>
        }
      />
    );
  }

  /*
   * Campanha já enviada não se edita. A tela diz isso em vez de mostrar um
   * formulário que o servidor vai recusar — e o histórico continua sendo o
   * texto que realmente chegou nos celulares.
   */
  if (!podeEditar(campanha.status)) {
    return (
      <EstadoVazio
        icone={ChevronLeft}
        titulo="Esta campanha já saiu"
        descricao="O texto enviado não muda mais. Se quiser corrigir algo, crie uma campanha nova."
        acao={
          <Button asChild variant="outline">
            <Link href={`/push/${campanha.id}`}>Ver a campanha</Link>
          </Button>
        }
      />
    );
  }

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
        <h1 className="text-2xl font-semibold tracking-tight">Editar campanha</h1>
      </div>

      <EditarCampanha
        campanhaId={campanha.id}
        rascunho={campanha.status === 'draft'}
        nomeDoApp={lojaAtiva.name}
        urlDaLoja={lojaAtiva.primary_url}
        fuso={lojaAtiva.timezone}
        nomeDoFuso={nomeDoFuso(lojaAtiva.timezone)}
        aparelhos={aparelhos}
        alcance={alcance}
        notificacoesLigadas={notificacoes.ligado}
        iniciais={{
          title: campanha.title,
          body: campanha.body,
          deepLink: campanha.deepLink ?? '',
          // No fuso DA LOJA, e não no do servidor: era o que fazia a hora
          // errada voltar "certa" na edição e o defeito ficar invisível.
          agendarPara: paraCampoLocal(campanha.scheduledAt, lojaAtiva.timezone),
          enviarAgora: campanha.status === 'draft',
        }}
      />
    </div>
  );
}
