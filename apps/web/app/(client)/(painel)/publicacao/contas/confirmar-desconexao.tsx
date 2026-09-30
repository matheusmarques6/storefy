'use client';

/**
 * Desconectar a conta Apple ou Google, sempre com confirmação (regra 3).
 *
 * Desconectar apaga as chaves da empresa inteira: as próximas publicações de
 * TODAS as lojas daquela plataforma param, e o acompanhamento da revisão
 * também. O diálogo diz isso antes, e o app que já está na loja não muda.
 */
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const TEXTOS = {
  apple: {
    titulo: 'Desconectar a conta Apple?',
    corpo:
      'As chaves saem da Storefy. As próximas publicações para iPhone, de todas as lojas da empresa, e o acompanhamento da revisão da Apple param até você conectar de novo. O app que já está na App Store continua lá.',
  },
  google: {
    titulo: 'Desconectar a conta Google?',
    corpo:
      'O arquivo de serviço sai da Storefy. As próximas publicações para Android, de todas as lojas da empresa, e o acompanhamento na Play Store param até você conectar de novo. O app que já está na Play Store continua lá.',
  },
} as const;

export function ConfirmarDesconexao({
  plataforma,
  ocupado,
  aoConfirmar,
}: {
  plataforma: 'apple' | 'google';
  ocupado: boolean;
  /** Desconecta; `true` quando deu certo, para o diálogo fechar. */
  aoConfirmar: () => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const texto = TEXTOS[plataforma];

  return (
    <AlertDialog open={aberto} onOpenChange={setAberto}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" disabled={ocupado}>
          Desconectar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{texto.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{texto.corpo}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={ocupado}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={ocupado}
            onClick={(evento) => {
              // Fica aberto até a resposta, para o erro aparecer com o diálogo na frente.
              evento.preventDefault();
              void aoConfirmar().then((deuCerto) => {
                if (deuCerto) setAberto(false);
              });
            }}
          >
            {ocupado ? 'Desconectando…' : 'Desconectar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
