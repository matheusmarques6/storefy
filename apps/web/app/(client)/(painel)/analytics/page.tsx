/** Analytics da loja (C11). */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  Bell,
  Download,
  ShoppingBag,
  Smartphone,
  Store as IconeLoja,
  Users,
} from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { appContaAberturas, appDaLoja } from '@/lib/push-servidor';
import { nomeDoFuso } from '@/lib/fuso';
import { numerosDoPeriodo } from '@/lib/analytics-servidor';
import {
  comoNumero,
  comoPorcentagem,
  comoReais,
  fatiaDoApp,
  lerPeriodo,
  temMovimento,
} from '@/lib/analytics';
import { CartaoDeNumero } from '@/components/cartao-de-numero';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SeletorDePeriodo } from './periodo';
import { GraficoDeReceita, GraficoDeUso } from './grafico';

export const metadata: Metadata = { title: 'Analytics' };

export default async function PaginaDeAnalytics({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { lojaAtiva } = await exigirContextoCliente();
  const { periodo } = await searchParams;
  const dias = lerPeriodo(periodo);

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={IconeLoja}
        titulo="Cadastre uma loja primeiro"
        descricao="Os números são de uma loja. Cadastre a sua para começar a acompanhar."
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
        titulo="O app desta loja ainda não existe"
        descricao="Ele é criado junto com a loja. Se você está vendo esta tela, fale com o suporte."
      />
    );
  }

  const [{ serie, totais, ativosNoPeriodo, de, ate }, contaAberturas] = await Promise.all([
    numerosDoPeriodo(supabase, app.id, lojaAtiva.timezone, dias),
    appContaAberturas(supabase, app.id),
  ]);

  const fatia = fatiaDoApp(totais);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {lojaAtiva.name} · {intervalo(de, ate)}
          </p>
        </div>
        <SeletorDePeriodo atual={dias} />
      </div>

      {!temMovimento(totais) ? (
        <EstadoVazio
          icone={BarChart3}
          titulo="Ainda não há números para mostrar"
          descricao={
            'Os números aparecem sozinhos quando o app começar a ser usado: instalações, ' +
            'aberturas e os pedidos que vierem dele. Publique o app e conecte a Shopify para a ' +
            'receita ficar separada entre app e site.'
          }
          acao={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/publicacao">Ir para a publicação</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/integracoes">Conectar a Shopify</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CartaoDeNumero
              icone={ShoppingBag}
              rotulo="Receita pelo app"
              valor={comoReais(totais.revenueAppCents)}
              dica={`${comoNumero(totais.ordersApp)} ${totais.ordersApp === 1 ? 'pedido' : 'pedidos'} no período.`}
            />
            <CartaoDeNumero
              icone={BarChart3}
              rotulo="Fatia do app"
              valor={comoPorcentagem(fatia)}
              dica={
                fatia === null
                  ? 'Aparece quando houver o primeiro pedido.'
                  : `De ${comoReais(totais.revenueAppCents + totais.revenueSiteCents)} vendidos no total.`
              }
            />
            <CartaoDeNumero
              icone={Users}
              rotulo="Aparelhos ativos"
              valor={comoNumero(ativosNoPeriodo)}
              dica={`${comoNumero(totais.mediaDeAtivos)} por dia, em média. Pico de ${comoNumero(totais.picoDeAtivos)}.`}
            />
            <CartaoDeNumero
              icone={Download}
              rotulo="Instalações"
              valor={comoNumero(totais.installs)}
              dica={`${comoNumero(totais.sessions)} ${totais.sessions === 1 ? 'abertura' : 'aberturas'} do app no período.`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receita: app x site</CardTitle>
              <CardDescription>
                O pedido entra como “pelo app” quando o carrinho foi montado dentro dele. É o dado
                da própria Shopify, e não uma estimativa por horário.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GraficoDeReceita serie={serie} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Uso do app</CardTitle>
              <CardDescription>
                Aparelhos ativos é quanta gente abriu; aberturas é quantas vezes abriram. A
                distância entre as duas linhas é o quanto voltam no mesmo dia.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GraficoDeUso serie={serie} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notificações</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <CartaoDeNumero
                icone={Bell}
                rotulo="Enviadas"
                valor={comoNumero(totais.pushSent)}
                dica="Campanhas (com o número que já voltou) e automações."
              />
              <CartaoDeNumero
                icone={Bell}
                rotulo="Abertas"
                valor={comoNumero(totais.pushOpened)}
                dica={
                  totais.pushSent === 0
                    ? 'Aparece depois do primeiro envio.'
                    : contaAberturas
                      ? `${comoPorcentagem(totais.pushOpened / totais.pushSent)} de quem recebeu.`
                      : // O app de antes não conta os toques das automações: a taxa sairia baixa demais.
                        'Por enquanto só as das campanhas: as das automações contam a partir da próxima versão do app.'
                }
              />
            </CardContent>
          </Card>
        </>
      )}

      <p className="text-muted-foreground text-xs">
        Os números são recalculados de hora em hora, e o dia fecha à meia-noite no{' '}
        {nomeDoFuso(lojaAtiva.timezone)} —{' '}
        <Link href={`/lojas/${lojaAtiva.id}`} className="underline underline-offset-4">
          o fuso da loja
        </Link>
        . O dia de hoje ainda está sendo contado.
      </p>
    </div>
  );
}

/** `2026-09-15` e `2026-09-21` viram “15/09 a 21/09”. */
function intervalo(de: string, ate: string): string {
  return `${curto(de)} a ${curto(ate)}`;
}

function curto(dia: string): string {
  const [ano, mes, numero] = dia.split('-');
  return ano == null || mes == null || numero == null ? dia : `${numero}/${mes}`;
}
