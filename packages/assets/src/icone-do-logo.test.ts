/**
 * O ícone que sai do logo do site passa na mesma conferência do ícone enviado
 * à mão — conferido com imagens de verdade, geradas pelo sharp, e lendo de
 * volta o que saiu.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analisarIcone, problemasDoIcone, TAMANHO_DO_ICONE } from './icones';
import { FRACAO_DO_LOGO, fundoDoLogo, iconeDoLogo } from './icone-do-logo';

/** Um retângulo de uma cor sobre fundo transparente, com margem vazia em volta. */
async function logoTransparente(
  largura: number,
  altura: number,
  cor: string,
  margem = 40,
): Promise<Buffer> {
  const desenho = await sharp({
    create: { width: largura, height: altura, channels: 3, background: cor },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: largura + margem * 2,
      height: altura + margem * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: desenho, left: margem, top: margem }])
    .png()
    .toBuffer();
}

/** A cor de um pixel do ícone, em hex. */
async function corEm(icone: Buffer, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(icone).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return `#${[data[i], data[i + 1], data[i + 2]]
    .map((c) => (c ?? 0).toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('iconeDoLogo', () => {
  it('logo escuro e transparente vira um ícone 1024 no branco, que a Apple aceita', async () => {
    const resultado = await iconeDoLogo(await logoTransparente(800, 240, '#1d4ed8'));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.fundo).toBe('#ffffff');
    const analise = await analisarIcone(resultado.icone);
    expect(analise).toMatchObject({
      largura: TAMANHO_DO_ICONE,
      altura: TAMANHO_DO_ICONE,
      temTransparencia: false,
    });
    expect(problemasDoIcone(analise)).toEqual([]);
    // O canto é fundo; o centro é o logo.
    expect(await corEm(resultado.icone, 5, 5)).toBe('#ffffff');
    expect(await corEm(resultado.icone, 512, 512)).toBe('#1d4ed8');
  });

  /*
   * O logo fica dentro da área que TODO formato de Android mostra: a margem
   * em volta foi aparada, e o desenho não chega perto da borda do ícone.
   */
  it('o logo ocupa o miolo seguro, sem a margem vazia do arquivo', async () => {
    const resultado = await iconeDoLogo(await logoTransparente(800, 800, '#000000', 300));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    const limite = Math.floor((TAMANHO_DO_ICONE * (1 - FRACAO_DO_LOGO)) / 2);
    expect(await corEm(resultado.icone, limite - 4, 512)).toBe('#ffffff');
    expect(await corEm(resultado.icone, limite + 8, 512)).toBe('#000000');
  });

  it('logo branco vai na cor da marca quando ela é escura, e num quase preto quando não é', async () => {
    const branco = await logoTransparente(900, 300, '#ffffff');

    const naMarca = await iconeDoLogo(branco, '#0f3d2e');
    expect(naMarca.ok && naMarca.fundo).toBe('#0f3d2e');

    const marcaClara = await iconeDoLogo(branco, '#ffe08a');
    expect(marcaClara.ok && marcaClara.fundo).toBe('#111111');

    const semMarca = await iconeDoLogo(branco, null);
    expect(semMarca.ok && semMarca.fundo).toBe('#111111');
  });

  it('logo com fundo próprio continua com ele', async () => {
    const opaco = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#c81e1e' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 400, height: 160, channels: 3, background: '#ffffff' },
          })
            .png()
            .toBuffer(),
          gravity: 'center',
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    const resultado = await iconeDoLogo(opaco);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // JPEG arredonda cor: perto do vermelho da moldura, e o canto do ícone igual.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(resultado.fundo.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(190);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
    expect(await corEm(resultado.icone, 3, 3)).toBe(resultado.fundo);
    expect(problemasDoIcone(await analisarIcone(resultado.icone))).toEqual([]);
  });

  it('logo pequeno demais é recusado, em vez de virar um ícone borrado', async () => {
    const touchIcon = await sharp({
      create: { width: 180, height: 180, channels: 3, background: '#1d4ed8' },
    })
      .png()
      .toBuffer();
    expect(await iconeDoLogo(touchIcon)).toEqual({ ok: false, problema: 'pequeno' });

    // Arquivo grande, desenho pequeno: o que conta é o desenho, depois de aparado.
    expect(await iconeDoLogo(await logoTransparente(100, 100, '#000000', 600))).toEqual({
      ok: false,
      problema: 'pequeno',
    });
  });

  it('o que não é imagem é recusado', async () => {
    expect(await iconeDoLogo(Buffer.from('<html>não é imagem</html>'))).toEqual({
      ok: false,
      problema: 'naoEImagem',
    });
  });
});

describe('fundoDoLogo', () => {
  it('segue a regra: opaco usa a moldura; transparente escuro, o branco; claro, a marca escura', () => {
    expect(fundoDoLogo({ transparente: false, luz: 0.9, moldura: '#223344' }, null)).toBe(
      '#223344',
    );
    expect(fundoDoLogo({ transparente: true, luz: 0.2, moldura: '#000000' }, '#000000')).toBe(
      '#ffffff',
    );
    expect(fundoDoLogo({ transparente: true, luz: 0.95, moldura: '#000000' }, '#123')).toBe(
      '#112233',
    );
    expect(fundoDoLogo({ transparente: true, luz: 0.95, moldura: '#000000' }, 'azul')).toBe(
      '#111111',
    );
  });
});
