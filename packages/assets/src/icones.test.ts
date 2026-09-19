/**
 * Estes testes geram imagens de verdade com o sharp e conferem o que saiu.
 *
 * Dá para provar tudo daqui — não há rede nem serviço externo no caminho — e
 * vale a pena, porque cada recusa que este código evita custa DIAS: a Apple
 * responde num e-mail que raramente diz o que está errado de verdade.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  PROPORCAO_SEGURA_DO_ADAPTATIVO,
  TAMANHO_DO_ICONE,
  analisarIcone,
  corValida,
  gerarAssets,
  problemasDoIcone,
} from './icones';

/** Um ícone opaco: quadrado colorido, como um logo achatado. */
function iconeOpaco(lado = TAMANHO_DO_ICONE): Promise<Buffer> {
  return sharp({
    create: { width: lado, height: lado, channels: 3, background: '#1d4ed8' },
  })
    .png()
    .toBuffer();
}

/** Um ícone com fundo transparente, que a Apple recusa. */
function iconeTransparente(lado = TAMANHO_DO_ICONE): Promise<Buffer> {
  return sharp({
    create: { width: lado, height: lado, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: Math.round(lado / 2),
            height: Math.round(lado / 2),
            channels: 4,
            background: '#1d4ed8',
          },
        },
        left: Math.round(lado / 4),
        top: Math.round(lado / 4),
      },
    ])
    .png()
    .toBuffer();
}

/** Um ícone já arredondado: cheio no meio, vazado nos quatro cantos. */
async function iconeArredondado(lado = TAMANHO_DO_ICONE): Promise<Buffer> {
  const raio = Math.round(lado * 0.22);
  const mascara = Buffer.from(
    `<svg width="${String(lado)}" height="${String(lado)}"><rect width="${String(lado)}" height="${String(lado)}" rx="${String(raio)}" ry="${String(raio)}" fill="#fff"/></svg>`,
  );

  return sharp({
    create: { width: lado, height: lado, channels: 4, background: '#1d4ed8' },
  })
    .composite([{ input: mascara, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

describe('analisarIcone', () => {
  it('lê tamanho e transparência de um ícone opaco', async () => {
    const analise = await analisarIcone(await iconeOpaco());
    expect(analise).toMatchObject({
      largura: TAMANHO_DO_ICONE,
      altura: TAMANHO_DO_ICONE,
      temTransparencia: false,
      cantosVazados: false,
    });
  });

  it('enxerga a transparência quando ela existe', async () => {
    const analise = await analisarIcone(await iconeTransparente());
    expect(analise?.temTransparencia).toBe(true);
  });

  /*
   * Muita exportação de PNG traz o canal alfa com tudo opaco. Recusar isso
   * seria recusar um ícone bom — e o lojista não tem como saber que o canal
   * está lá.
   */
  it('canal alfa todo opaco NÃO conta como transparência', async () => {
    const comAlfaOpaco = await sharp({
      create: {
        width: TAMANHO_DO_ICONE,
        height: TAMANHO_DO_ICONE,
        channels: 4,
        background: '#1d4ed8',
      },
    })
      .png()
      .toBuffer();

    const analise = await analisarIcone(comAlfaOpaco);
    expect(analise?.temTransparencia).toBe(false);
  });

  it('reconhece o ícone que já veio arredondado', async () => {
    const analise = await analisarIcone(await iconeArredondado());
    expect(analise?.cantosVazados).toBe(true);
  });

  /*
   * Uma logo solta num fundo transparente também tem os cantos vazios, mas o
   * conserto é OUTRO: ela pede uma cor de fundo, o arredondado pede o desenho
   * quadrado. O que separa os dois é a borda — o arredondado encosta nela no
   * meio de cada lado, a logo solta não.
   */
  it('logo solta em fundo transparente NÃO é confundida com arredondada', async () => {
    const analise = await analisarIcone(await iconeTransparente());
    expect(analise?.temTransparencia).toBe(true);
    expect(analise?.cantosVazados).toBe(false);
  });

  it('arquivo que não é imagem devolve null em vez de estourar', async () => {
    for (const lixo of [Buffer.from('não é imagem'), Buffer.alloc(0), Buffer.alloc(100, 0xff)]) {
      await expect(analisarIcone(lixo)).resolves.toBeNull();
    }
  });
});

describe('problemasDoIcone', () => {
  it('ícone bom não tem problema', async () => {
    expect(problemasDoIcone(await analisarIcone(await iconeOpaco()))).toEqual([]);
  });

  it('ícone pequeno demais é barrado', async () => {
    expect(problemasDoIcone(await analisarIcone(await iconeOpaco(512)))).toContain('pequeno');
  });

  it('ícone retangular é barrado', async () => {
    const retangular = await sharp({
      create: { width: 1024, height: 512, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();

    expect(problemasDoIcone(await analisarIcone(retangular))).toContain('naoQuadrado');
  });

  it('transparência é barrada: a Apple recusa', async () => {
    expect(problemasDoIcone(await analisarIcone(await iconeTransparente()))).toContain(
      'transparente',
    );
  });

  /*
   * Arredondado e transparente têm a MESMA causa técnica (alfa), mas conserto
   * diferente: um pede cor de fundo, o outro pede o desenho quadrado. Dar a
   * mensagem errada faz o lojista pintar o fundo de um ícone que continuará
   * com a borda escura.
   */
  it('arredondado ganha a própria mensagem, e não a de transparência', async () => {
    const problemas = problemasDoIcone(await analisarIcone(await iconeArredondado()));
    expect(problemas).toContain('arredondado');
    expect(problemas).not.toContain('transparente');
  });

  it('arquivo ilegível vira um problema só, e claro', () => {
    expect(problemasDoIcone(null)).toEqual(['naoEImagem']);
  });
});

describe('gerarAssets', () => {
  it('o ícone sai 1024×1024 e SEM canal alfa', async () => {
    const { icone } = await gerarAssets({
      icone: await iconeTransparente(),
      corDeFundo: '#1d4ed8',
    });

    const meta = await sharp(icone).metadata();
    expect(meta.width).toBe(TAMANHO_DO_ICONE);
    expect(meta.height).toBe(TAMANHO_DO_ICONE);
    // É o que a Apple exige; com alfa, ela recusa com "Invalid Icon".
    expect(meta.hasAlpha).toBe(false);
  });

  it('achata a transparência contra a cor da loja, e não contra preto', async () => {
    const { icone } = await gerarAssets({
      icone: await iconeTransparente(),
      corDeFundo: '#ff0000',
    });

    // O canto era transparente; agora tem a cor escolhida.
    const canto = await sharp(icone)
      .extract({ left: 0, top: 0, width: 8, height: 8 })
      .raw()
      .toBuffer();
    expect(canto[0]).toBeGreaterThan(200);
    expect(canto[1]).toBeLessThan(60);
    expect(canto[2]).toBeLessThan(60);
  });

  it('cor inválida cai no branco em vez de estourar', async () => {
    for (const cor of ['', 'azul', '#12', 'rgb(0,0,0)']) {
      const { icone } = await gerarAssets({ icone: await iconeTransparente(), corDeFundo: cor });
      const canto = await sharp(icone)
        .extract({ left: 0, top: 0, width: 4, height: 4 })
        .raw()
        .toBuffer();
      expect(canto[0]).toBeGreaterThan(240);
    }
  });

  /*
   * O Android recorta o ícone adaptativo em círculo, quadrado arredondado ou
   * gota, conforme o fabricante. Só os 66% centrais aparecem em todos. Sem a
   * margem, a logo sai com as bordas comidas no Samsung e inteira no Pixel.
   */
  it('o adaptativo deixa a arte dentro da área segura', async () => {
    const { adaptativo } = await gerarAssets({ icone: await iconeOpaco(), corDeFundo: '#ffffff' });

    const meta = await sharp(adaptativo).metadata();
    expect(meta.width).toBe(TAMANHO_DO_ICONE);

    // A borda externa é fundo branco, não a arte azul.
    const borda = await sharp(adaptativo)
      .extract({ left: 0, top: 0, width: 16, height: 16 })
      .raw()
      .toBuffer();
    expect(borda[0]).toBeGreaterThan(240);
    expect(borda[2]).toBeGreaterThan(240);

    // E o centro é a arte.
    const centro = await sharp(adaptativo)
      .extract({
        left: TAMANHO_DO_ICONE / 2 - 8,
        top: TAMANHO_DO_ICONE / 2 - 8,
        width: 16,
        height: 16,
      })
      .raw()
      .toBuffer();
    expect(centro[2] ?? 0).toBeGreaterThan(centro[0] ?? 0);
  });

  it('a margem segura é a que o Android garante', () => {
    expect(PROPORCAO_SEGURA_DO_ADAPTATIVO).toBeLessThanOrEqual(0.72);
    expect(PROPORCAO_SEGURA_DO_ADAPTATIVO).toBeGreaterThanOrEqual(0.6);
  });

  /*
   * O Android pinta o ícone de notificação com a cor de destaque e IGNORA as
   * cores dele. Mandar o ícone colorido produz um quadrado branco sólido na
   * barra de status — o defeito visual mais comum em app feito às pressas.
   */
  it('o ícone de notificação sai como silhueta com alfa', async () => {
    const { notificacao } = await gerarAssets({
      icone: await iconeOpaco(),
      corDeFundo: '#ffffff',
    });

    const meta = await sharp(notificacao).metadata();
    expect(meta.width).toBe(96);
    expect(meta.hasAlpha).toBe(true);
  });

  /*
   * A DIREÇÃO da silhueta é o que importa, e é o que se inverte sem perceber.
   * O desenho tem de ficar OPACO e o fundo TRANSPARENTE. Ao contrário, o
   * Android desenha um retângulo sólido com um buraco no formato da logo — o
   * defeito visual mais comum em app feito às pressas, e ninguém percebe até
   * a primeira notificação chegar.
   *
   * O ícone daqui é uma marca escura num fundo claro, que é onde a inversão
   * aparece; um quadrado cheio não distingue os dois casos.
   */
  it('na silhueta, o desenho fica opaco e o fundo transparente', async () => {
    const lado = 1024;
    const marcaEscuraEmFundoClaro = await sharp({
      create: { width: lado, height: lado, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: {
            create: {
              width: Math.round(lado / 2),
              height: Math.round(lado / 2),
              channels: 3,
              background: '#101010',
            },
          },
          left: Math.round(lado / 4),
          top: Math.round(lado / 4),
        },
      ])
      .png()
      .toBuffer();

    const { notificacao } = await gerarAssets({
      icone: marcaEscuraEmFundoClaro,
      corDeFundo: '#ffffff',
    });

    const alfa = await sharp(notificacao).extractChannel('alpha').raw().toBuffer();
    const em = (x: number, y: number): number => alfa[y * 96 + x] ?? 0;

    // O centro é a marca escura: precisa estar opaco.
    expect(em(48, 48)).toBeGreaterThan(200);
    // O canto é o fundo claro: precisa estar transparente.
    expect(em(2, 2)).toBeLessThan(55);
  });

  it('sem tela de abertura, não inventa uma', async () => {
    const semSplash = await gerarAssets({ icone: await iconeOpaco(), corDeFundo: '#fff' });
    expect(semSplash.splash).toBeNull();

    const comSplash = await gerarAssets({
      icone: await iconeOpaco(),
      splash: await iconeOpaco(600),
      corDeFundo: '#fff',
    });
    expect(comSplash.splash).not.toBeNull();
  });

  it('aceita um ícone maior que o mínimo e reduz', async () => {
    const { icone } = await gerarAssets({ icone: await iconeOpaco(2048), corDeFundo: '#fff' });
    expect((await sharp(icone).metadata()).width).toBe(TAMANHO_DO_ICONE);
  });
});

describe('corValida', () => {
  it('aceita hex de 3 e de 6 dígitos', () => {
    for (const cor of ['#fff', '#FFF', '#1d4ed8', '#1D4ED8', '  #abc  ']) {
      expect(corValida(cor)).toBe(true);
    }
  });

  it('recusa o resto', () => {
    for (const cor of ['', 'azul', '#12', '#12345', 'rgb(0,0,0)', '1d4ed8']) {
      expect(corValida(cor)).toBe(false);
    }
  });
});
