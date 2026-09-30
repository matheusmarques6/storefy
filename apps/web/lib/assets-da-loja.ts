import 'server-only';

/**
 * Envio do ícone e da tela de abertura (C06a).
 *
 * O arquivo chega pela ação do servidor, é CONFERIDO com o mesmo código que o
 * build usa (`@storefy/assets`) e só então vai para o Storage. Conferir aqui é
 * o que transforma "seu app foi rejeitado" numa mensagem na hora do upload.
 *
 * A gravação usa a service role, mas a permissão é conferida por quem chama —
 * as policies do bucket cobrem o caminho do navegador, e este caminho é de
 * servidor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { ERROS, analisarIcone, problemasDoIcone } from '@storefy/assets';
import { MENSAGEM_DE_IMAGEM_GRANDE, TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';

type Client = SupabaseClient<Database>;

export const BUCKET = 'app-assets';

/** Os tipos que a Apple e o Google aceitam como origem. */
export const TIPOS_ACEITOS = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** 8 MB, o mesmo teto do bucket. */
export const TAMANHO_MAXIMO = TAMANHO_MAXIMO_DE_IMAGEM;

export type TipoDeAsset = 'icone' | 'splash';

/** O caminho de cada asset. Sempre dentro da pasta da loja. */
export function caminhoDoAsset(storeId: string, tipo: TipoDeAsset): string {
  return `${storeId}/${tipo === 'icone' ? 'icon-original' : 'splash-original'}.png`;
}

export type ResultadoDoEnvio = { ok: true; caminho: string } | { ok: false; motivo: string };

/**
 * Confere e guarda um asset.
 *
 * O ícone passa pela validação completa — tamanho, formato, transparência,
 * cantos arredondados. A tela de abertura não: ela pode ter transparência, não
 * tem exigência de proporção, e o build a encaixa no tamanho certo.
 */
export async function guardarAsset(
  servico: Client,
  storeId: string,
  tipo: TipoDeAsset,
  arquivo: { tipoMime: string; bytes: Uint8Array },
): Promise<ResultadoDoEnvio> {
  if (!(TIPOS_ACEITOS as readonly string[]).includes(arquivo.tipoMime)) {
    return { ok: false, motivo: 'Envie uma imagem PNG, JPG ou WebP.' };
  }
  if (arquivo.bytes.byteLength > TAMANHO_MAXIMO) {
    return { ok: false, motivo: MENSAGEM_DE_IMAGEM_GRANDE };
  }
  if (arquivo.bytes.byteLength === 0) {
    return { ok: false, motivo: 'O arquivo chegou vazio. Tente enviar de novo.' };
  }

  const dados = Buffer.from(arquivo.bytes);

  if (tipo === 'icone') {
    const problemas = problemasDoIcone(await analisarIcone(dados));
    if (problemas.length > 0) {
      // Um problema por vez: uma lista de quatro coisas ao mesmo tempo faz o
      // lojista não resolver nenhuma.
      return { ok: false, motivo: ERROS[problemas[0] ?? 'naoEImagem'] };
    }
  } else if ((await analisarIcone(dados)) === null) {
    return { ok: false, motivo: ERROS.naoEImagem };
  }

  const caminho = caminhoDoAsset(storeId, tipo);

  const { error } = await servico.storage.from(BUCKET).upload(caminho, dados, {
    contentType: arquivo.tipoMime,
    // Trocar o ícone sobrescreve: guardar versões antigas de imagem de marca
    // só acumularia arquivo que ninguém vai olhar.
    upsert: true,
  });

  if (error != null)
    return { ok: false, motivo: 'Não conseguimos guardar a imagem. Tente de novo.' };

  return { ok: true, caminho };
}

/**
 * Um link temporário para ver o asset.
 *
 * O bucket é privado, então a única forma de mostrar a imagem no painel é
 * assinando um link. Uma hora é o bastante para a pessoa olhar e trocar, e
 * curto o suficiente para o link não virar um endereço permanente se vazar do
 * histórico do navegador.
 */
export async function urlAssinada(
  supabase: Client,
  caminho: string | null,
  segundos = 3600,
): Promise<string | null> {
  if (caminho == null || caminho === '') return null;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, segundos);
  /*
   * O arquivo que sumiu (removido, e a coluna ficou para trás) é "sem imagem".
   * Qualquer outra falha lança: tratada como "sem imagem", ela levaria um
   * build sem o ícone da loja para a App Store, e a tela pediria para enviar
   * de novo uma imagem que está lá.
   */
  if (error != null) {
    if (ehArquivoQueNaoExiste(error)) return null;
    throw new Error(`Não foi possível assinar o link da imagem: ${error.message}`);
  }
  return data.signedUrl;
}

/** O storage responde 404 (ou "not found") para o arquivo que não existe. */
function ehArquivoQueNaoExiste(erro: { message: string; statusCode?: string | number }): boolean {
  return String(erro.statusCode ?? '') === '404' || /not.?found/i.test(erro.message);
}

/** Apaga o asset e limpa a coluna. */
export async function removerAsset(
  servico: Client,
  storeId: string,
  appId: string,
  tipo: TipoDeAsset,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { error: erroDoArquivo } = await servico.storage
    .from(BUCKET)
    .remove([caminhoDoAsset(storeId, tipo)]);
  // A imagem continua lá: limpar a coluna diria "removida" sobre uma imagem que o build ainda usaria.
  if (erroDoArquivo != null && !ehArquivoQueNaoExiste(erroDoArquivo)) {
    return { ok: false, motivo: 'Não conseguimos remover a imagem. Tente de novo.' };
  }

  const { error } = await servico
    .from('apps')
    .update(tipo === 'icone' ? { icon_path: null } : { splash_path: null })
    .eq('id', appId);

  return error == null ? { ok: true } : { ok: false, motivo: 'Não conseguimos remover a imagem.' };
}
