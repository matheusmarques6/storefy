/**
 * Validação e geração dos ícones de uma loja.
 *
 * Cada função aqui existe por causa de uma recusa concreta da Apple ou do
 * Google. Elas são caras: a resposta vem dias depois, num e-mail que raramente
 * diz o que está errado de verdade.
 */
import sharp, { type Metadata, type Sharp } from 'sharp';

/** Mínimo da App Store. Escalar para cima produz um ícone borrado. */
export const TAMANHO_DO_ICONE = 1024;

/**
 * Quanto do ícone adaptativo do Android fica garantido na tela.
 *
 * O Android recorta o ícone adaptativo em círculo, quadrado arredondado ou
 * gota, conforme o fabricante. Só os 66% centrais aparecem em TODOS os
 * formatos; o resto pode ser cortado. Sem essa margem, a logo do lojista sai
 * com as bordas comidas nos celulares Samsung e não nos Pixel.
 */
export const PROPORCAO_SEGURA_DO_ADAPTATIVO = 0.66;

export const ERROS = {
  naoEImagem: 'O arquivo enviado não é uma imagem que a gente consiga ler.',
  pequeno: `O ícone precisa ter pelo menos ${String(TAMANHO_DO_ICONE)}×${String(TAMANHO_DO_ICONE)} pixels. A App Store exige esse tamanho.`,
  naoQuadrado: 'O ícone precisa ser quadrado: a mesma medida de largura e de altura.',
  transparente:
    'O ícone não pode ter fundo transparente — a Apple recusa. Ponha uma cor de fundo sólida.',
  arredondado:
    'O ícone parece já ter cantos arredondados. Envie o desenho quadrado: o iPhone e o Android arredondam sozinhos, e um já arredondado fica com uma borda escura em volta.',
} as const;

export type ProblemaDoIcone = keyof typeof ERROS;

export interface AnaliseDoIcone {
  largura: number;
  altura: number;
  /** Tem canal alfa com pixels realmente transparentes? */
  temTransparencia: boolean;
  /** Os quatro cantos estão transparentes, como num ícone já arredondado? */
  cantosVazados: boolean;
}

/**
 * Lê o que interessa de um ícone.
 *
 * `temTransparencia` não é só "tem canal alfa": muita exportação de PNG traz
 * o canal com tudo opaco, e recusar isso seria recusar um ícone bom.
 */
export async function analisarIcone(dados: Buffer): Promise<AnaliseDoIcone | null> {
  let imagem: Sharp;
  let meta: Metadata;
  try {
    imagem = sharp(dados);
    meta = await imagem.metadata();
  } catch {
    return null;
  }

  const { width: largura, height: altura } = meta;
  // Zero acontece com arquivo truncado, que o sharp lê sem reclamar.
  if (largura === 0 || altura === 0) return null;

  if (!meta.hasAlpha) {
    return { largura, altura, temTransparencia: false, cantosVazados: false };
  }

  // O canal alfa existe; falta saber se ele é usado.
  const alfa = await sharp(dados).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const minimo = await sharp(alfa, { raw: { width: largura, height: altura, channels: 1 } })
    .stats()
    .then((s) => s.channels[0]?.min ?? 255)
    .catch(() => 255);

  const temTransparencia = minimo < 255;

  return {
    largura,
    altura,
    temTransparencia,
    cantosVazados: temTransparencia && cantosEstaoVazados(alfa, largura, altura),
  };
}

/**
 * O ícone já veio com as pontas arredondadas?
 *
 * Duas coisas precisam ser verdade ao mesmo tempo, e é a segunda que separa
 * este caso do outro:
 *
 *   os quatro CANTOS estão vazados — como num ícone arredondado;
 *   os quatro MEIOS DE BORDA estão cheios — porque um ícone arredondado
 *   encosta na borda no meio de cada lado.
 *
 * Sem a segunda condição, uma logo solta num fundo transparente cairia aqui:
 * ela também tem os cantos vazios. E o conserto das duas é diferente — uma
 * pede o desenho quadrado, a outra pede uma cor de fundo —, então dar a
 * mensagem errada faz o lojista trabalhar no lugar errado.
 *
 * As medições são sobre quadradinhos de 3% do lado, e não sobre um pixel: o
 * antisserrilhado da borda daria falso positivo num pixel só.
 */
function cantosEstaoVazados(alfa: Buffer, largura: number, altura: number): boolean {
  const lado = Math.max(2, Math.round(Math.min(largura, altura) * 0.03));
  const meioX = Math.round((largura - lado) / 2);
  const meioY = Math.round((altura - lado) / 2);

  const cantos = (
    [
      [0, 0],
      [largura - lado, 0],
      [0, altura - lado],
      [largura - lado, altura - lado],
    ] as const
  ).map(([esquerda, topo]) => mediaDoRecorte(alfa, largura, esquerda, topo, lado));

  const bordas = (
    [
      [meioX, 0],
      [meioX, altura - lado],
      [0, meioY],
      [largura - lado, meioY],
    ] as const
  ).map(([esquerda, topo]) => mediaDoRecorte(alfa, largura, esquerda, topo, lado));

  return cantos.every((media) => media < 32) && bordas.every((media) => media > 224);
}

/**
 * Média de um pedaço do canal alfa, lida direto dos bytes.
 *
 * NÃO usar `sharp(...).extract(...).stats()` aqui: `stats()` do sharp mede a
 * imagem de ENTRADA e ignora o que veio antes na esteira, então o recorte é
 * descartado em silêncio e os quatro cantos devolvem a média da imagem
 * inteira — todos iguais, e a detecção nunca dispara. Ler o buffer é exato,
 * mais rápido e não depende desse detalhe.
 */
function mediaDoRecorte(
  alfa: Buffer,
  largura: number,
  esquerda: number,
  topo: number,
  lado: number,
): number {
  let soma = 0;
  for (let y = topo; y < topo + lado; y += 1) {
    for (let x = esquerda; x < esquerda + lado; x += 1) {
      soma += alfa[y * largura + x] ?? 0;
    }
  }
  return soma / (lado * lado);
}

/** Todos os problemas do ícone, na ordem em que vale a pena resolvê-los. */
export function problemasDoIcone(analise: AnaliseDoIcone | null): ProblemaDoIcone[] {
  if (analise === null) return ['naoEImagem'];

  const problemas: ProblemaDoIcone[] = [];

  if (analise.largura !== analise.altura) problemas.push('naoQuadrado');
  if (analise.largura < TAMANHO_DO_ICONE || analise.altura < TAMANHO_DO_ICONE) {
    problemas.push('pequeno');
  }
  if (analise.cantosVazados) problemas.push('arredondado');
  else if (analise.temTransparencia) problemas.push('transparente');

  return problemas;
}

export interface AssetsGerados {
  /** Ícone da App Store e da Play Store: 1024×1024, sem alfa. */
  icone: Buffer;
  /** Camada de frente do ícone adaptativo do Android, com a margem segura. */
  adaptativo: Buffer;
  /**
   * Ícone da notificação no Android: silhueta branca sobre transparente.
   *
   * O Android pinta esse arquivo com a cor de destaque e IGNORA as cores dele.
   * Mandar o ícone colorido produz um quadrado branco sólido na barra de
   * status — o defeito visual mais comum em app feito às pressas.
   */
  notificacao: Buffer;
  /** Tela de abertura, quando o lojista enviou uma. */
  splash: Buffer | null;
}

export interface OpcoesDaGeracao {
  icone: Buffer;
  splash?: Buffer | null;
  /** Cor que preenche o fundo quando o ícone tem transparência. */
  corDeFundo: string;
}

/**
 * Gera os arquivos que o `app.config.ts` aponta.
 *
 * Achata o alfa contra a cor de fundo da loja em vez de recusar: quando o
 * lojista chega aqui, os problemas já foram mostrados por `problemasDoIcone`,
 * e nesta etapa o objetivo é produzir algo que a loja aceite.
 */
export async function gerarAssets(opcoes: OpcoesDaGeracao): Promise<AssetsGerados> {
  const fundo = corValida(opcoes.corDeFundo) ? opcoes.corDeFundo : '#ffffff';

  const icone = await sharp(opcoes.icone)
    .resize(TAMANHO_DO_ICONE, TAMANHO_DO_ICONE, { fit: 'cover' })
    // `flatten` tira o alfa contra a cor: é o que a Apple exige.
    .flatten({ background: fundo })
    .png()
    .toBuffer();

  /*
   * O adaptativo entra reduzido dentro de uma tela cheia: a arte fica na área
   * que o Android garante, e o resto é fundo. Sem isso, cada fabricante come
   * um pedaço diferente da logo.
   */
  const interno = Math.round(TAMANHO_DO_ICONE * PROPORCAO_SEGURA_DO_ADAPTATIVO);
  const margem = Math.round((TAMANHO_DO_ICONE - interno) / 2);

  const adaptativo = await sharp({
    create: {
      width: TAMANHO_DO_ICONE,
      height: TAMANHO_DO_ICONE,
      channels: 4,
      background: fundo,
    },
  })
    .composite([
      {
        input: await sharp(opcoes.icone)
          .resize(interno, interno, { fit: 'contain' })
          .png()
          .toBuffer(),
        left: margem,
        top: margem,
      },
    ])
    .png()
    .toBuffer();

  const notificacao = await gerarIconeDeNotificacao(opcoes.icone);

  const splash =
    opcoes.splash == null
      ? null
      : await sharp(opcoes.splash)
          .resize(1284, 2778, { fit: 'contain', background: fundo })
          .png()
          .toBuffer();

  return { icone, adaptativo, notificacao, splash };
}

/**
 * Silhueta branca do ícone, para a barra de status do Android.
 *
 * O caminho é: tirar a cor, virar a luminosidade em máscara e pintar tudo de
 * branco com essa máscara no alfa. O que era escuro no ícone vira branco
 * opaco; o que era claro vira transparente.
 */
async function gerarIconeDeNotificacao(icone: Buffer): Promise<Buffer> {
  const lado = 96;

  const mascara = await sharp(icone)
    .resize(lado, lado, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .greyscale()
    // Escuro vira opaco: é o desenho que interessa.
    .negate({ alpha: false })
    .raw()
    .toBuffer();

  return sharp({
    create: { width: lado, height: lado, channels: 3, background: '#ffffff' },
  })
    .joinChannel(mascara, { raw: { width: lado, height: lado, channels: 1 } })
    .png()
    .toBuffer();
}

/** Cor hexadecimal de 3 ou 6 dígitos. */
export function corValida(cor: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cor.trim());
}
