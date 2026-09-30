/**
 * A imagem do slide de boas-vindas (C06d), pronta para o app (M02).
 *
 * O app desenha a imagem inteira, sem cortar, numa área de 80% da largura da
 * tela por 240 pontos de altura, sobre a cor de fundo do app. Então:
 *
 *   no máximo 1080 pixels de lado — sobra nitidez em qualquer celular, e o
 *   cliente não baixa uma foto de 5 MB na primeira abertura do app;
 *   PNG quando a imagem tem transparência de verdade (um logo, uma ilustração
 *   recortada), para o fundo do app aparecer por trás — o branco que o push
 *   usa viraria um retângulo num app de fundo escuro; JPEG no resto;
 *   girada de acordo com a câmera (EXIF), senão a foto do celular chega
 *   deitada.
 */
import sharp, { type OutputInfo, type Sharp } from 'sharp';

/** O maior lado da imagem entregue. */
export const LADO_MAXIMO_DO_SLIDE = 1080;
/** O maior lado precisa de pelo menos isto; menos que isso fica borrado na tela. */
export const LADO_MINIMO_DO_SLIDE = 300;
/** O teto do arquivo guardado (o do bucket `imagens-do-app`). */
export const TAMANHO_MAXIMO_DO_SLIDE = 2 * 1024 * 1024;

export const ERROS_DA_IMAGEM_DO_SLIDE = {
  naoEImagem: 'Não conseguimos abrir esse arquivo como imagem. Envie um JPG, PNG ou WebP.',
  pequena: `A imagem é pequena demais e ficaria borrada. Use uma com pelo menos ${String(LADO_MINIMO_DO_SLIDE)} pixels no lado maior — o ideal é 1080 × 720.`,
  pesada:
    'Mesmo reduzida, a imagem ficou pesada demais para o app baixar rápido. Tente uma com fundo sem transparência, ou com menos detalhes.',
} as const;

export type ProblemaDaImagemDoSlide = keyof typeof ERROS_DA_IMAGEM_DO_SLIDE;

export type ImagemDoSlide =
  | {
      ok: true;
      dados: Buffer;
      /** `png` só quando há transparência de verdade. */
      formato: 'png' | 'jpeg';
      largura: number;
      altura: number;
    }
  | { ok: false; problema: ProblemaDaImagemDoSlide };

export async function prepararImagemDoSlide(dados: Buffer): Promise<ImagemDoSlide> {
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

  if (Math.max(largura, altura) < LADO_MINIMO_DO_SLIDE) return { ok: false, problema: 'pequena' };

  let saida: { data: Buffer; info: OutputInfo };
  let formato: 'png' | 'jpeg';
  try {
    // Reduzida sem perda primeiro: é sobre ela que se decide o formato.
    const reduzida = await imagem
      .resize({
        width: LADO_MAXIMO_DO_SLIDE,
        height: LADO_MAXIMO_DO_SLIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    /*
     * `isOpaque` olha os pixels, e não o canal: muito PNG tem canal alfa todo
     * opaco, e sairia em PNG pesado sem transparência nenhuma para mostrar.
     */
    const { isOpaque } = await sharp(reduzida).stats();
    if (isOpaque) {
      formato = 'jpeg';
      saida = await sharp(reduzida)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } else {
      formato = 'png';
      saida = await sharp(reduzida)
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      /*
       * Uma foto recortada vira um PNG enorme; com paleta, cabe. Esforço 4, e
       * não o padrão (7): no pior caso medido, 1,5 s em vez de 8,5 s, com o
       * mesmo tamanho — e é o tempo que o lojista espera olhando o botão.
       */
      if (saida.data.byteLength > TAMANHO_MAXIMO_DO_SLIDE) {
        saida = await sharp(reduzida)
          .png({ compressionLevel: 9, palette: true, quality: 90, effort: 4 })
          .toBuffer({ resolveWithObject: true });
      }
    }
  } catch {
    return { ok: false, problema: 'naoEImagem' };
  }

  if (saida.data.byteLength > TAMANHO_MAXIMO_DO_SLIDE) return { ok: false, problema: 'pesada' };

  return {
    ok: true,
    dados: saida.data,
    formato,
    largura: saida.info.width,
    altura: saida.info.height,
  };
}
