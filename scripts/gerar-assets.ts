/**
 * Gera os assets de uma loja para o build (seção 7 do plano).
 *
 * Roda dentro do workflow `build-store-app.yml`, depois de baixar o ícone e a
 * tela de abertura que o lojista enviou. A lógica está em `@storefy/assets`,
 * com testes; aqui é só a conversa com o disco e com a linha de comando.
 *
 * Uso:
 *   tsx scripts/gerar-assets.ts --icone=icone.png --saida=apps/mobile/brands/<id> \
 *     [--splash=splash.png] [--cor=#1d4ed8]
 *
 * Sai com código 1 e uma lista do que está errado quando o ícone não serve.
 * Falhar aqui custa segundos; falhar na revisão da Apple custa dias.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ERROS, analisarIcone, gerarAssets, problemasDoIcone } from '@storefy/assets';

function argumento(nome: string): string | null {
  const prefixo = `--${nome}=`;
  const achado = process.argv.find((arg) => arg.startsWith(prefixo));
  return achado === undefined ? null : achado.slice(prefixo.length);
}

async function principal(): Promise<void> {
  const caminhoDoIcone = argumento('icone');
  const saida = argumento('saida');
  const caminhoDaSplash = argumento('splash');
  const cor = argumento('cor') ?? '#ffffff';

  if (caminhoDoIcone === null || saida === null) {
    console.error('Uso: tsx scripts/gerar-assets.ts --icone=<arquivo> --saida=<pasta>');
    process.exit(1);
  }

  const icone = await readFile(caminhoDoIcone);

  const problemas = problemasDoIcone(await analisarIcone(icone));
  if (problemas.length > 0) {
    console.error('O ícone enviado não serve:');
    for (const problema of problemas) console.error(`  - ${ERROS[problema]}`);
    process.exit(1);
  }

  const splash = caminhoDaSplash === null ? null : await readFile(caminhoDaSplash);
  const assets = await gerarAssets({ icone, splash, corDeFundo: cor });

  await mkdir(saida, { recursive: true });
  await writeFile(join(saida, 'icon.png'), assets.icone);
  await writeFile(join(saida, 'adaptive-icon.png'), assets.adaptativo);
  await writeFile(join(saida, 'notification-icon.png'), assets.notificacao);
  if (assets.splash !== null) await writeFile(join(saida, 'splash.png'), assets.splash);

  console.log(`Assets gerados em ${saida}`);
}

await principal();
