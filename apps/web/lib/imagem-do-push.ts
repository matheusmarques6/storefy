import 'server-only';

/**
 * A imagem da campanha de push (C08): do arquivo que o lojista escolheu até o
 * endereço que a OneSignal baixa.
 *
 * O arquivo chega pela ação do servidor, é reprocessado por
 * `prepararImagemDoPush` (gira, reduz, tira a transparência, regrava em JPEG)
 * e vai para o bucket público `push-imagens`, com um nome aleatório dentro da
 * pasta da loja. A permissão é conferida por quem chama; a gravação usa a
 * service role, como a do ícone.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { ERROS_DA_IMAGEM_DO_PUSH, prepararImagemDoPush } from '@storefy/assets';
import { MENSAGEM_DE_IMAGEM_GRANDE, TAMANHO_MAXIMO_DE_IMAGEM } from '@/lib/limites-de-imagem';
import { log } from '@/lib/log';

type Client = SupabaseClient<Database>;

export const BUCKET_DO_PUSH = 'push-imagens';

/** O que o navegador pode mandar: o servidor converte tudo para JPEG. */
export const TIPOS_DA_IMAGEM_DO_PUSH = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImagemGuardada =
  { ok: true; caminho: string; url: string; aviso: string | null } | { ok: false; motivo: string };

/** O caminho que o servidor grava: `<store_id>/<uuid>.jpg`. Nada mais é aceito. */
export function caminhoDaImagemDaLoja(storeId: string, caminho: string): boolean {
  const pasta = storeId.toLowerCase();
  return (
    caminho.startsWith(`${pasta}/`) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(
      caminho.slice(pasta.length + 1),
    )
  );
}

/** O endereço público da imagem — o que a OneSignal e o celular baixam. */
export function urlDaImagemDoPush(supabase: Client, caminho: string): string {
  return supabase.storage.from(BUCKET_DO_PUSH).getPublicUrl(caminho).data.publicUrl;
}

export async function guardarImagemDoPush(
  servico: Client,
  storeId: string,
  arquivo: { tipoMime: string; bytes: Uint8Array },
): Promise<ImagemGuardada> {
  if (!(TIPOS_DA_IMAGEM_DO_PUSH as readonly string[]).includes(arquivo.tipoMime)) {
    return { ok: false, motivo: 'Envie uma imagem JPG, PNG ou WebP.' };
  }
  if (arquivo.bytes.byteLength === 0) {
    return { ok: false, motivo: 'O arquivo chegou vazio. Tente enviar de novo.' };
  }
  // O teto é do arquivo ENVIADO; o guardado sai bem menor, reprocessado.
  if (arquivo.bytes.byteLength > TAMANHO_MAXIMO_DE_IMAGEM) {
    return { ok: false, motivo: MENSAGEM_DE_IMAGEM_GRANDE };
  }

  const preparada = await prepararImagemDoPush(Buffer.from(arquivo.bytes));
  if (!preparada.ok) return { ok: false, motivo: ERROS_DA_IMAGEM_DO_PUSH[preparada.problema] };

  const caminho = `${storeId.toLowerCase()}/${randomUUID()}.jpg`;
  const { error } = await servico.storage.from(BUCKET_DO_PUSH).upload(caminho, preparada.jpeg, {
    contentType: 'image/jpeg',
    // Nome novo a cada envio: a imagem de uma campanha já enviada nunca é
    // trocada por baixo. As que sobram, o job apaga (`imagens_de_push_sem_campanha`).
    upsert: false,
    cacheControl: '31536000',
  });
  if (error != null) {
    return { ok: false, motivo: 'Não conseguimos guardar a imagem. Tente de novo.' };
  }

  return {
    ok: true,
    caminho,
    url: urlDaImagemDoPush(servico, caminho),
    aviso: preparada.proporcaoIdeal
      ? null
      : 'A imagem não está na proporção 2:1 (o dobro da largura pela altura). No Android, as bordas de cima e de baixo podem ficar cortadas.',
  };
}

/**
 * A imagem ainda está no bucket? O job apaga as que ficam um dia sem
 * campanha — um formulário esquecido aberto de um dia para o outro chegaria
 * aqui com uma imagem que não existe mais, e a notificação sairia sem ela.
 *
 * `null` é "não deu para conferir" (o Storage não respondeu): não é o mesmo
 * que a imagem ter sumido, e a tela diz coisas diferentes para cada um.
 */
export async function imagemDoPushExiste(
  servico: Client,
  caminho: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await servico.storage.from(BUCKET_DO_PUSH).exists(caminho);
    return error == null && data;
  } catch (erro) {
    // `exists` só devolve "não existe" para 400 e 404; o resto ele lança.
    log.erro('push.imagem-nao-conferida', { erro, caminho });
    return null;
  }
}
