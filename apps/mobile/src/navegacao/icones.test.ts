import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOMES_DE_ICONE, ehNomeDeIcone } from '@storefy/config-schema';
import { ICONES, ICONE_PADRAO, iconeDaAba } from './icones';

/** O mapa de glifos que a fonte do Ionicons realmente tem. */
function glifosDoIonicons(): Record<string, number> {
  const exigir = createRequire(import.meta.url);
  const raiz = dirname(exigir.resolve('@expo/vector-icons/package.json'));
  const caminho = join(
    raiz,
    'build',
    'vendor',
    'react-native-vector-icons',
    'glyphmaps',
    'Ionicons.json',
  );
  return JSON.parse(readFileSync(caminho, 'utf8')) as Record<string, number>;
}

describe('iconeDaAba', () => {
  it('TODO glifo mapeado existe na fonte', () => {
    // Um nome errado aqui não dá erro: vira um quadrado em branco na barra de
    // abas do cliente, e ninguém fica sabendo.
    const glifos = glifosDoIonicons();
    expect(Object.keys(glifos).length).toBeGreaterThan(100);

    const usados = [...Object.values(ICONES), ICONE_PADRAO].flatMap((par) => [
      par.vazio,
      par.cheio,
    ]);
    const faltando = usados.filter((glifo) => !(glifo in glifos));
    expect(faltando).toEqual([]);
  });

  it('usa contorno quando a aba está inativa e cheio quando ativa', () => {
    expect(iconeDaAba('house', false)).toBe('home-outline');
    expect(iconeDaAba('house', true)).toBe('home');
    expect(iconeDaAba('shopping-bag', false)).toBe('bag-handle-outline');
    expect(iconeDaAba('shopping-bag', true)).toBe('bag-handle');
  });

  it('não se importa com espaço nem com maiúscula', () => {
    expect(iconeDaAba('  HOUSE ', true)).toBe('home');
    expect(iconeDaAba('Shopping-Bag', true)).toBe('bag-handle');
  });

  it('cai no padrão em vez de sumir com a aba', () => {
    for (const nome of ['', '   ', 'icone-que-nao-existe', 'toString', 'constructor']) {
      expect(iconeDaAba(nome, false)).toBe(ICONE_PADRAO.vazio);
      expect(iconeDaAba(nome, true)).toBe(ICONE_PADRAO.cheio);
    }
  });

  it('cobre os ícones que as abas da config usam', () => {
    // Os cinco tipos de aba do schema precisam ter para onde ir.
    for (const nome of ['house', 'search', 'bag', 'cart', 'user', 'bell']) {
      expect(iconeDaAba(nome, true)).not.toBe(ICONE_PADRAO.cheio);
    }
  });
});

describe('cobertura do contrato', () => {
  it('TODO nome de ícone do contrato tem desenho no app', () => {
    // O lojista escolhe pelo nome no painel. Um nome da lista sem tradução
    // aqui vira três pontinhos no celular, e ninguém entende o que houve.
    const semDesenho = NOMES_DE_ICONE.filter((nome) => !Object.hasOwn(ICONES, nome));
    expect(semDesenho).toEqual([]);
  });

  it('o app não conhece nome que o painel não oferece', () => {
    // O contrário também importa: um apelido só do app nunca seria escolhido
    // por ninguém, e viraria código morto difícil de perceber.
    const apelidos = ['home', 'bag', 'cart', 'account', 'notifications'];
    const fora = Object.keys(ICONES).filter(
      (nome) => !ehNomeDeIcone(nome) && !apelidos.includes(nome),
    );
    expect(fora).toEqual([]);
  });
});
