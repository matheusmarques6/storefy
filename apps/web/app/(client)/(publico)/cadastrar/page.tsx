/** C01 — Cadastro. Cria a conta; o trigger do banco cria a organização. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';
import { BotaoGoogle } from '../botao-google';
import { FormularioCadastro } from './formulario';

export const metadata: Metadata = { title: 'Criar conta' };

export default function PaginaCadastrar() {
  return (
    <div className="space-y-6">
      <FormularioCadastro />
      <BotaoGoogle habilitado={env.googleHabilitado} />
      <p className="text-muted-foreground text-center text-sm">
        Já tem conta?{' '}
        <Link href="/entrar" className="text-foreground font-medium underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </div>
  );
}
