/**
 * Imagens de verdade para os testes que enviam arquivo: um PNG de cor lisa,
 * montado byte a byte (assinatura, cabeçalho, dados comprimidos e fim), sem
 * depender de biblioteca de imagem. O servidor abre com o mesmo código que
 * abre a foto do lojista — é isso que o teste precisa exercitar.
 */
import { crc32, deflateSync } from 'node:zlib';

function pedaco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const tipoEDados = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(tipoEDados));
  return Buffer.concat([tamanho, tipoEDados, verificacao]);
}

/** Um PNG RGB de `largura` × `altura`, todo da mesma cor. */
export function pngDeCorLisa(
  largura: number,
  altura: number,
  cor: readonly [number, number, number] = [29, 78, 216],
): Buffer {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; // 8 bits por canal
  cabecalho[9] = 2; // RGB

  // Cada linha começa com o byte do filtro (0, nenhum) e segue com os pixels.
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x += 1) {
    linha[1 + x * 3] = cor[0];
    linha[2 + x * 3] = cor[1];
    linha[3 + x * 3] = cor[2];
  }
  const pixels = Buffer.concat(Array.from({ length: altura }, () => linha));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', deflateSync(pixels)),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}
