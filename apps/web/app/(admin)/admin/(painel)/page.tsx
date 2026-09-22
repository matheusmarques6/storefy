/**
 * A02 — Visão geral do admin.
 *
 * A PRIMEIRA TELA DE QUEM ABRE O ADMIN DE MANHÃ, e por isso ela responde uma
 * pergunta só: tem alguma coisa para eu fazer agora? O que pede ação vem
 * primeiro, e some quando não existe; o panorama da plataforma vem depois, e
 * aparece inclusive zerado, porque ali o zero é informação.
 *
 * UMA CHAMADA AO BANCO, não dez: `resumo_do_admin` devolve os dez números de
 * uma vez. A decisão do que é pendência mora em `lib/resumo-admin`, testada
 * sem montar página nenhuma.
 *
 * FATURAMENTO NÃO APARECE AQUI, e a tela diz isso em voz alta em vez de
 * omitir: não existe tabela de cobrança ainda (Fase 7). Um MRR inventado numa
 * tela de dinheiro seria o pior tipo de dado falso — ninguém confere o que já
 * parece plausível.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, CheckCircle2, CreditCard, TriangleAlert } from 'lucide-react';
import { criarClientServidor } from '@/lib/supabase/server';
import { pendencias, panorama, plataformaVazia, type NumeroDoResumo } from '@/lib/resumo-admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

export const metadata: Metadata = { title: 'Visão geral · Admin' };

export default async function PaginaVisaoGeral() {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase.rpc('resumo_do_admin');

  if (error != null) {
    throw new Error(`Não foi possível carregar a visão geral: ${error.message}`);
  }

  /*
   * A função devolve exatamente uma linha. A ausência dela não é "zero
   * clientes" — é a chamada não ter acontecido —, e tratar as duas igual
   * mostraria um painel zerado tranquilo no lugar de um erro.
   */
  const resumo = data[0];
  if (resumo == null) {
    throw new Error('A visão geral voltou vazia do banco.');
  }

  const pendente = pendencias(resumo);
  const geral = panorama(resumo);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-muted-foreground mt-1 text-sm">A plataforma inteira, de uma olhada.</p>
      </div>

      {plataformaVazia(resumo) ? (
        <EstadoVazio
          icone={Building2}
          titulo="Nenhum cliente ainda"
          descricao="Os números aparecem aqui assim que a primeira organização se cadastrar."
        />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-sm font-medium">Precisa de você</h2>

            {pendente.length === 0 ? (
              <Card>
                <CardContent className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
                  <CheckCircle2 className="text-foreground size-4 shrink-0" aria-hidden />
                  Nada pendente. Nenhuma cobrança atrasada, build quebrado ou conta com erro.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pendente.map((item) => (
                  <Numero key={item.chave} item={item} atencao />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium">A plataforma hoje</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {geral.map((item) => (
                <Numero key={item.chave} item={item} atencao={false} />
              ))}
            </div>
          </section>
        </>
      )}

      {/*
       * O estado de "não configurado" que a regra de zero mock exige: a tela
       * diz o que falta e por quê, em vez de mostrar um MRR de mentira ou de
       * simplesmente não falar no assunto — o que faria o admin procurar o
       * número achando que ele existe em algum lugar.
       */}
      <Card>
        <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
          <CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Faturamento e MRR ainda não aparecem aqui: a cobrança entra na Fase 7. Até lá o plano de
            cada cliente está na ficha dele, em{' '}
            <Link href="/admin/organizacoes" className="text-foreground underline">
              Organizações
            </Link>
            .
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Um número.
 *
 * O cartão vira link só quando a tela de destino existe — um número que parece
 * clicável e não leva a lugar nenhum gasta a confiança de quem clicou. As
 * telas de build (A05) e de revisão (A06) ainda não existem, e por isso os
 * números delas são texto.
 */
function Numero({ item, atencao }: { item: NumeroDoResumo; atencao: boolean }) {
  const conteudo = (
    <>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{item.rotulo}</CardTitle>
        {atencao ? (
          <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden />
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-3xl font-semibold tabular-nums">{item.valor}</p>
        <p className="text-muted-foreground mt-1 text-xs">{item.ajuda}</p>
      </CardContent>
    </>
  );

  if (item.href == null) return <Card>{conteudo}</Card>;

  return (
    <Card className="hover:border-foreground/20 transition-colors">
      <Link href={item.href} className="block" aria-label={`${item.rotulo}: ${item.valor}`}>
        {conteudo}
      </Link>
    </Card>
  );
}
