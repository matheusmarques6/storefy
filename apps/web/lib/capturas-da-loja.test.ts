import { describe, expect, it } from 'vitest';
import { CAPTURAS, ondeTirar } from '@/lib/capturas-da-loja';

describe('CAPTURAS', () => {
  it('cobre as duas lojas de aplicativos', () => {
    expect(CAPTURAS.map((c) => c.loja).sort()).toEqual(['App Store', 'Play Store']);
  });

  /*
   * O tamanho é o que a Apple recusa, e a recusa chega dias depois sem dizer
   * qual captura estava errada. A medida precisa estar na tela, exata.
   */
  it('a App Store traz a medida exata em pixels', () => {
    const apple = CAPTURAS.find((c) => c.loja === 'App Store');
    expect(apple?.medida).toMatch(/\d{3,4} × \d{3,4} px/);
  });

  it('cada item diz quantas a loja exige e como tirar', () => {
    for (const captura of CAPTURAS) {
      expect(captura.minimo).toBeGreaterThanOrEqual(1);
      expect(captura.comoTirar.length).toBeGreaterThan(30);
      expect(captura.nome.length).toBeGreaterThan(2);
    }
  });

  /** O Google pede duas; mostrar "1" faria o lojista ser recusado por isso. */
  it('o Play Store pede pelo menos duas', () => {
    expect(CAPTURAS.find((c) => c.loja === 'Play Store')?.minimo).toBe(2);
  });
});

describe('ondeTirar', () => {
  /*
   * Antes de publicar não existe app na loja para abrir. Mandar o lojista
   * "abrir o app" nesse momento é mandá-lo procurar algo que não existe.
   */
  it('antes de publicar, manda para o Storefy Preview', () => {
    expect(ondeTirar(false)).toContain('Storefy Preview');
  });

  it('depois de publicado, manda para o app da própria loja', () => {
    expect(ondeTirar(true)).toContain('app da sua loja');
    expect(ondeTirar(true)).not.toContain('Preview');
  });
});
