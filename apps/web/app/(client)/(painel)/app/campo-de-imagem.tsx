'use client';

/**
 * Envio do ícone e da tela de abertura (C06a).
 *
 * A conferência acontece no servidor, com o mesmo código que o build usa, e o
 * erro volta escrito para o lojista. É a diferença entre saber agora e receber
 * um e-mail da Apple quatro dias depois dizendo "Invalid Icon".
 *
 * A prévia mostra o ícone sobre um fundo quadriculado: é como se vê, de
 * relance, que a imagem tem transparência — que é a recusa número um.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { enviarAsset, removerAssetDaLoja } from './acoes';

interface Props {
  storeId: string;
  tipo: 'icone' | 'splash';
  rotulo: string;
  ajuda: string;
  /** Link assinado da imagem atual, quando existe. */
  urlAtual: string | null;
  somenteLeitura: boolean;
}

export function CampoDeImagem({ storeId, tipo, rotulo, ajuda, urlAtual, somenteLeitura }: Props) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function enviar(arquivo: File) {
    setErro(null);
    iniciar(async () => {
      const formulario = new FormData();
      formulario.set('arquivo', arquivo);

      const resultado = await enviarAsset(storeId, tipo, formulario);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Imagem atualizada.');
        router.refresh();
      } else {
        // O motivo fica embaixo do campo, e não só num toast que some: é uma
        // instrução para refazer a imagem, não um aviso passageiro.
        setErro(resultado.mensagem ?? 'Não foi possível enviar a imagem.');
      }
    });
  }

  function remover() {
    iniciar(async () => {
      const resultado = await removerAssetDaLoja(storeId, tipo);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Imagem removida.');
        setErro(null);
        router.refresh();
      } else {
        toast.error(resultado.mensagem ?? 'Não foi possível remover.');
      }
    });
  }

  const id = `imagem-${tipo}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>

      <div className="flex flex-wrap items-start gap-4">
        <div
          className={
            tipo === 'icone'
              ? 'size-24 shrink-0 overflow-hidden rounded-2xl border'
              : 'h-32 w-20 shrink-0 overflow-hidden rounded-xl border'
          }
          /*
           * Fundo quadriculado: é assim que se vê de relance que a imagem tem
           * transparência, que é a recusa número um da Apple.
           */
          style={{
            backgroundImage:
              'linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)',
            backgroundSize: '12px 12px',
            backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
          }}
        >
          {urlAtual === null ? (
            <div className="text-muted-foreground flex size-full items-center justify-center">
              <ImageUp className="size-6" aria-hidden />
            </div>
          ) : (
            <Image
              src={urlAtual}
              alt={tipo === 'icone' ? 'Ícone do app' : 'Tela de abertura do app'}
              width={tipo === 'icone' ? 96 : 80}
              height={tipo === 'icone' ? 96 : 128}
              className="size-full object-cover"
              unoptimized
            />
          )}
        </div>

        <div className="min-w-48 flex-1 space-y-2">
          <input
            ref={entrada}
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={somenteLeitura || enviando}
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0];
              if (arquivo !== undefined) enviar(arquivo);
              // Limpa para o mesmo arquivo poder ser reenviado depois de
              // corrigido — senão o `change` não dispara de novo.
              evento.target.value = '';
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={somenteLeitura || enviando}
              onClick={() => {
                entrada.current?.click();
              }}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImageUp className="size-4" aria-hidden />
              )}
              {urlAtual === null ? 'Enviar imagem' : 'Trocar'}
            </Button>

            {urlAtual === null || somenteLeitura ? null : (
              <Button type="button" variant="ghost" size="sm" disabled={enviando} onClick={remover}>
                <Trash2 className="size-4" aria-hidden />
                Remover
              </Button>
            )}
          </div>

          <p
            className={erro === null ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}
          >
            {erro ?? ajuda}
          </p>
        </div>
      </div>
    </div>
  );
}
