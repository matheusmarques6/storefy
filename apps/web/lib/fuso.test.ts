/**
 * O fuso da loja, e não o do servidor.
 *
 * O teste que importa é o primeiro: 20:00 em Brasília tem que virar 23:00 UTC.
 * Antes desta correção virava 20:00 UTC — e toda campanha agendada saía três
 * horas antes. O processo destes testes roda em UTC, igual à Vercel, então um
 * `new Date("…T20:00")` escondido em qualquer caminho reproduziria o defeito
 * aqui mesmo.
 */
import { describe, expect, it } from 'vitest';
import {
  FUSO_PADRAO,
  formatarData,
  formatarDataHora,
  formatarHora,
  fusoAceito,
  fusoValido,
  fusosDisponiveis,
  gruposDeFusos,
  instanteDaHoraLocal,
  nomeDoFuso,
  paraCampoLocal,
} from '@/lib/fuso';

describe('instanteDaHoraLocal', () => {
  it('20:00 em Brasília é 23:00 UTC — o caso do defeito', () => {
    expect(instanteDaHoraLocal('2026-09-30T20:00', 'America/Sao_Paulo')?.toISOString()).toBe(
      '2026-09-30T23:00:00.000Z',
    );
  });

  it('respeita o fuso de cada loja', () => {
    // Manaus é UTC-4, e não UTC-3.
    expect(instanteDaHoraLocal('2026-09-30T20:00', 'America/Manaus')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(instanteDaHoraLocal('2026-09-30T20:00', 'UTC')?.toISOString()).toBe(
      '2026-09-30T20:00:00.000Z',
    );
  });

  /*
   * Fuso com horário de verão: a mesma hora de relógio tem deslocamentos
   * diferentes antes e depois da virada. A segunda passada do cálculo existe
   * por isso.
   */
  it('acerta dos dois lados do horário de verão', () => {
    // Nova York: EDT (UTC-4) em julho, EST (UTC-5) em dezembro.
    expect(instanteDaHoraLocal('2026-07-15T20:00', 'America/New_York')?.toISOString()).toBe(
      '2026-07-16T00:00:00.000Z',
    );
    expect(instanteDaHoraLocal('2026-12-15T20:00', 'America/New_York')?.toISOString()).toBe(
      '2026-12-16T01:00:00.000Z',
    );
    // Lisboa: WEST (UTC+1) no verão, WET (UTC+0) no inverno.
    expect(instanteDaHoraLocal('2026-07-15T20:00', 'Europe/Lisbon')?.toISOString()).toBe(
      '2026-07-15T19:00:00.000Z',
    );
  });

  it('aceita segundos, que o navegador às vezes manda', () => {
    expect(instanteDaHoraLocal('2026-09-30T20:00:30', 'America/Sao_Paulo')?.toISOString()).toBe(
      '2026-09-30T23:00:30.000Z',
    );
  });

  /* O `Date` rolaria 31/02 para 03/03 calado; aqui vira recusa. */
  it('recusa data que não existe, em vez de rolar para o mês seguinte', () => {
    expect(instanteDaHoraLocal('2026-02-31T20:00', 'America/Sao_Paulo')).toBeNull();
    expect(instanteDaHoraLocal('2026-09-30T25:00', 'America/Sao_Paulo')).toBeNull();
  });

  it('recusa o que não é o formato do campo', () => {
    expect(instanteDaHoraLocal('', 'America/Sao_Paulo')).toBeNull();
    expect(instanteDaHoraLocal('amanhã às 20h', 'America/Sao_Paulo')).toBeNull();
    // Com fuso na string já não é hora de relógio, e aceitar esconderia um
    // chamador passando o dado errado.
    expect(instanteDaHoraLocal('2026-09-30T20:00Z', 'America/Sao_Paulo')).toBeNull();
  });

  it('fuso inválido cai no padrão em vez de derrubar a ação', () => {
    expect(instanteDaHoraLocal('2026-09-30T20:00', 'Marte/Olimpo')?.toISOString()).toBe(
      '2026-09-30T23:00:00.000Z',
    );
  });
});

describe('paraCampoLocal', () => {
  /*
   * O caminho de volta. A tela de edição tem que mostrar a MESMA hora que o
   * lojista escolheu — e não a hora UTC, que era o que fazia o defeito parecer
   * certo na edição.
   */
  it('devolve a hora de relógio da loja, no formato do campo', () => {
    expect(paraCampoLocal('2026-09-30T23:00:00Z', 'America/Sao_Paulo')).toBe('2026-09-30T20:00');
  });

  it('ida e volta preserva o que o lojista digitou', () => {
    for (const fuso of [
      'America/Sao_Paulo',
      'America/Manaus',
      'America/New_York',
      'Europe/Lisbon',
    ]) {
      for (const texto of ['2026-01-10T08:30', '2026-07-15T20:00', '2026-12-31T23:45']) {
        const instante = instanteDaHoraLocal(texto, fuso);
        expect(paraCampoLocal(instante?.toISOString(), fuso), `${fuso} ${texto}`).toBe(texto);
      }
    }
  });

  it('vazio e inválido viram campo vazio', () => {
    expect(paraCampoLocal(null, FUSO_PADRAO)).toBe('');
    expect(paraCampoLocal('não é data', FUSO_PADRAO)).toBe('');
  });
});

describe('formatação', () => {
  // 23:30 UTC do dia 30 já é dia 30 em Brasília, mas 02:30 UTC do dia 1º
  // ainda é dia 30 lá — perto da meia-noite o fuso decide até o DIA.
  it('mostra a hora da loja, e não a do servidor', () => {
    expect(formatarHora('2026-09-30T23:00:00Z', 'America/Sao_Paulo')).toBe('20:00');
    expect(formatarDataHora('2026-09-30T23:00:00Z', 'America/Sao_Paulo')).toBe('30/09/2026, 20:00');
  });

  it('perto da meia-noite, o fuso decide o dia', () => {
    expect(formatarData('2026-10-01T02:30:00Z', 'America/Sao_Paulo')).toBe('30/09/2026');
    expect(formatarData('2026-10-01T02:30:00Z', 'UTC')).toBe('01/10/2026');
  });

  it('vazio ou inválido vira traço, nunca "Invalid Date"', () => {
    expect(formatarDataHora(null, FUSO_PADRAO)).toBe('—');
    expect(formatarData('lixo', FUSO_PADRAO)).toBe('—');
    expect(formatarHora(undefined, FUSO_PADRAO)).toBe('—');
  });
});

describe('fusoValido e nomeDoFuso', () => {
  it('fuso desconhecido vira o padrão', () => {
    expect(fusoValido('Marte/Olimpo')).toBe(FUSO_PADRAO);
    expect(fusoValido(null)).toBe(FUSO_PADRAO);
    expect(fusoValido('America/Manaus')).toBe('America/Manaus');
  });

  it('o lojista lê o nome do fuso em português', () => {
    expect(nomeDoFuso('America/Sao_Paulo')).toBe('horário de Brasília');
    expect(nomeDoFuso('America/Manaus')).toBe('horário do Amazonas');
    expect(nomeDoFuso('America/Rio_Branco')).toBe('horário do Acre');
    expect(nomeDoFuso('Europe/Lisbon')).toBe('horário de Lisboa');
    // Fora das listas, o nome do próprio `Intl`, começando em minúscula
    // porque entra no meio da frase.
    expect(nomeDoFuso('Asia/Tokyo', OUTONO_DE_2026)).toBe('horário padrão do Japão');
  });

  it('cidade brasileira gravada antes da lista continua com o nome dela', () => {
    expect(nomeDoFuso('America/Recife')).toBe('horário de Recife');
  });

  it('fuso ilegível no banco é lido como o padrão, sem derrubar a tela', () => {
    expect(nomeDoFuso('Marte/Olimpo')).toBe('horário de Brasília');
  });
});

/** Um instante fixo, fora de qualquer horário de verão do Brasil. */
const OUTONO_DE_2026 = Date.parse('2026-09-29T15:00:00Z');

describe('fusoAceito — o que pode ser GRAVADO', () => {
  it('aceita o nome exato de um fuso da lista', () => {
    expect(fusoAceito('America/Manaus')).toBe('America/Manaus');
    expect(fusoAceito('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(fusoAceito('UTC')).toBe('UTC');
    expect(fusoAceito('  America/Manaus  ')).toBe('America/Manaus');
  });

  /*
   * O `Intl` aceita os três abaixo, e é por isso que `fusoValido` não serve
   * para gravar: "america/manaus" e "EST" viram outra coisa no banco, e
   * "posix/…" nem é um lugar.
   */
  it('recusa o que o Intl aceitaria mas a lista não oferece', () => {
    expect(fusoAceito('america/manaus')).toBeNull();
    expect(fusoAceito('EST')).toBeNull();
    expect(fusoAceito('posix/America/Sao_Paulo')).toBeNull();
  });

  it('recusa vazio, lixo e o que nem é texto', () => {
    expect(fusoAceito('')).toBeNull();
    expect(fusoAceito('Marte/Olimpo')).toBeNull();
    expect(fusoAceito(undefined)).toBeNull();
    expect(fusoAceito(42)).toBeNull();
  });
});

describe('gruposDeFusos — o seletor', () => {
  const grupos = gruposDeFusos('America/Sao_Paulo', OUTONO_DE_2026);
  const brasil = grupos.find((grupo) => grupo.rotulo === 'Brasil');
  const outros = grupos.find((grupo) => grupo.rotulo === 'Outros países');

  it('abre com o Brasil, e Brasília em primeiro', () => {
    expect(grupos[0]?.rotulo).toBe('Brasil');
    expect(brasil?.opcoes[0]?.valor).toBe('America/Sao_Paulo');
    expect(brasil?.opcoes).toHaveLength(8);
  });

  it('diz a diferença para Brasília em horas, que é como o lojista pensa', () => {
    const rotulo = (valor: string) => brasil?.opcoes.find((opcao) => opcao.valor === valor)?.rotulo;

    expect(rotulo('America/Manaus')).toBe('Amazonas (1 hora a menos que Brasília)');
    expect(rotulo('America/Rio_Branco')).toBe('Acre (2 horas a menos que Brasília)');
    expect(rotulo('America/Noronha')).toBe('Fernando de Noronha (1 hora a mais que Brasília)');
  });

  it('não repete o Brasil entre os outros países', () => {
    const valores = outros?.opcoes.map((opcao) => opcao.valor) ?? [];
    expect(valores).not.toContain('America/Sao_Paulo');
    expect(valores).not.toContain('America/Recife');
    expect(valores).toContain('Europe/Lisbon');
    expect(valores).toContain('UTC');
  });

  it('todo valor oferecido pode ser gravado, e nenhum aparece duas vezes', () => {
    const valores = grupos.flatMap((grupo) => grupo.opcoes.map((opcao) => opcao.valor));

    expect(new Set(valores).size).toBe(valores.length);
    for (const valor of valores) expect(fusoAceito(valor), valor).toBe(valor);
  });

  it('o resto do mundo aparece pelo nome oficial e pelo nome em português', () => {
    const lisboa = outros?.opcoes.find((opcao) => opcao.valor === 'Europe/Lisbon');
    expect(lisboa?.rotulo).toMatch(/^Europe\/Lisbon — Horário/);
  });

  /*
   * Sem isto, uma loja gravada com "America/Recife" abriria o formulário com
   * Brasília marcada — a primeira opção —, e qualquer "Salvar" trocaria o fuso
   * dela sem ninguém ter pedido.
   */
  it('cidade brasileira fora da lista entra no grupo do Brasil quando é a atual', () => {
    const comRecife = gruposDeFusos('America/Recife', OUTONO_DE_2026);
    const opcoes = comRecife.find((grupo) => grupo.rotulo === 'Brasil')?.opcoes ?? [];

    expect(opcoes.at(-1)).toEqual({
      valor: 'America/Recife',
      rotulo: 'Recife (mesmo horário de Brasília)',
    });
  });

  it('fuso que a lista não conhece aparece à parte, e não some', () => {
    const comEstranho = gruposDeFusos('posix/America/Sao_Paulo', OUTONO_DE_2026);

    expect(comEstranho[0]).toEqual({
      rotulo: 'Fuso gravado',
      opcoes: [{ valor: 'posix/America/Sao_Paulo', rotulo: 'posix/America/Sao_Paulo' }],
    });
  });

  it('a lista tem centenas de fusos, e não uma lista escrita à mão', () => {
    expect(fusosDisponiveis().length).toBeGreaterThan(300);
  });
});
