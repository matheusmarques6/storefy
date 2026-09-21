/**
 * C05 — Dashboard.
 *
 * Mostra apenas dados reais do banco. Enquanto não houver loja, aparece o
 * estado vazio guiando à criação da primeira — nunca métricas de exemplo
 * (regra 1 das inegociáveis). Os números do topo são os da LOJA ATIVA, e só
 * aparecem quando existem: um zero grande na primeira tela diria ao lojista
 * que o app dele fracassou, quando ele ainda nem publicou.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Plus,
  Rocket,
  ShoppingBag,
  Store as IconeLoja,
  Users,
} from 'lucide-react';
import { ROTULO_STATUS_LOJA, podeEscrever, type StoreStatus } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appDaLoja } from '@/lib/push-servidor';
import { numerosDoPeriodo } from '@/lib/analytics-servidor';
import { comoNumero, comoPorcentagem, comoReais, fatiaDoApp, temMovimento } from '@/lib/analytics';
import { CartaoDeNumero } from '@/components/cartao-de-numero';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

/** O período do resumo da primeira tela. O detalhe fica no C11. */
const DIAS_DO_RESUMO = 30;

export const metadata: Metadata = { title: 'Início' };

const VARIANTE_POR_STATUS: Record<StoreStatus, 'secondary' | 'warning' | 'success'> = {
  draft: 'secondary',
  building: 'warning',
  in_review: 'warning',
  live: 'success',
  paused: 'secondary',
};

export default async function PaginaInicio() {
  const { lojas, lojaAtiva, organizacao, papel } = await exigirContextoCliente();
  const podeCriar = podeEscrever(papel);
  const resumo = await resumoDaLojaAtiva(lojaAtiva);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Olá, {organizacao.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {lojas.length === 0
              ? 'Vamos colocar sua primeira loja no ar.'
              : `Você tem ${String(lojas.length)} ${lojas.length === 1 ? 'loja cadastrada' : 'lojas cadastradas'}.`}
          </p>
        </div>
        {podeCriar && lojas.length > 0 ? (
          <Button asChild>
            <Link href="/lojas/nova">
              <Plus aria-hidden />
              Nova loja
            </Link>
          </Button>
        ) : null}
      </div>

      {resumo == null ? null : (
        <section aria-labelledby="titulo-resumo" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="titulo-resumo" className="text-muted-foreground text-sm font-medium">
              {lojaAtiva?.name} · últimos {String(DIAS_DO_RESUMO)} dias
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/analytics">
                Ver tudo
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <CartaoDeNumero
              icone={ShoppingBag}
              rotulo="Receita pelo app"
              valor={comoReais(resumo.totais.revenueAppCents)}
              dica={`${comoNumero(resumo.totais.ordersApp)} ${resumo.totais.ordersApp === 1 ? 'pedido' : 'pedidos'} vindos do app.`}
            />
            <CartaoDeNumero
              icone={BarChart3}
              rotulo="Fatia do app"
              valor={comoPorcentagem(fatiaDoApp(resumo.totais))}
              dica={
                fatiaDoApp(resumo.totais) === null
                  ? 'Aparece no primeiro pedido pela loja.'
                  : 'Do que a loja vendeu no período.'
              }
            />
            <CartaoDeNumero
              icone={Users}
              rotulo="Aparelhos ativos"
              valor={comoNumero(resumo.ativosNoPeriodo)}
              dica={`${comoNumero(resumo.totais.installs)} ${resumo.totais.installs === 1 ? 'instalação' : 'instalações'} no período.`}
            />
          </div>
        </section>
      )}

      {lojas.length === 0 ? (
        <EstadoVazio
          icone={Rocket}
          titulo="Nenhuma loja por aqui ainda"
          descricao={
            podeCriar
              ? 'Cadastre sua loja com o nome e o endereço dela. Depois você personaliza o app e publica nas lojas de aplicativos.'
              : 'Ninguém cadastrou uma loja ainda. Peça a um proprietário ou administrador da empresa para criar a primeira.'
          }
          acao={
            podeCriar ? (
              <Button asChild>
                <Link href="/lojas/nova">
                  <Plus aria-hidden />
                  Cadastrar minha primeira loja
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section aria-labelledby="titulo-lojas" className="space-y-4">
          <h2 id="titulo-lojas" className="text-muted-foreground text-sm font-medium">
            Suas lojas
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lojas.map((loja) => (
              <Card key={loja.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="truncate text-base">{loja.name}</CardTitle>
                    <Badge variant={VARIANTE_POR_STATUS[loja.status]}>
                      {ROTULO_STATUS_LOJA[loja.status]}
                    </Badge>
                  </div>
                  <CardDescription className="truncate">{loja.primary_url}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-2 pt-0">
                  <span className="text-muted-foreground text-xs">
                    Criada em{' '}
                    {new Date(loja.created_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/lojas/${loja.id}`}>Abrir</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {lojas.length === 0 ? null : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconeLoja className="text-muted-foreground size-4" aria-hidden />
              <CardTitle className="text-base">Por onde seguir</CardTitle>
            </div>
            <CardDescription>
              {resumo == null
                ? 'Deixe o app do jeito da sua loja, publique nas lojas de aplicativos e conecte a Shopify para a receita ficar separada entre app e site.'
                : 'Os números acima se atualizam sozinhos de hora em hora.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/app">Personalizar o app</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/publicacao">Publicar nas lojas</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/integracoes">Conectar a Shopify</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/push">Criar uma notificação</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * O resumo da loja ativa, ou `null` quando não há o que mostrar.
 *
 * `null` também quando os números existem mas são todos zero: um zero grande
 * na primeira tela diria ao lojista que o app dele fracassou, quando ele ainda
 * nem publicou. Nesse caso a tela mostra o que fazer, e não o placar vazio.
 */
async function resumoDaLojaAtiva(
  lojaAtiva: { id: string; timezone: string | null } | null,
): Promise<Awaited<ReturnType<typeof numerosDoPeriodo>> | null> {
  if (lojaAtiva == null) return null;

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) return null;

  const numeros = await numerosDoPeriodo(supabase, app.id, lojaAtiva.timezone, DIAS_DO_RESUMO);
  return temMovimento(numeros.totais) ? numeros : null;
}
