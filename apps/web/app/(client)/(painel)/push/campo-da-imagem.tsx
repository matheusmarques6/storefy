'use client';

/**
 * A imagem da campanha (C08).
 *
 * Sobe na hora da escolha, e não ao salvar: a prévia ao lado e o envio de
 * teste precisam dela antes. O servidor reprocessa a foto (gira, reduz, tira
 * a transparência) e devolve o endereço que a notificação vai usar.
 */
import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { enviarImagemDoPush } from './acoes';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MENSAGEM_DE_IMAGEM_GRANDE, TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';

export interface ImagemDaCampanha {
  /** Onde ela está no bucket — é o que a campanha guarda. */
  caminho: string;
  /** O endereço público, para a prévia. */
  url: string;
}

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

export function CampoDaImagem({
  imagem,
  aoMudar,
  aoSubir,
  erro,
}: {
  imagem: ImagemDaCampanha | null;
  aoMudar: (imagem: ImagemDaCampanha | null) => void;
  /**
   * Avisa quando a imagem começa e termina de subir: salvar no meio do envio
   * gravaria a campanha sem ela, e a foto ficaria sobrando no Storage.
   */
  aoSubir?: (subindo: boolean) => void;
  /** O problema que o servidor achou ao salvar (a imagem sumiu, por exemplo). */
  erro?: string | undefined;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, iniciar] = useTransition();
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const problema = erroDoEnvio ?? erro ?? null;

  function enviar(arquivo: File) {
    setErroDoEnvio(null);
    setAviso(null);
    if (!TIPOS.includes(arquivo.type)) {
      setErroDoEnvio('Envie uma imagem JPG, PNG ou WebP.');
      return;
    }
    if (arquivo.size > TAMANHO_MAXIMO_DE_IMAGEM) {
      setErroDoEnvio(MENSAGEM_DE_IMAGEM_GRANDE);
      return;
    }

    aoSubir?.(true);
    iniciar(async () => {
      const formulario = new FormData();
      formulario.set('imagem', arquivo);

      let resultado: Awaited<ReturnType<typeof enviarImagemDoPush>>;
      try {
        resultado = await enviarImagemDoPush(formulario);
      } catch {
        // A ação nem respondeu (conexão caiu no meio do envio).
        setErroDoEnvio('Não conseguimos enviar a imagem. Confira a conexão e tente de novo.');
        return;
      } finally {
        aoSubir?.(false);
      }
      if (!resultado.ok) {
        setErroDoEnvio(resultado.mensagem);
        return;
      }
      aoMudar({ caminho: resultado.caminho, url: resultado.url });
      setAviso(resultado.aviso);
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="imagem-da-campanha">Imagem (opcional)</Label>

      <div className="flex flex-wrap items-start gap-4">
        <div className="bg-muted/40 flex aspect-[2/1] w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
          {imagem === null ? (
            <ImageUp className="text-muted-foreground size-6" aria-hidden />
          ) : (
            <Image
              src={imagem.url}
              alt="Imagem da campanha"
              width={192}
              height={96}
              unoptimized
              className="size-full object-cover"
            />
          )}
        </div>

        <div className="min-w-48 flex-1 space-y-2">
          <input
            ref={entrada}
            id="imagem-da-campanha"
            type="file"
            accept={TIPOS.join(',')}
            className="sr-only"
            // Fora da ordem do Tab: o botão ao lado é quem abre a escolha, e o
            // campo escondido seria uma parada invisível antes dele.
            tabIndex={-1}
            disabled={enviando}
            aria-describedby="ajuda-imagem"
            onChange={(evento) => {
              const arquivo = evento.target.files?.[0];
              if (arquivo !== undefined) enviar(arquivo);
              // Limpa para a mesma foto poder ser escolhida de novo.
              evento.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={enviando}
              onClick={() => {
                entrada.current?.click();
              }}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImageUp className="size-4" aria-hidden />
              )}
              {enviando
                ? 'Enviando a imagem...'
                : imagem === null
                  ? 'Escolher imagem'
                  : 'Trocar imagem'}
            </Button>
            {imagem === null ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={enviando}
                onClick={() => {
                  setAviso(null);
                  setErroDoEnvio(null);
                  aoMudar(null);
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Remover imagem
              </Button>
            )}
          </div>
          <p id="ajuda-imagem" className="text-muted-foreground text-xs">
            JPG, PNG ou WebP de até 8 MB. O ideal é 1440 × 720 pixels, o dobro da largura pela
            altura. A gente ajusta o tamanho e o formato para o celular.
          </p>
          {aviso === null ? null : (
            <p className="text-xs text-amber-700 dark:text-amber-400">{aviso}</p>
          )}
          {problema === null ? null : (
            <p className="text-destructive text-sm" role="alert">
              {problema}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
