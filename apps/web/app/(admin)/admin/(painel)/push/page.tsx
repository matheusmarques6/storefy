/**
 * A08 — Push de todas as lojas.
 *
 * DUAS PERGUNTAS, NA ORDEM EM QUE DOEM. A primeira é o que está quebrado: um
 * app que manda muito e entrega pouco está com credencial ruim, e o cliente
 * não sabe. A segunda é quanto vai custar: a OneSignal cobra por aparelho
 * ativo no mês, então a lista é ordenada por ativos — a primeira linha é a que
 * explica a fatura.
 *
 * O CUSTO EM REAIS NÃO APARECE, e a tela diz por quê. Converter aparelho ativo
 * em dinheiro exige a tabela de preços do plano contratado, que só existe na
 * Fase 7. Um valor estimado numa tela de custo é exatamente o tipo de número
 * que ninguém confere porque já parece plausível.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, CreditCard, TriangleAlert } from 'lucide-react';
import { criarClientServidor } from '@/lib/supabase/server';
import { PERIODOS, lerLinha, lerPeriodo, totais } from '@/lib/push-admin';
import { numeroOuTraco, porcentagemOuTraco } from '@/lib/campanha';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Push · Admin' };

export default async function PaginaPushGlobal({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const dias = lerPeriodo((await searchParams).dias);
  const supabase = await criarClientServidor();

  const { data, error } = await supabase.rpc('push_do_admin', { p_dias: dias });
  if (error != null) {
    throw new Error(`Não foi possível carregar o push global: ${error.message}`);
  }

  const linhas = data.map(lerLinha);
  const soma = totais(linhas);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Push</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Envios, falhas e aparelhos ativos de todas as lojas.
        </p>
      </div>

      <nav aria-label="Período" className="flex flex-wrap gap-1">
        {PERIODOS.map((opcao) => (
          <Link
            key={opcao}
            href={`/admin/push?dias=${String(opcao)}`}
            aria-current={opcao === dias ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              opcao === dias
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {opcao} dias
          </Link>
        ))}
      </nav>

      {linhas.length === 0 ? (
        <EstadoVazio
          icone={BellRing}
          titulo="Nenhum app ainda"
          descricao="Os números de push aparecem aqui assim que a primeira loja publicar um app."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Resumo
              rotulo="Aparelhos ativos"
              valor={soma.ativos}
              ajuda="É o que a OneSignal cobra."
            />
            <Resumo rotulo="Enviados" valor={soma.enviados} ajuda="Campanhas e automações." />
            <Resumo rotulo="Falhas" valor={soma.falhas} ajuda="Não chegaram ao aparelho." />
            <Resumo
              rotulo="Apps com problema"
              valor={soma.preocupantes}
              ajuda="Falham acima do normal, com volume que justifica olhar."
              atencao={soma.preocupantes > 0}
            />
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead className="text-right">Ativos</TableHead>
                  <TableHead className="text-right">Enviados</TableHead>
                  <TableHead className="text-right">Falhas</TableHead>
                  <TableHead className="text-right">Aberturas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((linha) => (
                  <TableRow key={linha.appId}>
                    <TableCell>
                      <span className="font-medium">{linha.loja}</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {linha.organizacao}
                      </span>
                      {linha.preocupante ? (
                        <span className="text-destructive mt-1 flex items-start gap-1 text-xs">
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                          {porcentagemOuTraco(linha.taxaDeFalha)} das tentativas falham. Vale
                          conferir a credencial de push desta loja.
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {linha.ativos.toLocaleString('pt-BR')}
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        de {linha.aparelhos.toLocaleString('pt-BR')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {linha.enviados.toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {linha.falhas === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <Badge variant={linha.preocupante ? 'destructive' : 'secondary'}>
                          {linha.falhas.toLocaleString('pt-BR')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {porcentagemOuTraco(linha.taxaDeAbertura)}
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {numeroOuTraco(linha.entregues)} entregues
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/*
       * O estado de "não configurado" que a regra 1 exige. Sem ele, alguém
       * procuraria o valor da fatura nesta tela achando que ele existe em
       * algum canto — e a alternativa, um número estimado, seria pior.
       */}
      <Card>
        <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
          <CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            O custo em reais ainda não aparece aqui: converter aparelho ativo em dinheiro depende da
            tabela de preços do plano contratado, que entra na Fase 7. Por ora o número que importa
            é o de aparelhos ativos — é sobre ele que a OneSignal cobra.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function Resumo({
  rotulo,
  valor,
  ajuda,
  atencao = false,
}: {
  rotulo: string;
  valor: number;
  ajuda: string;
  atencao?: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          {atencao ? (
            <TriangleAlert className="text-destructive size-4 shrink-0" aria-hidden />
          ) : null}
          {rotulo}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{valor.toLocaleString('pt-BR')}</p>
        <p className="text-muted-foreground mt-1 text-xs">{ajuda}</p>
      </CardContent>
    </Card>
  );
}
