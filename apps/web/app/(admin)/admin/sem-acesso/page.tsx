/** Usuário autenticado que não pertence a platform_admins. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { sair } from '../../../(client)/(publico)/acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sem acesso' };

export default function PaginaSemAcesso() {
  return (
    <div className="bg-muted/30 flex min-h-dvh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Acesso restrito</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <ShieldAlert aria-hidden />
            <AlertDescription>
              Sua conta não faz parte da equipe Storefy, então não tem acesso a esta área.
            </AlertDescription>
          </Alert>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline" className="flex-1">
              <Link href="/">Ir para o meu painel</Link>
            </Button>
            <form action={sair} className="flex-1">
              <Button type="submit" variant="ghost" className="w-full">
                Sair
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
