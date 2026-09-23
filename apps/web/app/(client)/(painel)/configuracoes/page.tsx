/** C16 — Configurações da organização. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ROTULO_PAPEL, ROTULO_STATUS_ORG, podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { FormularioOrganizacao } from './formularios';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Configurações' };

export default async function PaginaConfiguracoes() {
  const { organizacao, papel, lojas } = await exigirContextoCliente();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Dados da empresa. Para alterar seus dados pessoais, vá em{' '}
          <Link href="/configuracoes/conta" className="underline underline-offset-4">
            Minha conta
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Empresa</CardTitle>
          <CardDescription>O nome aparece no painel e nos e-mails que enviamos.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioOrganizacao
            nomeInicial={organizacao.name}
            somenteLeitura={!podeEscrever(papel)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Seu papel</dt>
              <dd className="mt-1">
                <Badge variant="outline">{ROTULO_PAPEL[papel]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Situação</dt>
              <dd className="mt-1">
                <Badge variant="secondary">{ROTULO_STATUS_ORG[organizacao.status]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Identificador</dt>
              <dd className="mt-1 font-mono text-xs">{organizacao.slug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lojas cadastradas</dt>
              <dd className="mt-1 font-medium">{lojas.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Criada em</dt>
              <dd className="mt-1">
                {new Date(organizacao.created_at).toLocaleDateString('pt-BR')}
              </dd>
            </div>
            {organizacao.trial_ends_at == null ? null : (
              <div>
                <dt className="text-muted-foreground">Teste até</dt>
                <dd className="mt-1">
                  {new Date(organizacao.trial_ends_at).toLocaleDateString('pt-BR')}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
