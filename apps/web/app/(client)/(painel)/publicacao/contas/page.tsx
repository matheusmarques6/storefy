/** Conectar Apple e Google (C13). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { contasDaOrganizacao } from '@/lib/contas-de-desenvolvedor';
import { CartaoDaApple } from './cartao-apple';
import { CartaoDoGoogle } from './cartao-google';

export const metadata: Metadata = { title: 'Contas Apple e Google' };

export default async function PaginaDeContas() {
  const { organizacao, papel } = await exigirContextoCliente();
  const supabase = await criarClientServidor();
  const contas = await contasDaOrganizacao(supabase, organizacao.id);
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/publicacao"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Publicação
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Contas Apple e Google</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          O seu app é publicado nas contas da <strong>sua empresa</strong>, e não nas da Storefy. É
          exigência da Apple para apps feitos a partir de um modelo — e é melhor assim: o app é seu,
          com as avaliações e o histórico no seu nome.
        </p>
      </div>

      <div className="grid gap-6">
        <CartaoDaApple conta={contas.apple} podeEscrever={podeEscrever} />
        <CartaoDoGoogle conta={contas.google} podeEscrever={podeEscrever} />
      </div>
    </div>
  );
}
