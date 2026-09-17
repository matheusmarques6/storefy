/**
 * Tela exibida quando o Supabase não está configurado.
 *
 * Regra 1 das inegociáveis: integração ausente mostra estado claro dizendo o
 * que falta — nunca uma tela falsa com dados de exemplo.
 */
import type { Metadata } from 'next';
import { Settings2 } from 'lucide-react';
import { faltandoNoSupabase } from '@/lib/env';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Configuração pendente' };

export default function PaginaConfiguracaoPendente() {
  return (
    <div className="bg-muted/30 flex min-h-dvh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Configuração pendente</CardTitle>
          <CardDescription>
            O Storefy ainda não está ligado ao banco de dados neste ambiente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning">
            <Settings2 aria-hidden />
            <AlertDescription>
              {faltandoNoSupabase.length === 0 ? (
                <>Verifique as variáveis de ambiente do Supabase.</>
              ) : (
                <>
                  Faltam estas variáveis de ambiente:
                  <ul className="mt-2 list-inside list-disc font-mono text-xs">
                    {faltandoNoSupabase.map((variavel) => (
                      <li key={variavel}>{variavel}</li>
                    ))}
                  </ul>
                </>
              )}
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground text-sm">
            Copie <code className="bg-muted rounded px-1 py-0.5 text-xs">.env.example</code> para{' '}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">.env.local</code> e preencha os
            valores do seu projeto Supabase. O passo a passo está no{' '}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">README.md</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
