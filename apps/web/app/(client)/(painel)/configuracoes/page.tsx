/** C16 — Configurações da organização. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ROTULO_PAPEL, ROTULO_STATUS_ORG, podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { FormularioOrganizacao } from './formularios';
import { FormularioDeAvisos } from './avisos';
import { criarClientServidor } from '@/lib/supabase/server';
import { NavegacaoConfiguracoes } from './navegacao-configuracoes';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Configurações' };

export default async function PaginaConfiguracoes() {
  const { organizacao, papel, lojas, usuario, visita } = await exigirContextoCliente();
  const supabase = await criarClientServidor();
  const { data: avisos } = await supabase
    .from('email_preferences')
    .select('revisao_do_app, resposta_do_suporte')
    .eq('org_id', organizacao.id)
    .eq('user_id', usuario.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <NavegacaoConfiguracoes atual="empresa" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Os dados da empresa. Quem mais mexe no painel fica em{' '}
          <Link href="/configuracoes/equipe" className="underline underline-offset-4">
            Equipe
          </Link>
          , e seus dados pessoais em{' '}
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

      {visita == null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seus avisos por e-mail</CardTitle>
            <CardDescription>
              Só para você, nesta empresa. Convites e avisos de segurança chegam sempre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioDeAvisos
              revisaoDoApp={avisos?.revisao_do_app ?? true}
              respostaDoSuporte={avisos?.resposta_do_suporte ?? true}
              recebeRevisao={podeEscrever(papel)}
            />
          </CardContent>
        </Card>
      ) : null}

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
              <dd className="mt-1">{formatarData(organizacao.created_at, FUSO_PADRAO)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teste até</dt>
              <dd className="mt-1">
                {formatarData(organizacao.trial_ends_at, FUSO_PADRAO)} ·{' '}
                <Link href="/configuracoes/plano" className="underline underline-offset-4">
                  Plano e cobrança
                </Link>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
