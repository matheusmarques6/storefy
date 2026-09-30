import { describe, expect, it } from 'vitest';
import { DIAS_ATE_ESTRANHAR } from '@/lib/builds-admin';
import { mensagemDaRevisao } from '@/lib/revisao';
import {
  proximoPassoDaRevisao,
  situacaoNaRevisao,
  type BuildNaRevisao,
} from '@/lib/proximo-passo-da-revisao';

const AGORA = Date.parse('2026-09-29T12:00:00Z');
const haDias = (dias: number): string => new Date(AGORA - dias * 86_400_000).toISOString();

function build(parcial: Partial<BuildNaRevisao>): BuildNaRevisao {
  return {
    platform: 'ios',
    status: 'in_review',
    error: null,
    submitted_at: haDias(1),
    store_state: null,
    ...parcial,
  };
}

describe('proximoPassoDaRevisao', () => {
  it('revisão da Apple no prazo: esperar', () => {
    expect(proximoPassoDaRevisao(build({}), AGORA)).toMatchObject({
      titulo: 'Esperar a Apple',
      quem: 'esperar',
      urgente: false,
    });
  });

  it('revisão da Apple parada: cobrar, com os dias', () => {
    const passo = proximoPassoDaRevisao(build({ submitted_at: haDias(12) }), AGORA);
    expect(passo).toMatchObject({ titulo: 'Cobrar a Apple', quem: 'lojista', urgente: true });
    expect(passo.detalhe).toContain('12 dias');
  });

  /*
   * O Android vai para a trilha interna, que não passa por revisão. Doze dias
   * ali não são "revisão parada" — é o lojista que ainda não promoveu.
   */
  it('Android na trilha interna: o lojista promove, e nada de alarme', () => {
    const passo = proximoPassoDaRevisao(
      build({ platform: 'android', status: 'submitted', submitted_at: haDias(30) }),
      AGORA,
    );
    expect(passo).toMatchObject({
      titulo: 'Promover para produção',
      quem: 'lojista',
      urgente: false,
    });
    expect(passo.detalhe).toContain('Play Console');
    expect(situacaoNaRevisao(build({ platform: 'android', status: 'submitted' }))).toBe(
      'Na trilha interna',
    );
    expect(situacaoNaRevisao(build({}))).toBeNull();
  });

  it('cada recusa da Apple com conserto conhecido tem o seu passo', () => {
    const recusa = (estado: string) =>
      proximoPassoDaRevisao(
        build({ status: 'rejected', error: mensagemDaRevisao('rejected', estado) }),
        AGORA,
      );

    expect(recusa('METADATA_REJECTED').titulo).toBe('Corrigir a ficha do app');
    expect(recusa('INVALID_BINARY').titulo).toBe('Gerar um build novo');
    expect(recusa('DEVELOPER_REJECTED')).toMatchObject({
      titulo: 'Confirmar com o lojista',
      urgente: false,
    });
    const diretriz = recusa('REJECTED');
    expect(diretriz.titulo).toBe('Ler o motivo e corrigir');
    // Os motivos que mais derrubam app de loja estão ali, com o conserto.
    expect(diretriz.detalhe).toContain('4.2');
    expect(diretriz.detalhe).toContain('2.1');
    expect(diretriz.detalhe).toContain('5.1.1');
  });

  /*
   * Recusado não está "parado": está esperando NÓS. Um alerta de tempo ali
   * mandaria cobrar a Apple por algo que é nosso.
   */
  it('recusa antiga pede conserto, e não cobrança da loja', () => {
    const passo = proximoPassoDaRevisao(
      build({ status: 'rejected', submitted_at: haDias(90) }),
      AGORA,
    );
    expect(passo.titulo).not.toContain('Cobrar');
    expect(passo.quem).toBe('equipe');
  });

  it('recusa da Google manda ao Play Console', () => {
    expect(
      proximoPassoDaRevisao(build({ platform: 'android', status: 'rejected' }), AGORA).titulo,
    ).toBe('Ler o motivo no Play Console');
  });

  it('o limite de "parado" é o mesmo da lista de builds', () => {
    expect(
      proximoPassoDaRevisao(build({ submitted_at: haDias(DIAS_ATE_ESTRANHAR - 1) }), AGORA).urgente,
    ).toBe(false);
    expect(
      proximoPassoDaRevisao(build({ submitted_at: haDias(DIAS_ATE_ESTRANHAR) }), AGORA).urgente,
    ).toBe(true);
  });

  /*
   * O defeito da auditoria: "Esperar a Apple" de um binário que ninguém tinha
   * mandado para a revisão. Quem pode agir é o lojista.
   */
  it('iPhone enviado e parado em "Preparar para envio": a vez é do lojista', () => {
    for (const store_state of [null, 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']) {
      const naoEnviado = build({ status: 'submitted', store_state, submitted_at: haDias(20) });
      expect(proximoPassoDaRevisao(naoEnviado, AGORA)).toMatchObject({
        titulo: 'Lojista enviar para a revisão',
        quem: 'lojista',
        urgente: false,
      });
      expect(situacaoNaRevisao(naoEnviado)).toBe('Não enviado para a revisão');
    }
  });

  it('na fila da Apple, espera — e cobra quando passa do normal', () => {
    const naFila = build({ status: 'submitted', store_state: 'WAITING_FOR_REVIEW' });
    expect(proximoPassoDaRevisao(naFila, AGORA).titulo).toBe('Esperar a Apple');
    expect(situacaoNaRevisao(naFila)).toBe('Na fila da Apple');
    expect(
      proximoPassoDaRevisao({ ...naFila, submitted_at: haDias(DIAS_ATE_ESTRANHAR) }, AGORA).titulo,
    ).toBe('Cobrar a Apple');
  });

  it('versão sem número na Apple, criptografia, contratos e liberar: passos do lojista', () => {
    const titulo = (parcial: Partial<BuildNaRevisao>) =>
      proximoPassoDaRevisao(build({ status: 'submitted', ...parcial }), AGORA).titulo;
    expect(titulo({ store_state: 'NO_APP_STORE_VERSION' })).toBe('Lojista criar a versão na Apple');
    expect(titulo({ store_state: 'WAITING_FOR_EXPORT_COMPLIANCE' })).toBe(
      'Lojista responder a criptografia',
    );
    expect(titulo({ store_state: 'PENDING_CONTRACT' })).toBe('Lojista aceitar os contratos');

    const aprovado = build({ status: 'approved', store_state: 'PENDING_DEVELOPER_RELEASE' });
    expect(proximoPassoDaRevisao(aprovado, AGORA).titulo).toBe('Lojista liberar a versão');
    expect(situacaoNaRevisao(aprovado)).toBe('Aprovado, sem liberar');
  });

  it('no Android, rascunho e lançamento interrompido também são do lojista', () => {
    const android = (store_state: string) =>
      build({ platform: 'android', status: 'submitted', store_state });
    expect(proximoPassoDaRevisao(android('PLAY_PRODUCTION_DRAFT'), AGORA).titulo).toBe(
      'Lojista enviar a versão de produção',
    );
    expect(situacaoNaRevisao(android('PLAY_HALTED'))).toBe('Lançamento interrompido');
    expect(situacaoNaRevisao(android('PLAY_INTERNAL'))).toBe('Na trilha interna');
  });
});
