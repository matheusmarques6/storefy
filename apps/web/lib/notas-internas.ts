/**
 * As notas internas sobre um cliente (A04).
 *
 * O TEXTO É CONFERIDO AQUI E NO BANCO, e a repetição é de propósito: a
 * constraint do banco é a que não se contorna, e esta é a que devolve uma
 * frase em português em vez de um erro de constraint na cara de quem digitou.
 * Os dois limites são os mesmos, e um teste amarra isso — se alguém mexer num
 * lado só, a tela passa a recusar o que o banco aceita, ou pior, a aceitar o
 * que o banco vai recusar depois de a pessoa ter escrito tudo.
 */

/** Os mesmos limites do `org_notes_body_tamanho` no banco. */
export const MINIMO_DA_NOTA = 2;
export const MAXIMO_DA_NOTA = 4000;

export type NotaConferida = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * O texto pronto para gravar, ou o motivo da recusa.
 *
 * O `trim` acontece ANTES da medida, igual ao `length(btrim(body))` do banco:
 * uma nota de quinhentos espaços tem quinhentos caracteres para o JavaScript e
 * zero para a constraint, e sem alinhar os dois a tela aceitaria algo que o
 * banco recusa.
 */
export function conferirNota(bruto: string): NotaConferida {
  const texto = bruto.trim();

  if (texto.length < MINIMO_DA_NOTA) {
    return { ok: false, motivo: 'Escreva a nota antes de salvar.' };
  }
  if (texto.length > MAXIMO_DA_NOTA) {
    return {
      ok: false,
      motivo: `A nota passou de ${String(MAXIMO_DA_NOTA)} caracteres. Resuma ou escreva duas.`,
    };
  }

  return { ok: true, texto };
}

/** Uma nota como a RPC devolve, com os nulos que o tipo gerado permite. */
export interface NotaBruta {
  id: string | null;
  body: string | null;
  created_at: string | null;
  author_id: string | null;
  author_email: string | null;
}

export interface Nota {
  id: string;
  texto: string;
  quando: string | null;
  /**
   * Quem escreveu. "Alguém que saiu da equipe" quando o autor foi removido:
   * a nota sobrevive à pessoa, e um autor vazio na tela pareceria um bug.
   */
  autor: string;
}

export function lerNotas(brutas: NotaBruta[]): Nota[] {
  const notas: Nota[] = [];

  for (const bruta of brutas) {
    // Sem id não há como apagar, e sem texto não há nota: as duas tornam a
    // linha inútil na tela, e desenhar o inútil só confunde.
    if (bruta.id == null || bruta.id === '' || bruta.body == null || bruta.body === '') continue;

    notas.push({
      id: bruta.id,
      texto: bruta.body,
      quando: bruta.created_at,
      autor: bruta.author_email ?? 'alguém que saiu da equipe',
    });
  }

  return notas;
}
