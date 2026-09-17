/** C01 — Aviso pós-cadastro: confirme o e-mail para entrar. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Confirme seu e-mail' };

export default async function PaginaConfirmarEmail({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirme seu e-mail</CardTitle>
        <CardDescription>Falta só um passo para começar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="info">
          <MailCheck aria-hidden />
          <AlertDescription>
            {email == null || email === '' ? (
              <>Enviamos um link de confirmação para o seu e-mail.</>
            ) : (
              <>
                Enviamos um link de confirmação para <strong>{email}</strong>.
              </>
            )}{' '}
            Abra a mensagem e clique no link para ativar sua conta.
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-sm">
          Não recebeu? Verifique a caixa de spam. O link vale por 24 horas.
        </p>
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/entrar" className="text-foreground font-medium underline underline-offset-4">
            Voltar para o login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
