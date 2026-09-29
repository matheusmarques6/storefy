/** C01 — Cadastro. Cria a conta; o trigger do banco cria a organização. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { DoorClosed } from 'lucide-react';
import { env } from '@/lib/env';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BotaoGoogle } from '../botao-google';
import { FormularioCadastro } from './formulario';

export const metadata: Metadata = { title: 'Criar conta' };

export default async function PaginaCadastrar() {
  /*
   * A Storefy pode fechar o cadastro (A13) — na fase das lojas piloto, ela
   * escolhe quem entra. A tela diz isso em vez de mostrar um formulário que
   * o servidor recusaria depois de a pessoa preencher tudo.
   */
  const { cadastroAberto } = await configuracoesDaPlataforma();

  if (!cadastroAberto) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DoorClosed className="size-5" aria-hidden />
              Cadastros fechados por enquanto
            </CardTitle>
            <CardDescription>
              A Storefy está recebendo um grupo pequeno de lojas agora. Se você recebeu um convite,
              entre com o e-mail do convite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/entrar">Entrar</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
