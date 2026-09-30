'use client';

/**
 * A imagem de um slide de boas-vindas (C06d).
 *
 * Enviada pelo painel e reprocessada no servidor (`enviarImagemDoSlide`). O
 * campo de endereço digitado que havia aqui deixava passar um `http://` (que
 * o iPhone recusa), a imagem de outro site (que some quando o site sai do ar)
 * e a foto de 5 MB que o cliente baixaria na primeira abertura do app.
 *
 * A miniatura aparece sobre a cor de fundo do app, e inteira, como o slide a
 * mostra: uma imagem com fundo transparente se vê ali como vai ficar.
 */
import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MENSAGEM_DE_IMAGEM_GRANDE, TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';
import { enviarImagemDoSlide } from './acoes';

interface Props {
  storeId: string;
  /** A posição do slide (0, 1…), para os rótulos e os ids. */
  indice: number;
  /** O endereço atual; vazio quando o slide não tem imagem. */
  url: string;
  /** A cor de fundo do app, que aparece atrás da imagem no slide. */
  fundo: string;
  somenteLeitura: boolean;
  aoMudar: (url: string) => void;
}

export function ImagemDoSlide({ storeId, indice, url, fundo, somenteLeitura, aoMudar }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const numero = String(indice + 1);
  const id = `slide-${String(indice)}-imagem`;

  function enviar(arquivo: File) {
    setErro(null);
    // Conferido aqui para não subir 20 MB só para ouvir "grande demais".
    if (arquivo.size > TAMANHO_MAXIMO_DE_IMAGEM) {
      setErro(MENSAGEM_DE_IMAGEM_GRANDE);
      return;
    }
    iniciar(async () => {
      const formulario = new FormData();
      formulario.set('arquivo', arquivo);

      let resultado: Awaited<ReturnType<typeof enviarImagemDoSlide>>;
      try {
        resultado = await enviarImagemDoSlide(storeId, formulario);
      } catch {
        setErro('Não conseguimos enviar a imagem. Confira a conexão e tente de novo.');
        return;
      }
      if (resultado.ok) aoMudar(resultado.url);
      // O motivo fica embaixo do campo: é uma instrução para refazer a imagem.
      else setErro(resultado.mensagem);
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Imagem (opcional)</Label>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
          style={{ backgroundColor: fundo }}
        >
          {url === '' ? (
            <ImageUp className="text-muted-foreground size-5" aria-hidden />
          ) : (
            <Image
              src={url}
              alt={`Imagem da tela ${numero}`}
              width={96}
              height={64}
              className="size-full object-contain"
              unoptimized
            />
          )}
        </div>

        <input
          ref={entrada}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          disabled={somenteLeitura || enviando}
          onChange={(evento) => {
            const arquivo = evento.target.files?.[0];
            if (arquivo !== undefined) enviar(arquivo);
            // Limpa para o mesmo arquivo poder ser reenviado depois de corrigido.
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
            {enviando ? 'Enviando…' : url === '' ? 'Enviar imagem' : 'Trocar imagem'}
          </Button>
          {url === '' || somenteLeitura ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={enviando}
              aria-label={`Tirar imagem da tela ${numero}`}
              onClick={() => {
                setErro(null);
                aoMudar('');
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Tirar imagem
            </Button>
          )}
        </div>
      </div>

      {erro === null ? (
        <p className="text-muted-foreground text-xs">
          JPG, PNG ou WebP, até 8 MB. O ideal é 1080 × 720; fundo transparente continua transparente
          no app. Sem imagem, a tela fica só com o título e o texto.
        </p>
      ) : (
        <p role="alert" className="text-destructive text-xs">
          {erro}
        </p>
      )}
    </div>
  );
}
