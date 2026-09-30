'use client';

import { useSyncExternalStore } from 'react';
import { CircleAlert, Smartphone } from 'lucide-react';
import { lerFragmento, linkDoApp } from '@/lib/celular-de-teste';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/*
 * O fragmento só existe no navegador. No servidor (e na hidratação) ele é
 * `null`, e a tela espera um instante em vez de dizer "link incompleto".
 */
function assinarFragmento(avisar: () => void): () => void {
  window.addEventListener('hashchange', avisar);
  return () => {
    window.removeEventListener('hashchange', avisar);
  };
}
const fragmentoNoNavegador = (): string => window.location.hash;
const fragmentoNoServidor = (): null => null;

export function AbrirNoApp() {
  const fragmento = useSyncExternalStore(
    assinarFragmento,
    fragmentoNoNavegador,
    fragmentoNoServidor,
  );

  if (fragmento === null) {
    return (
      <Card aria-busy="true">
        <CardHeader>
          <CardTitle>Abrindo…</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const destino = lerFragmento(fragmento);
  if (destino === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="text-destructive size-5" aria-hidden />
            Este link está incompleto
          </CardTitle>
          <CardDescription>
            Ele pode ter sido copiado pela metade. No painel da Storefy, abra de novo o
            &quot;Adicionar celular&quot; e leia o QR code novo com a câmera.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" aria-hidden />
          Adicionar este celular aos testes
        </CardTitle>
        <CardDescription>
          Toque no botão para abrir o app da loja. Ele termina sozinho e avisa quando este celular
          estiver pronto para receber os testes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button asChild className="w-full" size="lg">
          <a href={linkDoApp(destino.storeId, destino.codigo)}>Abrir o app da loja</a>
        </Button>
        <p className="text-muted-foreground text-sm">
          Nada aconteceu? Confira se o app da loja está instalado neste celular e se você já o abriu
          uma vez. Depois leia o QR code de novo — ele vale 10 minutos.
        </p>
      </CardContent>
    </Card>
  );
}
