'use client';

/**
 * C06a na prévia: o ícone na tela inicial e a tela de abertura, como o
 * celular do cliente vai mostrar.
 *
 * O lojista envia o ícone e a abertura em Aparência, mas o que decide se eles
 * funcionam é o celular: o recorte (quadrado arredondado no iPhone, redondo no
 * Android), o tamanho pequeno na tela inicial e o nome cortado embaixo. Aqui
 * ele vê isso antes de publicar — e não na revisão da Apple.
 *
 * AS CONTAS SÃO AS DO BUILD. O Android mostra só o miolo do ícone adaptativo
 * (72 de 108 dp: por isso a escala de 1,5), sobre a cor de fundo do app; a
 * abertura é a imagem com 200 dp de largura (num celular de 390 dp, pouco mais
 * da metade), centrada na mesma cor — e, sem imagem, a tela é branca.
 */
import Image from 'next/image';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface IdentidadeNaPrevia {
  /** O nome embaixo do ícone (C06a). */
  nomeDoApp: string;
  /** Links assinados das imagens atuais, ou `null` sem imagem enviada. */
  urlDoIcone: string | null;
  urlDaSplash: string | null;
  /** A cor de fundo do app (`fundoDoApp`): abertura e fundo do ícone do Android. */
  fundo: string;
}

/** Fração da largura do celular que a imagem da abertura ocupa (200 de 390 dp). */
const LARGURA_DA_ABERTURA = 200 / 390;

/** O raio do quadrado arredondado do iPhone, em fração do lado. */
const RAIO_DO_IPHONE = 0.2237;

/** O Android mostra 72 dp dos 108 do ícone adaptativo. */
const ESCALA_DO_ADAPTATIVO = 108 / 72;

function Icone({
  identidade,
  ehIphone,
  lado,
}: {
  identidade: IdentidadeNaPrevia;
  ehIphone: boolean;
  lado: number;
}) {
  const raio = ehIphone ? lado * RAIO_DO_IPHONE : '9999px';

  if (identidade.urlDoIcone === null) {
    // Só a forma: a cor de fundo do app (branca, quase sempre) apagaria o tracejado.
    return (
      <div
        className="flex items-center justify-center border-2 border-dashed border-white/80 bg-white/15"
        style={{ width: lado, height: lado, borderRadius: raio }}
      >
        <ImageUp className="size-1/3 text-white" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden shadow-md"
      style={{
        width: lado,
        height: lado,
        borderRadius: raio,
        // O Android põe a cor de fundo do app atrás do ícone adaptativo.
        ...(ehIphone ? {} : { backgroundColor: identidade.fundo }),
      }}
    >
      <Image
        src={identidade.urlDoIcone}
        alt=""
        width={lado}
        height={lado}
        unoptimized
        className="size-full object-cover"
        style={ehIphone ? undefined : { transform: `scale(${String(ESCALA_DO_ADAPTATIVO)})` }}
      />
    </div>
  );
}

/** A tela inicial: o ícone no tamanho de verdade, com o nome, e grande, para conferir o recorte. */
export function TelaInicialNaPrevia({
  identidade,
  ehIphone,
}: {
  identidade: IdentidadeNaPrevia;
  ehIphone: boolean;
}) {
  const semIcone = identidade.urlDoIcone === null;

  return (
    <div
      data-testid="tela-inicial-na-previa"
      className="relative flex h-full flex-col"
      // Um papel de parede neutro: só um fundo, sem app de mentira em volta.
      style={{ background: 'linear-gradient(165deg, #1e293b 0%, #334155 45%, #64748b 100%)' }}
    >
      <div
        className={cn('flex justify-center', ehIphone ? 'h-9 items-end pb-1' : 'h-7 items-center')}
      >
        <div
          className={cn('bg-black/70', ehIphone ? 'h-5 w-20 rounded-full' : 'size-3 rounded-full')}
        />
      </div>

      <div className="grid grid-cols-4 gap-x-3 px-5 pt-5">
        <figure className="flex flex-col items-center gap-1">
          {/* 60 dp de 390: o tamanho de um ícone na tela inicial. */}
          <Icone identidade={identidade} ehIphone={ehIphone} lado={46} />
          <figcaption
            data-testid="nome-na-tela-inicial"
            className="w-[64px] truncate text-center text-[10px] font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"
          >
            {identidade.nomeDoApp}
          </figcaption>
        </figure>
      </div>

      <div className="mt-auto mb-10 flex flex-col items-center gap-3 px-6 text-center">
        <Icone identidade={identidade} ehIphone={ehIphone} lado={112} />
        <p className="text-xs font-medium text-white/90">
          {semIcone
            ? 'Envie o ícone em Aparência para ver como ele fica aqui.'
            : ehIphone
              ? 'No iPhone, o ícone ganha os cantos arredondados.'
              : 'No Android, o ícone é recortado em círculo: só o miolo aparece.'}
        </p>
      </div>

      <div className="flex justify-center pb-2">
        <div className={cn('h-1 rounded-full bg-white/70', ehIphone ? 'w-24' : 'w-14')} />
      </div>
    </div>
  );
}

/** A tela de abertura, como o app mostra enquanto carrega. */
export function AberturaNaPrevia({ identidade }: { identidade: IdentidadeNaPrevia }) {
  const { urlDaSplash } = identidade;

  return (
    <div
      data-testid="abertura-na-previa"
      className="flex h-full items-center justify-center px-6"
      style={{ backgroundColor: urlDaSplash === null ? '#ffffff' : identidade.fundo }}
    >
      {urlDaSplash === null ? (
        <p className="max-w-[210px] text-center text-xs text-neutral-500">
          Sem imagem de abertura, o app abre numa tela branca. Envie uma em Aparência.
        </p>
      ) : (
        <Image
          src={urlDaSplash}
          alt="Imagem da tela de abertura"
          width={200}
          height={200}
          unoptimized
          className="h-auto object-contain"
          style={{ width: `${String(LARGURA_DA_ABERTURA * 100)}%` }}
        />
      )}
    </div>
  );
}
