/**
 * C05 — Dashboard.
 *
 * Mostra apenas dados reais do banco. Enquanto não houver loja, aparece o
 * estado vazio guiando à criação da primeira — nunca métricas de exemplo
 * (regra 1 das inegociáveis). Instalações, ativos e receita entram na Fase 5,
 * quando `analytics_daily` existir.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Rocket, Store as IconeLoja } from 'lucide-react';
import { ROTULO_STATUS_LOJA, podeEscrever, type StoreStatus } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

export const metadata: Metadata = { title: 'Início' };

const VARIANTE_POR_STATUS: Record<StoreStatus, 'secondary' | 'warning' | 'success'> = {
  draft: 'secondary',
  building: 'warning',
  in_review: 'warning',
  live: 'success',
  paused: 'secondary',
};

export default async function PaginaInicio() {
  const { lojas, organizacao, papel } = await exigirContextoCliente();
  const podeCriar = podeEscrever(papel);

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

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <IconeLoja className="text-muted-foreground size-4" aria-hidden />
            <CardTitle className="text-base">Próximos passos</CardTitle>
          </div>
          <CardDescription>
            O editor do app, os disparos de push e a publicação chegam nas próximas etapas do
            produto. Por enquanto, deixe suas lojas cadastradas e conferidas.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
