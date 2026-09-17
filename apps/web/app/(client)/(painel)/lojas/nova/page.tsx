/** Criar loja. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarLoja } from '../acoes';
import { FormularioLoja } from '../formulario-loja';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Nova loja' };

export default async function PaginaNovaLoja() {
  const { papel } = await exigirContextoCliente();
  // Quem não pode criar não deve nem ver o formulário.
  if (!podeEscrever(papel)) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        href="/lojas"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para lojas
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Nova loja</CardTitle>
          <CardDescription>
            Informe o nome e o endereço. Você ajusta o resto depois, no editor do app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioLoja acao={criarLoja} rotuloEnvio="Criar loja" carregando="Criando..." />
        </CardContent>
      </Card>
    </div>
  );
}
