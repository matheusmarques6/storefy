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
  return { platform: 'ios', status: 'in_review', error: null, submitted_at: haDias(1), ...parcial };
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
});
