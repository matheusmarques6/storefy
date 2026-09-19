/** Publicação do app nas lojas (C12). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Rocket, Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { dadosDaPublicacao, temBuildEmAndamento } from '@/lib/publicacao-servidor';
import { montarChecklist } from '@/lib/checklist-de-publicacao';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { ChecklistDaPlataforma } from './checklist';
import { HistoricoDeBuilds } from './historico';
import { BuildsAoVivo } from './ao-vivo';

export const metadata: Metadata = { title: 'Publicação' };

export default async function PaginaDePublicacao() {
  const { lojaAtiva, organizacao, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Cadastre uma loja primeiro"
        descricao="A publicação é de uma loja. Cadastre a sua para começar."
        acao={
          <Button asChild>
            <Link href="/lojas/nova">Cadastrar loja</Link>
          </Button>
        }
      />
    );
  }

  const supabase = await criarClientServidor();
  const dados = await dadosDaPublicacao(supabase, lojaAtiva.id, organizacao.id);

  if (dados == null) {
    return (
      <EstadoVazio
        icone={Rocket}
        titulo="Não encontramos o app desta loja"
        descricao="Recarregue a página. Se continuar assim, fale com o suporte."
      />
    );
  }

  const itens = montarChecklist(dados.estado);
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Publicação</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          O que falta para o seu app chegar à App Store e à Play Store, e o histórico do que já foi
          enviado.
        </p>
        {/*
          Enquanto um build acontece, a tela se atualiza sozinha: ele termina
          por um aviso do EAS que chega minutos depois, sem ninguém clicar em
          nada.
        */}
        <BuildsAoVivo appId={dados.appId} emAndamento={temBuildEmAndamento(dados.builds)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChecklistDaPlataforma plataforma="ios" itens={itens} podeEscrever={podeEscrever} />
        <ChecklistDaPlataforma plataforma="android" itens={itens} podeEscrever={podeEscrever} />
      </div>

      <HistoricoDeBuilds builds={dados.builds} />
    </div>
  );
}
