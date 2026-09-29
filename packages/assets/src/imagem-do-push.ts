/**
 * A imagem da campanha de push (C08), pronta para o celular.
 *
 * O lojista manda a foto que tiver — do celular, girada pela câmera, com
 * 4000 pixels e 5 MB, PNG com fundo transparente. O que sai daqui é o que a
 * notificação aguenta mostrar:
 *
 *   JPEG, porque é o formato que o iOS e o Android exibem na notificação sem
 *   surpresa (WebP e PNG transparente variam de aparelho para aparelho, e o
 *   fundo transparente vira preto em muitos Androids);
 *   no máximo 1440 pixels de lado, porque a extensão do iOS que baixa a
 *   imagem tem pouca memória — uma foto de 24 megapixels é decodificada e
 *   derruba a extensão, e a notificação chega sem imagem;
 *   girada de acordo com a câmera (EXIF), senão a foto do celular chega
 *   deitada.
 */
import sharp, { type OutputInfo, type Sharp } from 'sharp';

/** O maior lado da imagem entregue. 1440 × 720 é o tamanho que o Android mostra inteiro. */
export const LADO_MAXIMO_DO_PUSH = 1440;
/** Menores que isso ficam borradas na notificação expandida. */
export const LARGURA_MINIMA_DO_PUSH = 400;
export const ALTURA_MINIMA_DO_PUSH = 200;

export const ERROS_DA_IMAGEM_DO_PUSH = {
  naoEImagem: 'Não conseguimos abrir esse arquivo como imagem. Envie um JPG, PNG ou WebP.',
  pequena: `A imagem é pequena demais e ficaria borrada. Use uma com pelo menos ${String(LARGURA_MINIMA_DO_PUSH)} × ${String(ALTURA_MINIMA_DO_PUSH)} pixels — o ideal é 1440 × 720.`,
} as const;

export type ProblemaDaImagemDoPush = keyof typeof ERROS_DA_IMAGEM_DO_PUSH;

export type ImagemDoPush =
  | {
      ok: true;
      jpeg: Buffer;
      largura: number;
      altura: number;
      /**
       * Perto de 2:1 (o dobro da largura pela altura). Longe disso, o Android
       * corta as bordas na notificação expandida — vale avisar, não recusar.
       */
      proporcaoIdeal: boolean;
    }
  | { ok: false; problema: ProblemaDaImagemDoPush };

/** Quanto a proporção pode fugir de 2:1 e ainda contar como ideal. */
const FOLGA_DA_PROPORCAO = 0.25;

export async function prepararImagemDoPush(dados: Buffer): Promise<ImagemDoPush> {
  let imagem: Sharp;
  let largura: number;
  let altura: number;
  try {
    // `rotate()` sem argumento aplica a orientação da câmera e apaga o EXIF.
    imagem = sharp(dados, { failOn: 'error' }).rotate();
    const meta = await imagem.metadata();
    // Girada pela câmera (orientações 5 a 8), largura e altura trocam de lugar.
    const deitada = (meta.orientation ?? 1) >= 5;
    largura = deitada ? meta.height : meta.width;
    altura = deitada ? meta.width : meta.height;
  } catch {
    return { ok: false, problema: 'naoEImagem' };
  }

  if (largura < LARGURA_MINIMA_DO_PUSH || altura < ALTURA_MINIMA_DO_PUSH) {
    return { ok: false, problema: 'pequena' };
  }

  let saida: { data: Buffer; info: OutputInfo };
  try {
    saida = await imagem
      .resize({
        width: LADO_MAXIMO_DO_PUSH,
        height: LADO_MAXIMO_DO_PUSH,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, problema: 'naoEImagem' };
  }

  const proporcao = saida.info.width / saida.info.height;
  return {
    ok: true,
    jpeg: saida.data,
    largura: saida.info.width,
    altura: saida.info.height,
    proporcaoIdeal: Math.abs(proporcao - 2) <= FOLGA_DA_PROPORCAO * 2,
  };
}
