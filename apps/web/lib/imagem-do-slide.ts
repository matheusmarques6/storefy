import 'server-only';

/**
 * A imagem do slide de boas-vindas (C06d): do arquivo que o lojista escolheu
 * até o endereço que o app baixa (M02).
 *
 * O arquivo chega pela ação do servidor, é reprocessado por
 * `prepararImagemDoSlide` (gira, reduz, mantém a transparência de quem tem) e
 * vai para o bucket público `imagens-do-app`, com um nome aleatório dentro da
 * pasta da loja. A permissão é conferida por quem chama; a gravação usa a
 * service role, como a do ícone. As que nenhuma versão da config usa, o job
 * apaga (`imagens_do_app_sem_uso`).
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { ERROS_DA_IMAGEM_DO_SLIDE, prepararImagemDoSlide } from '@storefy/assets';
import { MENSAGEM_DE_IMAGEM_GRANDE, TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';

type Client = SupabaseClient<Database>;

export const BUCKET_DO_APP = 'imagens-do-app';

/** O que o navegador pode mandar: o servidor regrava em JPEG ou PNG. */
export const TIPOS_DA_IMAGEM_DO_SLIDE = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImagemDoSlideGuardada = { ok: true; url: string } | { ok: false; motivo: string };

export async function guardarImagemDoSlide(
  servico: Client,
  storeId: string,
  arquivo: { tipoMime: string; bytes: Uint8Array },
): Promise<ImagemDoSlideGuardada> {
  if (!(TIPOS_DA_IMAGEM_DO_SLIDE as readonly string[]).includes(arquivo.tipoMime)) {
    return { ok: false, motivo: 'Envie uma imagem JPG, PNG ou WebP.' };
  }
  if (arquivo.bytes.byteLength === 0) {
    return { ok: false, motivo: 'O arquivo chegou vazio. Tente enviar de novo.' };
  }
  // O teto é do arquivo ENVIADO; o guardado sai bem menor, reprocessado.
  if (arquivo.bytes.byteLength > TAMANHO_MAXIMO_DE_IMAGEM) {
    return { ok: false, motivo: MENSAGEM_DE_IMAGEM_GRANDE };
  }

  const preparada = await prepararImagemDoSlide(Buffer.from(arquivo.bytes));
  if (!preparada.ok) return { ok: false, motivo: ERROS_DA_IMAGEM_DO_SLIDE[preparada.problema] };

  const extensao = preparada.formato === 'png' ? 'png' : 'jpg';
  const caminho = `${storeId.toLowerCase()}/${randomUUID()}.${extensao}`;
  const { error } = await servico.storage.from(BUCKET_DO_APP).upload(caminho, preparada.dados, {
    contentType: preparada.formato === 'png' ? 'image/png' : 'image/jpeg',
    // Nome novo a cada envio: a imagem de uma versão publicada nunca é trocada por baixo.
    upsert: false,
    cacheControl: '31536000',
  });
  if (error != null) {
    return { ok: false, motivo: 'Não conseguimos guardar a imagem. Tente de novo.' };
  }

  return {
    ok: true,
    url: servico.storage.from(BUCKET_DO_APP).getPublicUrl(caminho).data.publicUrl,
  };
}
