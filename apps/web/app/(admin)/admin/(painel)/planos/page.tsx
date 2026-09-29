/**
 * A09 — Planos e preços: o que o lojista vê na C15 para assinar, e os
 * limites de cada plano.
 *
 * Nenhum plano nasce sozinho (preço é decisão de negócio): enquanto esta
 * lista estiver vazia, o lojista vê que os planos ainda não foram publicados.
 * Aqui também fica o que a cobrança precisa para funcionar — a chave da Asaas
 * e o endereço do aviso —, com o último aviso recebido para conferir.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { cobrancaConfigurada, tokenDoWebhook } from '@/lib/asaas';
import { descreverLimite, formatarPreco } from '@/lib/cobranca';
import { urlDoSite } from '@/lib/env';
import { FUSO_PADRAO, formatarDataHora } from '@/lib/fuso';
import { criarPlano } from './acoes';
import { FormularioDoPlano } from './formulario-plano';
import { LinhaCopiavel } from '@/components/linha-copiavel';
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

export const metadata: Metadata = { title: 'Planos e preços · Admin' };

export default async function PaginaPlanos() {
  const { papel } = await exigirPlatformAdminComPapel();
  const supabase = await criarClientServidor();

  const [planos, assinaturas, ultimoAviso] = await Promise.all([
    supabase
      .from('plans')
      .select(
        'id, nome, descricao, preco_centavos, limite_lojas, limite_aparelhos, limite_campanhas_mes, disponivel, vale_no_teste',
      )
      .order('preco_centavos'),
    supabase.from('subscriptions').select('plan_id').is('cancelada_em', null),
    supabase
      .from('billing_events')
      .select('tipo, resultado, recebido_em')
      .order('recebido_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (planos.error != null)
    throw new Error(`Não foi possível carregar os planos: ${planos.error.message}`);
  if (assinaturas.error != null) {
    throw new Error(`Não foi possível contar as assinaturas: ${assinaturas.error.message}`);
  }

  const assinantes = new Map<string, number>();
  for (const assinatura of assinaturas.data) {
    assinantes.set(assinatura.plan_id, (assinantes.get(assinatura.plan_id) ?? 0) + 1);
  }
  const superadmin = papel === 'superadmin';
  const asaasLigada = cobrancaConfigurada();
  const avisoLigado = tokenDoWebhook() !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Planos e preços</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          O que o lojista vê em Configurações › Plano e cobrança. Mudar o preço vale para quem
          assinar depois; quem já assina continua no valor contratado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cobrança pela Asaas</CardTitle>
          <CardDescription>
            A assinatura é mensal, com Pix, boleto e cartão na fatura da Asaas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Chave da API:{' '}
            <Badge variant={asaasLigada ? 'secondary' : 'destructive'}>
              {asaasLigada ? 'Configurada' : 'Faltando (ASAAS_API_KEY)'}
            </Badge>{' '}
            Aviso de pagamento:{' '}
            <Badge variant={avisoLigado ? 'secondary' : 'destructive'}>
              {avisoLigado ? 'Configurado' : 'Faltando (ASAAS_WEBHOOK_TOKEN)'}
            </Badge>
          </p>
          <div className="space-y-1">
            <p className="text-muted-foreground">
              Na Asaas, em Integrações › Webhooks, cadastre este endereço com o mesmo token de
              ASAAS_WEBHOOK_TOKEN e os eventos de cobranças e de assinaturas:
            </p>
            <LinhaCopiavel valor={`${urlDoSite()}/api/webhooks/asaas`} monoespacado />
          </div>
          <p className="text-muted-foreground">
            {ultimoAviso.data == null
              ? 'Nenhum aviso da Asaas recebido ainda.'
              : `Último aviso recebido: ${ultimoAviso.data.tipo}, em ${formatarDataHora(ultimoAviso.data.recebido_em, FUSO_PADRAO)} (${ultimoAviso.data.resultado}).`}
          </p>
        </CardContent>
      </Card>

      {planos.data.length === 0 ? (
        <EstadoVazio
          icone={CreditCard}
          titulo="Nenhum plano ainda"
          descricao="Enquanto não houver planos, o lojista vê que eles ainda não foram publicados, e o teste grátis segue valendo."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead>Limites</TableHead>
                <TableHead>Assinantes</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planos.data.map((plano) => (
                <TableRow key={plano.id}>
                  <TableCell className="font-medium">
                    {plano.nome}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {plano.disponivel ? null : <Badge variant="outline">Fora da vitrine</Badge>}
                      {plano.vale_no_teste ? (
                        <Badge variant="secondary">Vale no teste</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatarPreco(plano.preco_centavos)}/mês
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {descreverLimite(plano.limite_lojas, 'loja', 'lojas', 'Lojas sem limite')} ·{' '}
                    {descreverLimite(
                      plano.limite_aparelhos,
                      'aparelho',
                      'aparelhos',
                      'aparelhos sem limite',
                    )}{' '}
                    ·{' '}
                    {descreverLimite(
                      plano.limite_campanhas_mes,
                      'campanha/mês',
                      'campanhas/mês',
                      'campanhas sem limite',
                    )}
                  </TableCell>
                  <TableCell>{assinantes.get(plano.id) ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/planos/${plano.id}`}>
                        {superadmin ? 'Editar' : 'Detalhes'}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {superadmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Novo plano</CardTitle>
            <CardDescription>
              Aparece na hora para os lojistas, se estiver disponível.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioDoPlano
              acao={criarPlano}
              botao="Criar plano"
              inicial={{
                nome: '',
                descricao: '',
                preco: '',
                limiteLojas: '',
                limiteAparelhos: '',
                limiteCampanhas: '',
                disponivel: true,
                valeNoTeste: false,
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-sm">Só superadmin cria e muda planos.</p>
      )}
    </div>
  );
}
