/**
 * O vídeo do passo a passo de cada conta (C13): "Wizards passo a passo com
 * vídeo", no plano.
 *
 * O vídeo é gravado pela equipe (tela do App Store Connect, do Play Console)
 * e publicado no YouTube, no Vimeo ou no Loom; a A13 guarda o link, e a tela
 * de contas o mostra embutido. Sem link, a tela fica só com os passos
 * escritos — nunca um player vazio.
 *
 * SÓ ESSES TRÊS, e sempre pelo endereço de incorporar deles. O link vai para
 * um `<iframe>` na tela de TODO lojista: aceitar qualquer endereço seria pôr
 * uma página de fora dentro do painel. O YouTube entra pelo domínio sem
 * cookies (`youtube-nocookie.com`): o lojista que só abriu a tela não é
 * rastreado por isso.
 */

export type VideoConferido = { ok: true; link: string } | { ok: false; mensagem: string };

/** Id do YouTube: 11 caracteres de letra, número, `-` e `_`. */
const ID_DO_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;
const ID_DO_VIMEO = /^\d{6,12}$/;
const ID_DO_LOOM = /^[0-9a-f]{32}$/i;

/** O vídeo que o link aponta, em qualquer das formas que cada serviço usa. */
function videoDoLink(url: URL): { servico: 'youtube' | 'vimeo' | 'loom'; id: string } | null {
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const partes = url.pathname.split('/').filter((parte) => parte !== '');

  if (host === 'youtu.be') {
    const id = partes[0] ?? '';
    return ID_DO_YOUTUBE.test(id) ? { servico: 'youtube', id } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      partes[0] === 'watch'
        ? (url.searchParams.get('v') ?? '')
        : partes[0] === 'embed' || partes[0] === 'shorts' || partes[0] === 'live'
          ? (partes[1] ?? '')
          : '';
    return ID_DO_YOUTUBE.test(id) ? { servico: 'youtube', id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = host === 'player.vimeo.com' ? (partes[1] ?? '') : (partes[0] ?? '');
    return ID_DO_VIMEO.test(id) ? { servico: 'vimeo', id } : null;
  }
  if (host === 'loom.com') {
    const id = partes[0] === 'share' || partes[0] === 'embed' ? (partes[1] ?? '') : '';
    return ID_DO_LOOM.test(id) ? { servico: 'loom', id } : null;
  }
  return null;
}

/**
 * O link digitado na A13, conferido e guardado já no endereço de incorporar.
 * Vazio é válido: tira o vídeo da tela.
 */
export function conferirVideo(bruto: string, conta: 'Apple' | 'Google'): VideoConferido {
  const texto = bruto.trim();
  if (texto === '') return { ok: true, link: '' };
  const daConta = conta === 'Apple' ? 'da Apple' : 'do Google';

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, mensagem: `O vídeo ${daConta} não é um endereço válido.` };
  }
  const video = url.protocol === 'https:' ? videoDoLink(url) : null;
  if (video === null) {
    return {
      ok: false,
      mensagem: `O vídeo ${daConta} precisa ser um link do YouTube, do Vimeo ou do Loom, começando com https://.`,
    };
  }
  return { ok: true, link: enderecoDeIncorporar(video) };
}

function enderecoDeIncorporar(video: {
  servico: 'youtube' | 'vimeo' | 'loom';
  id: string;
}): string {
  switch (video.servico) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${video.id}`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${video.id}`;
    case 'loom':
      return `https://www.loom.com/embed/${video.id}`;
  }
}
