/**
 * A imagem do slide sai pronta para o app — conferido com imagens de verdade,
 * geradas pelo sharp, e lendo de volta o que saiu.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  LADO_MAXIMO_DO_SLIDE,
  TAMANHO_MAXIMO_DO_SLIDE,
  prepararImagemDoSlide,
} from './imagem-do-slide';

function imagem(
  largura: number,
  altura: number,
  formato: 'png' | 'jpeg' | 'webp' = 'png',
  alfa: 'sem' | 'opaco' | 'transparente' = 'sem',
): Promise<Buffer> {
  const base = sharp({
    create: {
      width: largura,
      height: altura,
      channels: alfa === 'sem' ? 3 : 4,
      background:
        alfa === 'transparente'
          ? { r: 29, g: 78, b: 216, alpha: 0 }
          : { r: 29, g: 78, b: 216, alpha: 1 },
    },
  });
  return formato === 'png'
    ? base.png().toBuffer()
    : formato === 'jpeg'
      ? base.jpeg().toBuffer()
      : base.webp().toBuffer();
}

describe('prepararImagemDoSlide', () => {
  it('foto grande sai em JPEG, reduzida para 1080 sem mudar a proporção', async () => {
    const resultado = await prepararImagemDoSlide(await imagem(3000, 2000, 'jpeg'));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.formato).toBe('jpeg');
    expect(resultado.largura).toBe(LADO_MAXIMO_DO_SLIDE);
    expect(resultado.altura).toBe(720);
    expect((await sharp(resultado.dados).metadata()).format).toBe('jpeg');
  });

  it('a transparência de verdade continua transparente, em PNG', async () => {
    const resultado = await prepararImagemDoSlide(await imagem(800, 600, 'png', 'transparente'));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.formato).toBe('png');
    const meta = await sharp(resultado.dados).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect((await sharp(resultado.dados).stats()).isOpaque).toBe(false);
  });

  it('canal alfa todo opaco não conta como transparência: sai em JPEG', async () => {
    const resultado = await prepararImagemDoSlide(await imagem(800, 600, 'png', 'opaco'));
    expect(resultado.ok && resultado.formato).toBe('jpeg');
  });

  it('imagem menor que o máximo não é esticada; WebP é aceita', async () => {
    const resultado = await prepararImagemDoSlide(await imagem(600, 400, 'webp'));
    expect(resultado.ok && resultado.largura).toBe(600);
  });

  it('a foto do celular chega em pé: a orientação da câmera é aplicada', async () => {
    const deitada = await sharp(await imagem(1000, 500, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const resultado = await prepararImagemDoSlide(deitada);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.largura).toBe(500);
    expect(resultado.altura).toBe(1000);
  });

  it('uma faixa estreita serve, se o lado maior tiver tamanho', async () => {
    const resultado = await prepararImagemDoSlide(await imagem(900, 120));
    expect(resultado.ok).toBe(true);
  });

  it('uma foto recortada, pesada em PNG, cabe no teto com paleta — e continua transparente', async () => {
    // Ruído semitransparente: o pior caso para o PNG comprimir.
    const lado = 1080;
    const pixels = Buffer.alloc(lado * lado * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = Math.floor(Math.random() * 256);
      pixels[i + 1] = Math.floor(Math.random() * 256);
      pixels[i + 2] = Math.floor(Math.random() * 256);
      pixels[i + 3] = 128;
    }
    const pesada = await sharp(pixels, { raw: { width: lado, height: lado, channels: 4 } })
      .png()
      .toBuffer();
    expect(pesada.byteLength).toBeGreaterThan(TAMANHO_MAXIMO_DO_SLIDE);

    const resultado = await prepararImagemDoSlide(pesada);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.formato).toBe('png');
    expect(resultado.dados.byteLength).toBeLessThanOrEqual(TAMANHO_MAXIMO_DO_SLIDE);
    expect((await sharp(resultado.dados).stats()).isOpaque).toBe(false);
  }, 30_000);

  it('pequena demais é recusada, com o motivo', async () => {
    expect(await prepararImagemDoSlide(await imagem(250, 250))).toEqual({
      ok: false,
      problema: 'pequena',
    });
  });

  it('o que não é imagem é recusado', async () => {
    expect(await prepararImagemDoSlide(Buffer.from('não sou uma imagem'))).toEqual({
      ok: false,
      problema: 'naoEImagem',
    });
  });
});
