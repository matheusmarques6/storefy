/**
 * O ícone do app a partir do logo do site (C03: "confirma logo").
 *
 * O logo que o site declara quase nunca passa como ícone: o `apple-touch-icon`
 * tem 180 px, o logo do cabeçalho é retangular e transparente, e a Apple
 * recusa os três (tamanho, proporção, transparência). Aqui ele vira um ícone
 * que passa: um quadrado de 1024 px, com fundo sólido e o logo no meio.
 *
 * O LOGO FICA DENTRO DA ÁREA SEGURA do ícone adaptativo do Android — só os
 * 66% centrais aparecem em todo formato de fabricante. Encostado na borda, ele
 * sairia cortado no Samsung e inteiro no Pixel.
 *
 * O FUNDO NÃO É CHUTE sobre a marca de ninguém: é a cor que o próprio logo
 * pede. Logo com fundo próprio (JPG, PNG opaco) continua com ele; logo
 * transparente escuro vai no branco; claro — o logo branco dos cabeçalhos
 * escuros — vai na cor da marca, se ela for escura o bastante para ele
 * aparecer, ou num quase preto. O lojista vê o resultado na prévia e troca
 * se quiser.
 */
import sharp from 'sharp';
import { PROPORCAO_SEGURA_DO_ADAPTATIVO, TAMANHO_DO_ICONE } from './icones';

/**
 * O menor logo aceito, pelo lado maior. Ele vai ocupar ~600 px do ícone;
 * esticar um de 180 daria um ícone borrado na tela inicial do cliente.
 */
export const MENOR_LOGO = 320;

/** Quanto do ícone o logo ocupa: um pouco dentro da área segura do Android. */
export const FRACAO_DO_LOGO = PROPORCAO_SEGURA_DO_ADAPTATIVO - 0.06;

/** Um pixel conta como transparente abaixo disto. */
const ALFA_OPACO = 200;

export const ERROS_DO_LOGO = {
  naoEImagem: 'O logo do site não é uma imagem que a gente consiga ler.',
  pequeno:
    'O logo do site é pequeno demais para virar um ícone nítido. Envie um ícone de 1024×1024.',
} as const;

export type ProblemaDoLogo = keyof typeof ERROS_DO_LOGO;

export type IconeDoLogo =
  { ok: true; icone: Buffer; fundo: string } | { ok: false; problema: ProblemaDoLogo };

/** Luminância relativa de 0 a 1, pela fórmula do sRGB. */
function luminancia(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((canal) => Math.round(canal).toString(16).padStart(2, '0')).join('')}`;
}

/** `#rgb` e `#rrggbb` viram canais. Qualquer outra coisa, `null`. */
function canais(cor: string | null): [number, number, number] | null {
  if (cor === null) return null;
  const limpa = cor.trim().toLowerCase();
  const curta = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(limpa);
  if (curta !== null) {
    return [curta[1], curta[2], curta[3]].map((c) =>
      Number.parseInt(`${c ?? '0'}${c ?? '0'}`, 16),
    ) as [number, number, number];
  }
  const longa = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(limpa);
  if (longa === null) return null;
  return [longa[1], longa[2], longa[3]].map((c) => Number.parseInt(c ?? '0', 16)) as [
    number,
    number,
    number,
  ];
}

interface Leitura {
  /** Uma fatia relevante dos pixels é transparente? */
  transparente: boolean;
  /** Luminância média dos pixels opacos. */
  luz: number;
  /** A cor média da moldura de 2 px — o fundo de um logo opaco. */
  moldura: string;
}

/** Lê os pixels de uma miniatura: é o bastante para decidir o fundo. */
async function ler(imagem: Buffer): Promise<Leitura> {
  const { data, info } = await sharp(imagem)
    .ensureAlpha()
    .resize(128, 128, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: largura, height: altura } = info;
  let transparentes = 0;
  let opacos = 0;
  let somaDaLuz = 0;
  const moldura = [0, 0, 0];
  let naMoldura = 0;

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 4;
      const [r = 0, g = 0, b = 0, a = 0] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < ALFA_OPACO) {
        transparentes += 1;
      } else {
        opacos += 1;
        somaDaLuz += luminancia(r, g, b);
      }
      if (x < 2 || y < 2 || x >= largura - 2 || y >= altura - 2) {
        moldura[0] = (moldura[0] ?? 0) + r;
        moldura[1] = (moldura[1] ?? 0) + g;
        moldura[2] = (moldura[2] ?? 0) + b;
        naMoldura += 1;
      }
    }
  }

  const total = largura * altura;
  return {
    transparente: transparentes / total > 0.02,
    luz: opacos === 0 ? 0 : somaDaLuz / opacos,
    moldura: hex(
      (moldura[0] ?? 0) / Math.max(naMoldura, 1),
      (moldura[1] ?? 0) / Math.max(naMoldura, 1),
      (moldura[2] ?? 0) / Math.max(naMoldura, 1),
    ),
  };
}

/** O fundo que o logo pede. Exportado para o teste ler a regra. */
export function fundoDoLogo(leitura: Leitura, corDaMarca: string | null): string {
  if (!leitura.transparente) return leitura.moldura;
  // Logo escuro ou colorido: o branco é o fundo em que ele foi desenhado.
  if (leitura.luz < 0.7) return '#ffffff';
  // Logo claro: precisa de fundo escuro. A cor da marca, se ela for escura.
  const marca = canais(corDaMarca);
  if (marca !== null && luminancia(...marca) <= 0.35) return hex(...marca);
  return '#111111';
}

/**
 * Compõe o ícone. `corDaMarca` é a cor principal do app, usada só como fundo
 * de logo claro.
 */
export async function iconeDoLogo(
  bytes: Buffer,
  corDaMarca: string | null = null,
): Promise<IconeDoLogo> {
  let base: Buffer;
  try {
    // `rotate()` sem argumento aplica a orientação da câmera, se houver.
    base = await sharp(bytes).rotate().png().toBuffer();
  } catch {
    return { ok: false, problema: 'naoEImagem' };
  }

  const leitura = await ler(base);
  const fundo = fundoDoLogo(leitura, corDaMarca);

  /*
   * Tira a margem vazia (ou do fundo próprio) em volta do desenho: um logo
   * num quadro grande de sobra ficaria minúsculo no meio do ícone. O `trim`
   * falha em imagem de uma cor só, e aí fica a imagem inteira.
   */
  let desenho = base;
  try {
    desenho = await sharp(base).trim({ threshold: 12 }).png().toBuffer();
  } catch {
    desenho = base;
  }

  const meta = await sharp(desenho).metadata();
  const maiorLado = Math.max(meta.width, meta.height);
  if (maiorLado < MENOR_LOGO) return { ok: false, problema: 'pequeno' };

  const caixa = Math.round(TAMANHO_DO_ICONE * FRACAO_DO_LOGO);
  const logo = await sharp(desenho)
    .resize(caixa, caixa, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const icone = await sharp({
    create: {
      width: TAMANHO_DO_ICONE,
      height: TAMANHO_DO_ICONE,
      channels: 3,
      background: fundo,
    },
  })
    .composite([{ input: logo, gravity: 'center' }])
    // Sem canal alfa nenhum: a Apple recusa ícone com transparência.
    .flatten({ background: fundo })
    .removeAlpha()
    .png()
    .toBuffer();

  return { ok: true, icone, fundo };
}
