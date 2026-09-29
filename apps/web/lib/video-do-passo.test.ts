import { describe, expect, it } from 'vitest';
import { conferirVideo } from '@/lib/video-do-passo';

describe('conferirVideo', () => {
  it('cada forma do link do YouTube vira o endereço sem cookies', () => {
    const esperado = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ?si=abc  ',
    ]) {
      expect(conferirVideo(link, 'Apple'), link).toEqual({ ok: true, link: esperado });
    }
  });

  it('Vimeo e Loom, pelo player de cada um', () => {
    expect(conferirVideo('https://vimeo.com/123456789', 'Google')).toEqual({
      ok: true,
      link: 'https://player.vimeo.com/video/123456789',
    });
    expect(conferirVideo('https://player.vimeo.com/video/123456789', 'Google')).toEqual({
      ok: true,
      link: 'https://player.vimeo.com/video/123456789',
    });
    expect(
      conferirVideo('https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'Apple'),
    ).toEqual({ ok: true, link: 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef' });
  });

  it('vazio tira o vídeo da tela', () => {
    expect(conferirVideo('   ', 'Apple')).toEqual({ ok: true, link: '' });
  });

  /* O link vai para um iframe na tela de todo lojista: só o que é vídeo desses três serviços. */
  it('recusa o resto, dizendo o que aceita', () => {
    for (const link of [
      'http://youtu.be/dQw4w9WgXcQ',
      'https://youtube.com.golpe.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=curto',
      'https://www.youtube.com/channel/UC123',
      'https://vimeo.com/canal/abc',
      'https://www.loom.com/share/naoehid',
      'https://exemplo.com/video.mp4',
      'javascript:alert(1)',
      'não é link',
    ]) {
      const resultado = conferirVideo(link, 'Google');
      expect(resultado.ok, link).toBe(false);
    }
    const recusado = conferirVideo('https://exemplo.com/video.mp4', 'Google');
    if (!recusado.ok) {
      expect(recusado.mensagem).toBe(
        'O vídeo do Google precisa ser um link do YouTube, do Vimeo ou do Loom, começando com https://.',
      );
    }
  });
});
