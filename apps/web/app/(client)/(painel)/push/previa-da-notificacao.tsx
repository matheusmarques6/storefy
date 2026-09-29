'use client';

/**
 * Como a notificação vai aparecer no celular (parte da C08).
 *
 * Existe porque o lojista escreve olhando um campo largo de navegador e a
 * mensagem chega numa tira estreita de tela bloqueada. O texto que parecia
 * curto some no "…", e não há como consertar depois de enviar.
 *
 * As duas plataformas são mostradas juntas de propósito: elas cortam em
 * pontos diferentes, e o lojista não escolhe quem recebe em qual.
 */
import Image from 'next/image';
import { Smartphone } from 'lucide-react';
import {
  CORTE_ANDROID_CORPO,
  CORTE_ANDROID_TITULO,
  CORTE_IOS_CORPO,
  CORTE_IOS_TITULO,
  previaDaNotificacao,
} from '@/lib/campanha';

interface Props {
  nomeDoApp: string;
  title: string;
  body: string;
  /** Endereço da imagem da campanha, quando houver. */
  imagem?: string | null;
}

export function PreviaDaNotificacao({ nomeDoApp, title, body, imagem = null }: Props) {
  const vazio = title.trim() === '' && body.trim() === '';

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Como vai aparecer
      </p>

      {vazio ? (
        <div className="text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed p-6 text-sm">
          <Smartphone className="size-4 shrink-0" aria-hidden />
          Escreva o título e a mensagem para ver a prévia.
        </div>
      ) : (
        <div className="space-y-3">
          <Cartao
            sistema="iPhone"
            nomeDoApp={nomeDoApp}
            title={title}
            body={body}
            corteDoTitulo={CORTE_IOS_TITULO}
            corteDoCorpo={CORTE_IOS_CORPO}
            imagem={imagem}
            // O iPhone mostra a imagem pequena ao lado do texto; inteira, só
            // quando o cliente pressiona a notificação.
            estiloDaImagem="miniatura"
          />
          <Cartao
            sistema="Android"
            nomeDoApp={nomeDoApp}
            title={title}
            body={body}
            corteDoTitulo={CORTE_ANDROID_TITULO}
            corteDoCorpo={CORTE_ANDROID_CORPO}
            imagem={imagem}
            // O Android expande a notificação com a imagem larga embaixo.
            estiloDaImagem="grande"
          />
          {imagem === null ? null : (
            <p className="text-muted-foreground text-xs">
              A imagem inteira aparece quando o cliente abre a notificação para ver mais.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Cartao({
  sistema,
  nomeDoApp,
  title,
  body,
  corteDoTitulo,
  corteDoCorpo,
  imagem,
  estiloDaImagem,
}: {
  sistema: string;
  nomeDoApp: string;
  title: string;
  body: string;
  corteDoTitulo: number;
  corteDoCorpo: number;
  imagem: string | null;
  estiloDaImagem: 'miniatura' | 'grande';
}) {
  const t = previaDaNotificacao(title, corteDoTitulo);
  const c = previaDaNotificacao(body, corteDoCorpo);
  const cortou = t.cortado || c.cortado;

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">{sistema}</p>
      <div className="bg-muted/60 rounded-2xl border p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-primary/15 text-primary flex size-5 items-center justify-center rounded-md text-[10px] font-bold">
            {nomeDoApp.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
            {nomeDoApp}
          </span>
          <span className="text-muted-foreground ml-auto text-[11px]">agora</span>
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug font-semibold break-words">
              {t.texto === '' ? ' ' : t.texto}
            </p>
            <p className="text-muted-foreground text-sm leading-snug break-words">
              {c.texto === '' ? ' ' : c.texto}
            </p>
          </div>
          {imagem !== null && estiloDaImagem === 'miniatura' ? (
            <Image
              src={imagem}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="size-10 shrink-0 rounded-md object-cover"
            />
          ) : null}
        </div>
        {imagem !== null && estiloDaImagem === 'grande' ? (
          <Image
            src={imagem}
            alt=""
            width={288}
            height={144}
            unoptimized
            className="mt-2 aspect-[2/1] w-full rounded-lg object-cover"
          />
        ) : null}
      </div>
      {cortou ? (
        <p className="text-muted-foreground text-xs">
          No {sistema} o texto é cortado aqui. Encurte se o que importa ficou de fora.
        </p>
      ) : null}
    </div>
  );
}
