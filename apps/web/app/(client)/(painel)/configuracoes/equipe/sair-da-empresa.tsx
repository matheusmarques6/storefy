'use client';

/**
 * C16 — sair da empresa.
 *
 * O último proprietário não sai: a empresa ficaria sem dono. A tela explica
 * em vez de oferecer um botão que o banco recusaria. Quem sai da ÚNICA
 * empresa da conta é avisado de que fica sem nenhuma — e o painel oferece
 * aceitar um convite ou criar a própria depois.
 */
import { useState, useTransition } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { sairDaEmpresa } from './acoes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function SairDaEmpresa({
  empresa,
  unicoProprietario,
  unicaEmpresa,
}: {
  empresa: string;
  unicoProprietario: boolean;
  unicaEmpresa: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [rodando, iniciar] = useTransition();

  function sair() {
    iniciar(async () => {
      const resultado = await sairDaEmpresa();
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Você saiu da empresa.');
        // A empresa ativa mora em cookie: o painel nasce de novo sem ela.
        window.location.assign(resultado.destino ?? '/');
        return;
      }
      setConfirmando(false);
      toast.error(resultado.mensagem ?? 'Não foi possível sair.');
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sair desta empresa</CardTitle>
        <CardDescription>
          {unicoProprietario
            ? 'Você é o único proprietário. Torne outra pessoa proprietária antes de sair, para a empresa não ficar sem dono.'
            : 'Você deixa de ver e mexer no painel desta empresa. Para voltar, alguém precisa convidar você de novo.'}
        </CardDescription>
      </CardHeader>
      {unicoProprietario ? null : (
        <CardContent>
          <Button
            type="button"
            variant="outline"
            disabled={rodando}
            onClick={() => {
              setConfirmando(true);
            }}
          >
            <LogOut aria-hidden />
            Sair desta empresa
          </Button>
        </CardContent>
      )}

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair de {empresa}?</AlertDialogTitle>
            <AlertDialogDescription>
              {unicaEmpresa
                ? 'Esta é a única empresa da sua conta. Depois de sair, você só volta a um painel aceitando um convite ou criando a sua própria empresa.'
                : 'Você deixa de ver e mexer no painel desta empresa. Suas outras empresas continuam como estão.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rodando}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={rodando}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(evento) => {
                evento.preventDefault();
                sair();
              }}
            >
              {rodando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
