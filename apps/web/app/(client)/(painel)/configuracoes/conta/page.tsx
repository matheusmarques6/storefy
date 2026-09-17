/** Configurações da conta do usuário: nome, e-mail e senha. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { FormularioEmail, FormularioNome, FormularioSenha } from '../formularios';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Minha conta' };

export default async function PaginaConta() {
  const { usuario } = await exigirContextoCliente();
  const metadados = usuario.user_metadata as { full_name?: unknown };
  const nome = typeof metadados.full_name === 'string' ? metadados.full_name : '';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/configuracoes"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para configurações
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Minha conta</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Seus dados de acesso. Eles valem para todas as empresas em que você participa.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nome</CardTitle>
          <CardDescription>Como você aparece para o resto da equipe.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioNome nomeInicial={nome} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">E-mail</CardTitle>
          <CardDescription>É com ele que você entra no painel.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioEmail emailAtual={usuario.email ?? ''} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Senha</CardTitle>
          <CardDescription>Pedimos a senha atual antes de trocar, por segurança.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioSenha />
        </CardContent>
      </Card>
    </div>
  );
}
