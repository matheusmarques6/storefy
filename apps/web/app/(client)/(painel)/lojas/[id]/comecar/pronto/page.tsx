/**
 * C04 — Onboarding 3: o app no celular e o que falta para ele ir ao ar.
 *
 * O último passo do começo: o código do app Storefy Preview, para o lojista
 * ver o app dele no próprio celular antes de publicar, e o checklist dos
 * primeiros passos com o estado de verdade — o mesmo que o painel mostra até
 * o app estar no ar.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PartyPopper } from 'lucide-react';
import { COLUNAS_DA_LOJA, podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { dadosDaPublicacao } from '@/lib/publicacao-servidor';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { ondeBaixarAPrevia } from '@/lib/configuracoes-da-plataforma';
import { entradaDaPublicacao, primeirosPassos, progressoDosPassos } from '@/lib/primeiros-passos';
import { ehUuid } from '@/lib/app-config-publica';
import { lido } from '@/lib/leitura';
import { ListaDePrimeirosPassos } from '@/components/primeiros-passos';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PreviaNoCelular } from '../../../../app/previa-no-celular';
import { OutraLojaAtiva } from '../outra-loja-ativa';
import { PassosDoComeco } from '../passos';

export const metadata: Metadata = { title: 'Tudo pronto' };

export default async function PaginaDoComecoPronto({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!ehUuid(id)) notFound();

  const { papel, lojaAtiva } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const { data: loja } = lido(
    await supabase.from('stores').select(COLUNAS_DA_LOJA).eq('id', id).maybeSingle(),
    'a loja',
  );
  if (loja == null) notFound();

  const [dados, plataforma] = await Promise.all([
    dadosDaPublicacao(supabase, loja.id, loja.org_id),
    configuracoesDaPlataforma(),
  ]);
  if (dados == null) {
    return (
      <EstadoVazio
        icone={PartyPopper}
        titulo="Não encontramos o app desta loja"
        descricao="Recarregue a página. Se continuar assim, fale com o suporte."
      />
    );
  }

  const podeAgir = podeEscrever(papel);
  const passos = primeirosPassos(entradaDaPublicacao(dados));
  const { feitos, total } = progressoDosPassos(passos);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PassosDoComeco atual="celular" />

      {lojaAtiva?.id === loja.id ? null : <OutraLojaAtiva lojaId={loja.id} nome={loja.name} />}

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <PartyPopper className="text-primary size-6" aria-hidden />
          Tudo pronto para ver no celular
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          O app de {loja.name} já existe como rascunho. Veja como ele fica no seu celular antes de
          publicar — e, abaixo, o que falta para ele chegar aos seus clientes.
        </p>
      </div>

      {podeAgir ? (
        <PreviaNoCelular
          storeId={loja.id}
          somenteLeitura={false}
          ondeBaixar={ondeBaixarAPrevia(plataforma)}
        />
      ) : (
        <p className="text-muted-foreground rounded-xl border p-4 text-sm">
          O código da prévia no celular é gerado por proprietários e administradores.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Até o app ir ao ar</CardTitle>
          <CardDescription>
            {String(feitos)} de {String(total)} passos feitos. Este checklist também fica no início
            do painel, até o app ser aprovado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListaDePrimeirosPassos passos={passos} podeAgir={podeAgir} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/">Ir para o painel</Link>
        </Button>
        {podeAgir ? (
          <Button asChild variant="outline">
            <Link href="/app">Abrir o editor do app</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
