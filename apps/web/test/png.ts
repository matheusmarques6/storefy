/**
 * PNGs de verdade para os testes de unidade, montados byte a byte — sem
 * biblioteca de imagem, que o painel não tem como dependência. O servidor
 * abre com o mesmo código que abre a imagem do lojista, e é isso que o teste
 * precisa exercitar.
 */
import { crc32, deflateSync } from 'node:zlib';

type Pixel = readonly [number, number, number, number];

function pedaco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const tipoEDados = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(tipoEDados));
  return Buffer.concat([tamanho, tipoEDados, verificacao]);
}

/** Um PNG RGBA, pintado pixel a pixel. */
export function pngRgba(
  largura: number,
  altura: number,
  pintar: (x: number, y: number) => Pixel,
): Buffer {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // 8 bits por canal
  cabecalho[9] = 6; // RGBA

  const linhas: Buffer[] = [];
  for (let y = 0; y < altura; y += 1) {
    // Cada linha começa com o byte do filtro (0, nenhum).
    const linha = Buffer.alloc(1 + largura * 4);
    for (let x = 0; x < largura; x += 1) {
      const [r, g, b, a] = pintar(x, y);
      linha[1 + x * 4] = r;
      linha[2 + x * 4] = g;
      linha[3 + x * 4] = b;
      linha[4 + x * 4] = a;
    }
    linhas.push(linha);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', deflateSync(Buffer.concat(linhas))),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/** Um retângulo de cor sobre fundo transparente, com `margem` vazia em volta. */
export function logoTransparente(
  largura: number,
  altura: number,
  cor: readonly [number, number, number] = [29, 78, 216],
  margem = 20,
): Buffer {
  return pngRgba(largura + margem * 2, altura + margem * 2, (x, y) =>
    x >= margem && x < largura + margem && y >= margem && y < altura + margem
      ? [cor[0], cor[1], cor[2], 255]
      : [0, 0, 0, 0],
  );
}
