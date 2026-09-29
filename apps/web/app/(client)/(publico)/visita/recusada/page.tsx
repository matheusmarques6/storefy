/** O link de visita ao painel de um cliente não abriu: venceu, ou não é seu. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Visita não aberta' };

export default function PaginaVisitaRecusada() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-5" aria-hidden />
          Esta visita não abriu
        </CardTitle>
        <CardDescription>
          O link para ver o painel do cliente vale 5 minutos e só funciona para quem o pediu, com a
          mesma conta da equipe Storefy. Volte à ficha do cliente e abra de novo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full">
          <Link href="/admin/organizacoes">Voltar para as organizações</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
