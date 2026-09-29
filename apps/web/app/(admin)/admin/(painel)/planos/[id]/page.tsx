/** A09 — um plano: editar, tirar da vitrine ou excluir (se nunca foi assinado). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { descreverLimite, formatarPreco } from '@/lib/cobranca';
import { salvarPlano } from '../acoes';
import { FormularioDoPlano } from '../formulario-plano';
import { ExcluirPlano } from './excluir-plano';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Plano · Admin' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O preço como se digita no formulário: "99,90". */
function precoNoCampo(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

export default async function PaginaPlano({ params }: { params: Promise<{ id: string }> }) {
  const { papel } = await exigirPlatformAdminComPapel();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await criarClientServidor();
  const [{ data: plano }, assinaturas] = await Promise.all([
    supabase
      .from('plans')
      .select(
        'id, nome, descricao, preco_centavos, limite_lojas, limite_aparelhos, limite_campanhas_mes, disponivel, vale_no_teste',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('org_id', { count: 'exact', head: true })
      .eq('plan_id', id),
  ]);
  if (plano == null) notFound();
  if (assinaturas.error != null) {
    throw new Error(`Não foi possível contar as assinaturas: ${assinaturas.error.message}`);
  }
  const jaAssinado = (assinaturas.count ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/admin/planos"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para os planos
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{plano.nome}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {formatarPreco(plano.preco_centavos)}/mês ·{' '}
          {descreverLimite(plano.limite_lojas, 'loja', 'lojas', 'lojas sem limite')} ·{' '}
          {jaAssinado
            ? `${String(assinaturas.count)} ${assinaturas.count === 1 ? 'empresa assinou' : 'empresas assinaram'}`
            : 'ninguém assinou ainda'}
        </p>
      </div>

      {papel !== 'superadmin' ? (
        <p className="text-muted-foreground text-sm">Só superadmin muda planos.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editar</CardTitle>
              <CardDescription>
                O preço novo vale para quem assinar depois; quem já assina continua no valor
                contratado. Limites mudam na hora para todos neste plano.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormularioDoPlano
                acao={salvarPlano.bind(null, plano.id)}
                botao="Salvar plano"
                inicial={{
                  nome: plano.nome,
                  descricao: plano.descricao,
                  preco: precoNoCampo(plano.preco_centavos),
                  limiteLojas: plano.limite_lojas === null ? '' : String(plano.limite_lojas),
                  limiteAparelhos:
                    plano.limite_aparelhos === null ? '' : String(plano.limite_aparelhos),
                  limiteCampanhas:
                    plano.limite_campanhas_mes === null ? '' : String(plano.limite_campanhas_mes),
                  disponivel: plano.disponivel,
                  valeNoTeste: plano.vale_no_teste,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Excluir</CardTitle>
              <CardDescription>
                {jaAssinado
                  ? 'Plano já assinado não se exclui: o histórico das empresas aponta para ele. Para tirar da vitrine, desmarque "Disponível para assinar".'
                  : 'Some da vitrine e da lista. Como ninguém assinou, nada mais muda.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExcluirPlano planoId={plano.id} nome={plano.nome} bloqueado={jaAssinado} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
