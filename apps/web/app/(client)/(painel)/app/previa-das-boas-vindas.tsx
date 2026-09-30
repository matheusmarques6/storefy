'use client';

/**
 * C06d na prévia: as telas de boas-vindas como o app as mostra (M02,
 * `apps/mobile/src/telas/onboarding.tsx`).
 *
 * AS CONTAS SÃO AS DO APP, na escala da moldura (300 px para um celular de
 * 390 pontos): a imagem inteira numa área de 80% da largura por 240 pontos de
 * altura, o título grande, o texto mais apagado, os pontos e o botão embaixo,
 * e o "Pular" no canto — tudo sobre a cor de fundo do app.
 */
import { useState } from 'react';
import Image from 'next/image';
import type { AppConfig } from '@storefy/config-schema';

/** A moldura tem 300 px; o celular de referência, 390 pontos. */
const ESCALA = 300 / 390;

interface Props {
  slides: AppConfig['features']['onboardingSlides'];
  tema: AppConfig['theme'];
  /** A tela mostrada; fora da lista, vale a última. */
  indice: number;
  aoTrocar: (indice: number) => void;
  /** "Pular": o app vai para a loja, e a prévia também. */
  aoPular: () => void;
}

export function BoasVindasNaPrevia({ slides, tema, indice, aoTrocar, aoPular }: Props) {
  // A imagem que não abriu (um endereço antigo, fora do ar), para dizer isso.
  const [falhou, setFalhou] = useState<string | null>(null);
  const atual = Math.max(0, Math.min(indice, slides.length - 1));
  const slide = slides[atual];
  if (slide === undefined) return null;
  const ultimo = atual >= slides.length - 1;
  const imagem = slide.image.trim();

  return (
    <div
      data-testid="boas-vindas-na-previa"
      className="flex h-full flex-col px-6 pt-9 pb-5"
      style={{ backgroundColor: tema.background, color: tema.text }}
    >
      <div className="flex justify-end">
        <button type="button" onClick={aoPular} className="text-xs font-medium opacity-60">
          Pular
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        {imagem === '' ? null : (
          <div
            className="flex w-[80%] items-center justify-center"
            style={{ height: 240 * ESCALA, marginBottom: 12 * ESCALA }}
          >
            {falhou === imagem ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-[11px] opacity-70">
                A imagem não abriu. Envie a imagem de novo.
              </p>
            ) : (
              <Image
                src={imagem}
                alt={`Imagem da tela ${String(atual + 1)}`}
                width={240}
                height={185}
                unoptimized
                className="size-full object-contain"
                onError={() => {
                  setFalhou(imagem);
                }}
              />
            )}
          </div>
        )}
        {slide.title.trim() === '' ? (
          <p className="text-lg leading-tight font-bold opacity-30">Escreva o título</p>
        ) : (
          <p className="text-lg leading-tight font-bold break-words">{slide.title}</p>
        )}
        <p className="text-xs leading-snug break-words opacity-70">{slide.body}</p>
      </div>

      <div className="space-y-4">
        <div className="flex justify-center gap-1.5">
          {slides.map((_, posicao) => (
            <button
              // A posição É a identidade aqui: a tela 2 é a segunda da lista.
              key={posicao}
              type="button"
              aria-label={`Ver a tela ${String(posicao + 1)}`}
              aria-pressed={posicao === atual}
              onClick={() => {
                aoTrocar(posicao);
              }}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: posicao === atual ? 15 : 6,
                backgroundColor: posicao === atual ? tema.primary : tema.tabBarInactive,
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            // Na prévia, "Começar" volta para a primeira: no app, ele abre a loja.
            aoTrocar(ultimo ? 0 : atual + 1);
          }}
          className="w-full rounded-lg py-3 text-sm font-semibold"
          style={{ backgroundColor: tema.primary, color: tema.background }}
        >
          {ultimo ? 'Começar' : 'Continuar'}
        </button>
      </div>
    </div>
  );
}
