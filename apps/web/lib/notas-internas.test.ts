/**
 * Os limites da nota, e o alinhamento com o banco.
 *
 * O erro que isto evita é chato e comum: a tela aceita, a pessoa escreve dois
 * parágrafos, clica em salvar e recebe um erro de constraint. Ou o contrário —
 * a tela recusa o que o banco aceitaria. Os dois limites têm que ser um só.
 */
import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DA_NOTA,
  MINIMO_DA_NOTA,
  conferirNota,
  lerNotas,
  type NotaBruta,
} from '@/lib/notas-internas';

describe('conferirNota', () => {
  it('devolve o texto já aparado', () => {
    const r = conferirNota('  Ligou hoje.  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toBe('Ligou hoje.');
  });

  /*
   * O banco mede `length(btrim(body))`. Sem aparar antes de medir, uma nota de
   * quinhentos espaços passaria aqui e bateria na constraint depois.
   */
  it('nota só de espaço é recusada, como o banco recusa', () => {
    const r = conferirNota('          ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Escreva a nota');
  });

  it('nota vazia é recusada', () => {
    expect(conferirNota('').ok).toBe(false);
  });

  it('o piso é o mesmo do banco', () => {
    expect(conferirNota('x'.repeat(MINIMO_DA_NOTA - 1)).ok).toBe(false);
    expect(conferirNota('x'.repeat(MINIMO_DA_NOTA)).ok).toBe(true);
  });

  it('o teto é o mesmo do banco', () => {
    expect(conferirNota('x'.repeat(MAXIMO_DA_NOTA)).ok).toBe(true);

    const passou = conferirNota('x'.repeat(MAXIMO_DA_NOTA + 1));
    expect(passou.ok).toBe(false);
    if (!passou.ok) expect(passou.motivo).toContain(String(MAXIMO_DA_NOTA));
  });

  /* Espaço nas pontas não pode fazer uma nota válida estourar o teto. */
  it('o espaço das pontas não conta para o teto', () => {
    expect(conferirNota(`   ${'x'.repeat(MAXIMO_DA_NOTA)}   `).ok).toBe(true);
  });
});

describe('lerNotas', () => {
  const BRUTA: NotaBruta = {
    id: 'n1',
    body: 'Prometido retorno na sexta.',
    created_at: '2026-09-20T10:00:00Z',
    author_id: 'u1',
    author_email: 'suporte@storefy.com.br',
  };

  it('normaliza uma nota completa', () => {
    expect(lerNotas([BRUTA])).toEqual([
      {
        id: 'n1',
        texto: 'Prometido retorno na sexta.',
        quando: '2026-09-20T10:00:00Z',
        autor: 'suporte@storefy.com.br',
      },
    ]);
  });

  /*
   * A nota sobrevive à saída de quem escreveu — é o `on delete set null` do
   * banco. Um autor vazio na tela pareceria um bug; dizer o que houve não.
   */
  it('nota de quem saiu da equipe continua legível, e diz isso', () => {
    const [nota] = lerNotas([{ ...BRUTA, author_id: null, author_email: null }]);
    expect(nota?.texto).toBe('Prometido retorno na sexta.');
    expect(nota?.autor).toBe('alguém que saiu da equipe');
  });

  /* Sem id não há como apagar; sem texto não há nota. As duas são inúteis. */
  it('descarta linha sem id ou sem texto', () => {
    expect(lerNotas([{ ...BRUTA, id: null }])).toEqual([]);
    expect(lerNotas([{ ...BRUTA, body: null }])).toEqual([]);
    expect(lerNotas([{ ...BRUTA, body: '' }])).toEqual([]);
  });

  it('lista vazia não estoura', () => {
    expect(lerNotas([])).toEqual([]);
  });
});
