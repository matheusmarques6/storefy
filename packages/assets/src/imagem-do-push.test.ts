/**
 * A imagem do push sai pronta para o celular — conferido com imagens de
 * verdade, geradas pelo sharp, e lendo de volta o que saiu.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LADO_MAXIMO_DO_PUSH, prepararImagemDoPush } from './imagem-do-push';

function imagem(
  largura: number,
  altura: number,
  formato: 'png' | 'jpeg' | 'webp' = 'png',
  alfa = false,
): Promise<Buffer> {
  const base = sharp({
    create: {
      width: largura,
      height: altura,
      channels: alfa ? 4 : 3,
      background: alfa ? { r: 29, g: 78, b: 216, alpha: 0 } : '#1d4ed8',
    },
  });
  return formato === 'png'
    ? base.png().toBuffer()
    : formato === 'jpeg'
      ? base.jpeg().toBuffer()
      : base.webp().toBuffer();
}

describe('prepararImagemDoPush', () => {
  it('uma imagem 2:1 sai em JPEG, do mesmo tamanho, marcada como ideal', async () => {
    const resultado = await prepararImagemDoPush(await imagem(1440, 720));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.largura).toBe(1440);
    expect(resultado.altura).toBe(720);
    expect(resultado.proporcaoIdeal).toBe(true);
    expect((await sharp(resultado.jpeg).metadata()).format).toBe('jpeg');
  });

  it('foto grande é reduzida para caber em 1440 sem mudar a proporção', async () => {
    const resultado = await prepararImagemDoPush(await imagem(4000, 3000, 'jpeg'));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.largura).toBe(LADO_MAXIMO_DO_PUSH);
    expect(resultado.altura).toBe(1080);
    // 4:3 fica longe de 2:1: o Android vai cortar as bordas.
    expect(resultado.proporcaoIdeal).toBe(false);
  });

  it('imagem menor que o máximo não é esticada', async () => {
    const resultado = await prepararImagemDoPush(await imagem(800, 400, 'webp'));
    expect(resultado.ok && resultado.largura).toBe(800);
  });

  it('fundo transparente vira branco, e não o preto de muitos Androids', async () => {
    const resultado = await prepararImagemDoPush(await imagem(800, 400, 'png', true));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const { data } = await sharp(resultado.jpeg)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data].every((canal) => canal > 245)).toBe(true);
  });

  it('a foto do celular chega em pé: a orientação da câmera é aplicada', async () => {
    // Guardada deitada (1000 × 500) com a marca "girar 90°" que as câmeras usam.
    const deitada = await sharp(await imagem(1000, 500, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const resultado = await prepararImagemDoPush(deitada);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.largura).toBe(500);
    expect(resultado.altura).toBe(1000);
  });

  it('pequena demais é recusada, com o motivo', async () => {
    expect(await prepararImagemDoPush(await imagem(300, 150))).toEqual({
      ok: false,
      problema: 'pequena',
    });
  });

  it('o que não é imagem é recusado', async () => {
    expect(await prepararImagemDoPush(Buffer.from('não sou uma imagem'))).toEqual({
      ok: false,
      problema: 'naoEImagem',
    });
  });
});
