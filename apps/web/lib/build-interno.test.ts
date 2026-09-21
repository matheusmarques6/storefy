import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorpoDoBuild,
  STATUS_QUE_PODEM_BUSCAR,
  abrirOuNulo,
  autorizarWorkflow,
  canalDaLoja,
  podeBuscarCredenciais,
  slugDoProjeto,
} from '@/lib/build-interno';

const CHAVE = Buffer.alloc(32, 17).toString('base64');
let original: string | undefined;

beforeEach(() => {
  original = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CHAVE;
});
afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

describe('autorizarWorkflow', () => {
  it('aceita o segredo certo', () => {
    expect(autorizarWorkflow('Bearer segredo-do-build', 'segredo-do-build')).toEqual({ ok: true });
  });

  /*
   * Esta rota devolve, em claro, a chave que publica na conta Apple de um
   * cliente. Um modo "ainda não configurei" aqui seria um endpoint público
   * entregando credenciais de todo mundo.
   */
  it('sem BUILD_API_SECRET, recusa tudo', () => {
    for (const segredo of [undefined, '']) {
      const r = autorizarWorkflow('Bearer qualquer', segredo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(503);
    }
  });

  it('recusa segredo errado, faltando ou com formato torto', () => {
    for (const cabecalho of [null, '', 'Bearer outro', 'segredo-do-build', 'Basic x']) {
      const r = autorizarWorkflow(cabecalho, 'segredo-do-build');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
  });

  it('não aceita prefixo nem sufixo do segredo certo', () => {
    expect(autorizarWorkflow('Bearer segredo-do-buil', 'segredo-do-build').ok).toBe(false);
    expect(autorizarWorkflow('Bearer segredo-do-buildX', 'segredo-do-build').ok).toBe(false);
  });
});

describe('CorpoDoBuild', () => {
  it('exige um uuid', () => {
    expect(
      CorpoDoBuild.safeParse({ buildId: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true);
    for (const ruim of ['', 'abc', '1', null, undefined, 123]) {
      expect(CorpoDoBuild.safeParse({ buildId: ruim }).success).toBe(false);
    }
  });
});

describe('podeBuscarCredenciais', () => {
  const TODOS = [
    'queued',
    'building',
    'finished',
    'errored',
    'submitted',
    'in_review',
    'approved',
    'rejected',
    'canceled',
    '',
  ] as const;

  /*
   * Um buildId antigo não devolve credencial. Sem isto, qualquer id que tenha
   * aparecido num log de execução do GitHub continuaria servindo para buscar a
   * chave da Apple de um cliente, para sempre.
   */
  it('a geração só busca na fila ou gerando', () => {
    expect([...STATUS_QUE_PODEM_BUSCAR.build]).toEqual(['queued', 'building']);

    for (const status of TODOS) {
      expect(podeBuscarCredenciais(status, 'build')).toBe(
        status === 'queued' || status === 'building',
      );
    }
  });

  /** Sem etapa, é a geração: a janela mais fechada é o padrão seguro. */
  it('sem etapa, vale a da geração', () => {
    expect(podeBuscarCredenciais('queued')).toBe(true);
    expect(podeBuscarCredenciais('finished')).toBe(false);
  });

  /*
   * O envio começa quando o binário fica pronto, então a janela dele é outra.
   * `submitted` entra porque o GitHub reexecuta workflow, e uma reexecução do
   * envio não pode virar 404. O que NÃO pode é um build aprovado continuar
   * devolvendo a chave da Apple.
   */
  it('o envio busca quando o binário ficou pronto, e não depois de aprovado', () => {
    expect([...STATUS_QUE_PODEM_BUSCAR.submit]).toEqual(['finished', 'submitted']);

    for (const status of TODOS) {
      expect(podeBuscarCredenciais(status, 'submit')).toBe(
        status === 'finished' || status === 'submitted',
      );
    }
  });

  /** As duas janelas não se encostam: nenhum status serve para as duas. */
  it('nenhum status abre as duas etapas ao mesmo tempo', () => {
    for (const status of TODOS) {
      expect(
        podeBuscarCredenciais(status, 'build') && podeBuscarCredenciais(status, 'submit'),
      ).toBe(false);
    }
  });
});

describe('CorpoDoBuild.etapa', () => {
  it('sem etapa, é geração', () => {
    const r = CorpoDoBuild.safeParse({ buildId: '11111111-1111-4111-8111-111111111111' });
    expect(r.success && r.data.etapa).toBe('build');
  });

  it('aceita submit', () => {
    const r = CorpoDoBuild.safeParse({
      buildId: '11111111-1111-4111-8111-111111111111',
      etapa: 'submit',
    });
    expect(r.success && r.data.etapa).toBe('submit');
  });

  it('recusa etapa inventada', () => {
    const r = CorpoDoBuild.safeParse({
      buildId: '11111111-1111-4111-8111-111111111111',
      etapa: 'tudo',
    });
    expect(r.success).toBe(false);
  });
});

describe('canalDaLoja', () => {
  /*
   * Um canal por loja: uma correção OTA mandada para uma não pode vazar para
   * as outras. É o mesmo raciocínio do app na OneSignal.
   */
  it('inclui o id da loja, para o canal não ser compartilhado', () => {
    expect(canalDaLoja('loja-1', 'production')).toBe('production-loja-1');
    expect(canalDaLoja('loja-2', 'production')).not.toBe(canalDaLoja('loja-1', 'production'));
  });

  it('separa também por perfil', () => {
    expect(canalDaLoja('loja-1', 'preview')).not.toBe(canalDaLoja('loja-1', 'production'));
  });
});

describe('slugDoProjeto', () => {
  /*
   * O EAS acha o projeto pelo par dono + slug, e `app.config.ts` é um só para
   * todas as lojas. Um slug fixo faria a segunda loja a publicar entrar no
   * projeto EAS da primeira, e as duas dividiriam o canal de update: uma
   * correção OTA de uma chegaria no app da outra. Este teste é o que
   * transforma isso num vermelho em vez de num incidente.
   */
  it('dá um slug diferente para cada loja', () => {
    expect(slugDoProjeto('loja-1')).not.toBe(slugDoProjeto('loja-2'));
  });

  it('é estável: a mesma loja publica sempre no mesmo projeto', () => {
    expect(slugDoProjeto('loja-1')).toBe(slugDoProjeto('loja-1'));
  });

  /* O Expo só aceita letra minúscula, número, hífen e sublinhado no slug. */
  it('cabe no que o Expo aceita como slug', () => {
    const slug = slugDoProjeto('3f1b9c22-9a0e-4c4a-9d61-2f7c1e5a8b40');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9_-]{0,99}$/);
  });
});

describe('abrirOuNulo', () => {
  const abrir = (valor: string): string => {
    if (valor === 'cifrado') return 'em claro';
    throw new Error('não abre');
  };

  it('abre o que dá', () => {
    expect(abrirOuNulo('cifrado', abrir)).toBe('em claro');
  });

  /*
   * Ausente e ilegível dão o mesmo `null`. A diferença só interessa ao log do
   * servidor; o workflow reclama igual nos dois casos, porque sem a credencial
   * ele não tem o que fazer.
   */
  it('ausente e ilegível dão o mesmo null', () => {
    expect(abrirOuNulo(null, abrir)).toBeNull();
    expect(abrirOuNulo('', abrir)).toBeNull();
    expect(abrirOuNulo('lixo', abrir)).toBeNull();
  });

  it('não deixa a exceção escapar', () => {
    expect(() =>
      abrirOuNulo('lixo', () => {
        throw new Error('estourou');
      }),
    ).not.toThrow();
  });
});
