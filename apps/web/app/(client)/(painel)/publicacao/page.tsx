/** Publicação do app nas lojas (C12). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Rocket, Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  dadosDaPublicacao,
  identificadorLivre,
  temBuildEmAndamento,
} from '@/lib/publicacao-servidor';
import { montarChecklist } from '@/lib/checklist-de-publicacao';
import { montarFicha } from '@/lib/ficha-da-loja';
import { montarNotasDaRevisao } from '@/lib/notas-da-revisao';
import { arquivosDeAssociacao, situacaoDosLinks } from '@/lib/links-do-app';
import { dominioDe } from '@/lib/ficha-da-loja';
import { formatarData } from '@/lib/fuso';
import { urlDoSite } from '@/lib/env';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { ChecklistDaPlataforma } from './checklist';
import { HistoricoDeBuilds } from './historico';
import { BuildsAoVivo } from './ao-vivo';
import { FichaDaLoja } from './ficha';
import { IdentificadorDoApp } from './identificador';
import { LinksDaLoja } from './links-da-loja';
import { UltimoPasso } from './ultimo-passo';
import { passosPendentes } from '@/lib/ultimo-passo';

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
  // A sugestão só é calculada enquanto não há identificador: depois, não há o que sugerir.
  const sugestao =
    dados.identidade.identificador === null
      ? await identificadorLivre(criarClientServiceRole(), dados.loja.url, dados.loja.nome)
      : null;

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

      {/* Quando a vez é do lojista, é a primeira coisa da tela. */}
      <UltimoPasso
        pendentes={passosPendentes(dados.builds, { iosAscAppId: dados.identidade.iosAscAppId })}
      />

      <IdentificadorDoApp
        identificador={dados.identidade.identificador}
        sugestao={sugestao}
        travado={dados.identidade.travado}
        appleConectada={dados.estado.appleConectada}
        iosAscAppId={dados.identidade.iosAscAppId}
        nomeDoApp={dados.estado.nomeDoApp}
        podeEscrever={podeEscrever}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChecklistDaPlataforma plataforma="ios" itens={itens} podeEscrever={podeEscrever} />
        <ChecklistDaPlataforma plataforma="android" itens={itens} podeEscrever={podeEscrever} />
      </div>

      <LinksDaLoja
        situacao={situacaoDosLinks(dados.links)}
        plataformaDaLoja={dados.links.plataformaDaLoja}
        dominio={dados.links.dominio === '' ? '' : dominioDe(dados.links.dominio)}
        impressoes={dados.links.impressoesAndroid}
        erro={dados.links.erro}
        arquivos={
          dados.links.plataformaDaLoja === 'other' ? arquivosDeAssociacao(dados.links) : null
        }
        vinculadoEm={{
          ios:
            dados.links.iosVinculadoEm === null
              ? null
              : formatarData(dados.links.iosVinculadoEm, lojaAtiva.timezone),
          android:
            dados.links.androidVinculadoEm === null
              ? null
              : formatarData(dados.links.androidVinculadoEm, lojaAtiva.timezone),
        }}
        podeEscrever={podeEscrever}
      />

      <FichaDaLoja
        campos={montarFicha({
          nomeDaLoja: dados.loja.nome,
          urlDaLoja: dados.loja.url,
          pushLigado: dados.estado.pushLigado,
        })}
        notasDaRevisao={
          dados.configPublicada === null
            ? null
            : montarNotasDaRevisao({
                nomeDaLoja: dados.loja.nome,
                urlDaLoja: dados.loja.url,
                pushLigado: dados.estado.pushLigado,
                config: dados.configPublicada,
                linksNoApp: dados.links.iosVinculadoEm !== null,
              })
        }
        urlDaPolitica={`${urlDoSite()}/privacy/${lojaAtiva.id}`}
        temContato={dados.loja.temContato}
        jaPublicado={dados.builds.some(
          (build) => build.status === 'approved' || build.status === 'submitted',
        )}
      />

      <HistoricoDeBuilds
        builds={dados.builds}
        fuso={lojaAtiva.timezone}
        iosAscAppId={dados.identidade.iosAscAppId}
      />
    </div>
  );
}
