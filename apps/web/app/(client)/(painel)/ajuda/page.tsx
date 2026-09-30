/**
 * C17 — Central de ajuda: os artigos do produto e o contato com o suporte.
 *
 * O contato é um CHAMADO, que mora no banco: a pessoa acompanha a conversa
 * aqui mesmo, e a equipe responde pela tela Chamados do admin. O e-mail, quando
 * configurado, só avisa que há resposta.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen, LifeBuoy, MessageCircle } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { ARTIGOS } from '@/lib/ajuda';
import {
  ASSUNTOS,
  DATA_DA_SITUACAO_PARA_LOJISTA,
  ROTULO_DA_SITUACAO_PARA_LOJISTA,
  ROTULO_DO_ASSUNTO,
} from '@/lib/chamados';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { ehPaginaAlemDoFim, lerParams } from '@/lib/listagem';
import { FormularioDeChamado } from './formulario-chamado';
import { Paginacao } from '@/components/paginacao';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';

export const metadata: Metadata = { title: 'Ajuda' };

export default async function PaginaAjuda({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string; assunto?: string }>;
}) {
  const { organizacao, lojas, lojaAtiva, visita } = await exigirContextoCliente();
  const brutos = await searchParams;
  const { pagina, de, ate } = lerParams({ pagina: brutos.pagina });
  // Quem chega de outra tela (a cobrança, por exemplo) já vem com o assunto.
  const assuntoInicial = ASSUNTOS.find((assunto) => assunto === brutos.assunto) ?? null;
  const supabase = await criarClientServidor();

  const {
    data: chamados,
    count,
    error,
  } = await supabase
    .from('support_tickets')
    .select('id, titulo, assunto, status, updated_at', { count: 'exact' })
    .eq('org_id', organizacao.id)
    .order('updated_at', { ascending: false })
    .range(de, ate);
  if (error != null) {
    // Página depois da última (item apagado, link antigo): volta para a primeira.
    if (ehPaginaAlemDoFim(error)) redirect('/ajuda');
    throw new Error(`Não foi possível carregar os chamados: ${error.message}`);
  }
  const total = count ?? 0;

  const fuso = lojaAtiva?.timezone ?? FUSO_PADRAO;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajuda</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Guias de cada parte do painel e, se precisar, uma conversa com a equipe da Storefy.
        </p>
      </div>

      <section aria-labelledby="titulo-artigos" className="space-y-4">
        <h2 id="titulo-artigos" className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="size-5" aria-hidden />
          Guias
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ARTIGOS.map((artigo) => (
            <Link
              key={artigo.slug}
              href={`/ajuda/${artigo.slug}`}
              className="hover:bg-accent/40 rounded-2xl border p-4 transition-colors"
            >
              <p className="font-medium">{artigo.titulo}</p>
              <p className="text-muted-foreground mt-1 text-sm">{artigo.resumo}</p>
            </Link>
          ))}
        </div>
      </section>

      {visita == null ? (
        <Card id="falar-com-o-suporte" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="size-5" aria-hidden />
              Falar com o suporte
            </CardTitle>
            <CardDescription>
              Abra um chamado e acompanhe a conversa aqui. Respondemos em dias úteis, e você é
              avisado por e-mail quando houver resposta (dá para desligar em Configurações ›
              Empresa).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioDeChamado
              lojas={lojas.map((loja) => ({ id: loja.id, name: loja.name }))}
              lojaAtiva={lojaAtiva?.id ?? null}
              assuntoInicial={assuntoInicial}
            />
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="titulo-chamados" className="space-y-4">
        <h2 id="titulo-chamados" className="flex items-center gap-2 text-lg font-semibold">
          <MessageCircle className="size-5" aria-hidden />
          Chamados da empresa
        </h2>
        {total === 0 ? (
          <EstadoVazio
            icone={MessageCircle}
            titulo="Nenhum chamado ainda"
            descricao="Quando alguém da empresa abrir um chamado, a conversa aparece aqui para toda a equipe acompanhar."
            className="py-10"
          />
        ) : chamados.length === 0 ? (
          // Uma página além da última, por link antigo ou digitada na mão.
          <EstadoVazio
            icone={MessageCircle}
            titulo="Nada nesta página"
            descricao="A lista de chamados é menor do que isso."
            acao={
              <Link href="/ajuda" className="text-sm underline underline-offset-4">
                Ver os mais recentes
              </Link>
            }
            className="py-10"
          />
        ) : (
          <ul className="divide-y rounded-2xl border">
            {chamados.map((chamado) => (
              <li key={chamado.id}>
                <Link
                  href={`/ajuda/chamados/${chamado.id}`}
                  className="hover:bg-accent/40 flex flex-col items-start gap-1 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">{chamado.titulo}</p>
                    <p className="text-muted-foreground text-xs">
                      {ROTULO_DO_ASSUNTO[chamado.assunto]} ·{' '}
                      {DATA_DA_SITUACAO_PARA_LOJISTA[chamado.status]}{' '}
                      {formatarDataHora(chamado.updated_at, fuso)}
                    </p>
                  </div>
                  <Badge variant={chamado.status === 'respondido' ? 'default' : 'outline'}>
                    {ROTULO_DA_SITUACAO_PARA_LOJISTA[chamado.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Paginacao pagina={pagina} total={total} base="/ajuda" busca="" />
      </section>
    </div>
  );
}
