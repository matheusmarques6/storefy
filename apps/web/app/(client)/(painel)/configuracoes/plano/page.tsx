/**
 * C15 — Plano e cobrança: a situação da assinatura, o uso do mês contra os
 * limites, os planos, as faturas e quem paga.
 *
 * Tudo o que decide "em dia" vem do banco (`situacao_da_cobranca`): a tela
 * não recalcula regra nenhuma, só diz o que ele respondeu — com as datas.
 *
 * Quem vê o quê: todo mundo da empresa vê a situação, o uso e os planos;
 * faturas e dados de quem paga são do proprietário e dos administradores (a
 * RLS entrega assim); e só o proprietário assina, troca e cancela.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CreditCard, ExternalLink, Receipt } from 'lucide-react';
import { ROTULO_STATUS_ASSINATURA, ROTULO_STATUS_FATURA, type InvoiceStatus } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { cobrancaConfigurada } from '@/lib/asaas';
import { descreverDocumento, diasEntre, formatarDia, formatarPreco } from '@/lib/cobranca';
import {
  lerAparelhosPorLoja,
  lerSituacaoDaCobranca,
  lerUsoDaEmpresa,
  type SituacaoDaCobranca,
} from '@/lib/cobranca-servidor';
import { NavegacaoConfiguracoes } from '../navegacao-configuracoes';
import { EscolherPlano } from './escolher-plano';
import { CancelarAssinatura } from './cancelar-assinatura';
import { AlterarQuemPaga } from './quem-paga';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Plano e cobrança' };

const COR_DA_FATURA: Record<InvoiceStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  paid: 'secondary',
  overdue: 'destructive',
  refunded: 'outline',
  canceled: 'outline',
};

export default async function PaginaPlano() {
  const { organizacao, papel, visita } = await exigirContextoCliente();
  const supabase = await criarClientServidor();

  const [situacao, uso, porLoja, planos, faturas, quemPaga] = await Promise.all([
    lerSituacaoDaCobranca(supabase, organizacao.id),
    lerUsoDaEmpresa(supabase, organizacao.id),
    lerAparelhosPorLoja(supabase, organizacao.id),
    supabase
      .from('plans')
      .select(
        'id, nome, descricao, preco_centavos, limite_lojas, limite_aparelhos, limite_campanhas_mes, disponivel',
      )
      .order('preco_centavos'),
    supabase
      .from('invoices')
      .select('id, valor_centavos, status, vencimento, paga_em, link')
      .eq('org_id', organizacao.id)
      .order('vencimento', { ascending: false })
      .limit(24),
    supabase
      .from('billing_customers')
      .select('nome, documento_tipo, documento_final, email')
      .eq('org_id', organizacao.id)
      .maybeSingle(),
  ]);
  if (planos.error != null) {
    throw new Error(`Não foi possível carregar os planos: ${planos.error.message}`);
  }
  if (faturas.error != null) {
    throw new Error(`Não foi possível carregar as faturas: ${faturas.error.message}`);
  }

  const assinaturaViva = situacao.assinatura !== null && situacao.canceladaEm === null;
  const podeMexer = papel === 'owner' && visita == null;
  const veCobranca = papel === 'owner' || papel === 'admin' || visita != null;
  const cobrancaLigada = cobrancaConfigurada();
  // Na vitrine: o que está à venda, mais o plano de quem já assina.
  const vitrine = planos.data.filter((plano) => plano.disponivel || plano.id === situacao.planoId);
  const aberta = faturas.data
    .filter((fatura) => fatura.status === 'pending' || fatura.status === 'overdue')
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <NavegacaoConfiguracoes atual="plano" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plano e cobrança</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          O plano de {organizacao.name}, quanto dele está em uso e as faturas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-5" aria-hidden />
            Situação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DescricaoDaSituacao situacao={situacao} />

          {situacao.emDia ? null : (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertDescription>
                Envio de campanhas, publicação de mudanças no app, versões novas para as lojas de
                aplicativos e lojas novas estão parados. O app continua funcionando para os seus
                clientes.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {aberta?.link == null || !veCobranca ? null : (
              <Button asChild>
                <a href={aberta.link} target="_blank" rel="noopener noreferrer">
                  Pagar a fatura de {formatarPreco(aberta.valor_centavos)}
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            )}
            {assinaturaViva && podeMexer ? (
              <CancelarAssinatura
                liberadoAte={situacao.pagoAte === null ? null : formatarDia(situacao.pagoAte)}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uso</CardTitle>
          <CardDescription>
            {situacao.limitesDoTeste
              ? 'Durante o teste valem estes limites.'
              : 'Contado agora, contra os limites do plano.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Medidor rotulo="Lojas" usado={uso.lojas} limite={situacao.limiteLojas} />
          <Medidor
            rotulo="Aparelhos ativos nos últimos 30 dias"
            usado={uso.aparelhos30d}
            limite={situacao.limiteAparelhos}
            passou="Passou do limite do plano. O app continua funcionando; vale mudar de plano."
          />
          {porLoja.length > 1 ? (
            <ul className="text-muted-foreground -mt-2 space-y-0.5 pl-3 text-xs">
              {porLoja.map((loja) => (
                <li key={loja.lojaId} className="flex justify-between gap-2">
                  <span className="truncate">{loja.nome}</span>
                  <span className="tabular-nums">{loja.aparelhos30d.toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Medidor
            rotulo="Campanhas neste mês"
            usado={uso.campanhasNoMes}
            limite={situacao.limiteCampanhasMes}
          />
        </CardContent>
      </Card>

      <section aria-labelledby="titulo-planos" className="space-y-4">
        <div>
          <h2 id="titulo-planos" className="text-lg font-semibold">
            Planos
          </h2>
          <p className="text-muted-foreground text-sm">
            {podeMexer
              ? 'A cobrança é mensal. A fatura tem Pix, boleto e cartão.'
              : 'Só o proprietário da empresa assina ou troca de plano.'}
          </p>
        </div>

        {podeMexer && !cobrancaLigada ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden />
            <AlertDescription>
              A assinatura pelo painel ainda não está ligada. Para assinar agora,{' '}
              <Link href="/ajuda?assunto=cobranca#falar-com-o-suporte" className="underline">
                fale com a equipe da Storefy
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        {vitrine.length === 0 ? (
          <EstadoVazio
            icone={CreditCard}
            titulo="Os planos ainda não foram publicados"
            descricao={`A equipe da Storefy ainda está preparando os planos. O seu teste continua valendo até ${formatarDia(situacao.testeAte)}.`}
          />
        ) : (
          <EscolherPlano
            planos={vitrine.map((plano) => ({
              id: plano.id,
              nome: plano.nome,
              descricao: plano.descricao,
              precoCentavos: plano.preco_centavos,
              limiteLojas: plano.limite_lojas,
              limiteAparelhos: plano.limite_aparelhos,
              limiteCampanhasMes: plano.limite_campanhas_mes,
              disponivel: plano.disponivel,
            }))}
            planoAtual={assinaturaViva ? situacao.planoId : null}
            assinaturaViva={assinaturaViva}
            podeMexer={podeMexer}
            cobrancaLigada={cobrancaLigada}
            quemPaga={
              quemPaga.data == null
                ? null
                : { nome: quemPaga.data.nome, email: quemPaga.data.email }
            }
          />
        )}
      </section>

      {veCobranca ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-5" aria-hidden />
                Faturas
              </CardTitle>
            </CardHeader>
            <CardContent>
              {faturas.data.length === 0 ? (
                <EstadoVazio
                  icone={Receipt}
                  titulo="Nenhuma fatura ainda"
                  descricao="As faturas aparecem aqui quando a empresa assina um plano."
                  className="py-8"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faturas.data.map((fatura) => (
                      <TableRow key={fatura.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatarDia(fatura.vencimento)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatarPreco(fatura.valor_centavos)}
                        </TableCell>
                        {/* O link mora na mesma célula: numa quarta coluna, ele saía
                            da tela do celular — justo o botão de pagar. */}
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <Badge variant={COR_DA_FATURA[fatura.status]}>
                              {ROTULO_STATUS_FATURA[fatura.status]}
                            </Badge>
                            {fatura.paga_em === null ? null : (
                              <span className="text-muted-foreground text-xs whitespace-nowrap">
                                em {formatarDia(fatura.paga_em)}
                              </span>
                            )}
                            {fatura.link === null ? null : (
                              <a
                                href={fatura.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                              >
                                {fatura.status === 'pending' || fatura.status === 'overdue'
                                  ? 'Pagar'
                                  : 'Ver'}
                                <ExternalLink className="size-3.5" aria-hidden />
                              </a>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quem paga</CardTitle>
              <CardDescription>
                Os dados da fatura. A Asaas, que cuida da cobrança, manda a fatura para este e-mail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {quemPaga.data == null ? (
                <p className="text-muted-foreground text-sm">
                  Os dados de cobrança são pedidos quando a empresa assina um plano.
                </p>
              ) : (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Nome</dt>
                      <dd className="font-medium break-words">{quemPaga.data.nome}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Documento</dt>
                      <dd className="font-medium">
                        {descreverDocumento(
                          quemPaga.data.documento_tipo,
                          quemPaga.data.documento_final,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">E-mail</dt>
                      <dd className="font-medium break-all">{quemPaga.data.email}</dd>
                    </div>
                  </dl>
                  {podeMexer && cobrancaLigada ? (
                    <AlterarQuemPaga nome={quemPaga.data.nome} email={quemPaga.data.email} />
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Faturas e dados de cobrança ficam com o proprietário e os administradores da empresa.
        </p>
      )}
    </div>
  );
}

/** A situação em uma frase, com as datas que importam. */
function DescricaoDaSituacao({ situacao }: { situacao: SituacaoDaCobranca }) {
  const valor =
    situacao.valorCentavos === null ? '' : ` · ${formatarPreco(situacao.valorCentavos)} por mês`;

  if (situacao.assinatura === null) {
    const dias = diasEntre(situacao.hoje, situacao.testeAte);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">Teste grátis</p>
          <Badge variant={dias >= 0 ? 'secondary' : 'destructive'}>
            {dias > 1
              ? `Faltam ${String(dias)} dias`
              : dias === 1
                ? 'Acaba amanhã'
                : dias === 0
                  ? 'Acaba hoje'
                  : 'Acabou'}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {dias >= 0
            ? `Tudo liberado até ${formatarDia(situacao.testeAte)}. Assine um plano antes disso para nada parar.`
            : `O teste acabou em ${formatarDia(situacao.testeAte)}. Assine um plano para voltar a usar tudo.`}
        </p>
      </div>
    );
  }

  const linhas: string[] = [];
  if (situacao.assinatura === 'pending' && situacao.liberadoAte !== null) {
    linhas.push(
      `Pague a primeira fatura até ${formatarDia(situacao.liberadoAte)} para nada parar.`,
    );
  }
  if (situacao.assinatura === 'active' && situacao.pagoAte !== null) {
    linhas.push(`Pago até ${formatarDia(situacao.pagoAte)}.`);
  }
  if (situacao.assinatura === 'past_due' && situacao.inadimplenteDesde !== null) {
    linhas.push(
      situacao.emDia && situacao.liberadoAte !== null
        ? `A fatura de ${formatarDia(situacao.inadimplenteDesde)} está em atraso. Pague até ${formatarDia(situacao.liberadoAte)} para nada parar.`
        : `A fatura de ${formatarDia(situacao.inadimplenteDesde)} está em atraso.`,
    );
  }
  if (situacao.assinatura === 'canceled') {
    linhas.push(
      situacao.emDia && situacao.liberadoAte !== null
        ? `Cancelada. O que já foi pago vale até ${formatarDia(situacao.liberadoAte)}.`
        : 'Cancelada. Assine de novo para voltar a usar tudo.',
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          Plano {situacao.planoNome}
          {valor}
        </p>
        <Badge
          variant={
            situacao.assinatura === 'active'
              ? 'secondary'
              : situacao.assinatura === 'past_due'
                ? 'destructive'
                : 'outline'
          }
        >
          {ROTULO_STATUS_ASSINATURA[situacao.assinatura]}
        </Badge>
      </div>
      {linhas.map((linha) => (
        <p key={linha} className="text-muted-foreground text-sm">
          {linha}
        </p>
      ))}
    </div>
  );
}

/** Uma barra de uso contra o limite; sem limite, só o número. */
function Medidor({
  rotulo,
  usado,
  limite,
  passou,
}: {
  rotulo: string;
  usado: number;
  limite: number | null;
  passou?: string;
}) {
  const acima = limite !== null && usado > limite;
  const fracao = limite === null || limite === 0 ? 0 : Math.min(usado / limite, 1);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{rotulo}</span>
        <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">
          {usado.toLocaleString('pt-BR')}
          {limite === null ? (
            <span className="text-muted-foreground font-normal"> · sem limite</span>
          ) : (
            <span className="text-muted-foreground font-normal">
              {' '}
              de {limite.toLocaleString('pt-BR')}
            </span>
          )}
        </span>
      </div>
      {limite === null ? null : (
        <div
          className="bg-muted h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-label={rotulo}
          aria-valuemin={0}
          aria-valuemax={limite}
          aria-valuenow={Math.min(usado, limite)}
        >
          <div
            className={acima ? 'bg-destructive h-full' : 'bg-primary h-full'}
            style={{ width: `${String(Math.round(fracao * 100))}%` }}
          />
        </div>
      )}
      {acima && passou !== undefined ? (
        <p className="text-destructive text-xs font-medium">{passou}</p>
      ) : null}
    </div>
  );
}
