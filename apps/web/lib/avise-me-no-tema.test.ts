/**
 * O botão "me avise quando voltar", rodando na página de produto.
 *
 * Como o banner, este arquivo EXECUTA
 * `extensions/storefy-tema/assets/storefy-avise-me.js` num `node:vm` com um DOM
 * falso. Os defeitos que importam são de comportamento, e todos seriam
 * promessas quebradas na cara do cliente final: o botão aparecer onde não há
 * como avisar, e dizer "pronto!" quando o pedido não foi gravado — que foi o
 * que aconteceu enquanto o app recebia o pedido e não fazia nada com ele.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { escreverMensagemParaWeb, type NativeToWeb } from '@storefy/bridge';

const SCRIPT = readFileSync(
  resolve(import.meta.dirname, '../../../extensions/storefy-tema/assets/storefy-avise-me.js'),
  'utf8',
);

interface NoFalso {
  tag: string;
  type: string;
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  style: Record<string, string> & { cssText: string };
  filhos: NoFalso[];
  atributos: Record<string, string>;
  ouvintes: Record<string, (() => void)[]>;
  getAttribute: (nome: string) => string | null;
  setAttribute: (nome: string, valor: string) => void;
  removeAttribute: (nome: string) => void;
  addEventListener: (evento: string, ouvinte: () => void) => void;
  appendChild: (filho: NoFalso) => void;
  clicar: () => void;
}

function criarNo(tag: string, atributos: Record<string, string> = {}): NoFalso {
  const no: NoFalso = {
    tag,
    type: '',
    hidden: true,
    disabled: false,
    textContent: '',
    style: { cssText: '' },
    filhos: [],
    atributos,
    ouvintes: {},
    getAttribute: (nome) => no.atributos[nome] ?? null,
    setAttribute: (nome, valor) => {
      no.atributos[nome] = valor;
    },
    removeAttribute: (nome) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- é o DOM falso fazendo o que o de verdade faz
      delete no.atributos[nome];
    },
    addEventListener: (evento, ouvinte) => {
      (no.ouvintes[evento] ??= []).push(ouvinte);
    },
    appendChild: (filho) => {
      no.filhos.push(filho);
    },
    clicar: () => {
      for (const ouvinte of no.ouvintes.click ?? []) ouvinte();
    },
  };
  return no;
}

interface OpcoesDoAmbiente {
  /** O app está por volta? */
  dentroDoApp?: boolean;
  /** O app tem notificações (`__STOREFY__.pushEnabled`)? */
  comPush?: boolean;
  /** `window.Storefy` foi injetado? */
  comApi?: boolean;
  /** O que `notifyWhenBack` devolve: a mensagem chegou ao app? */
  entregue?: boolean;
  caixas?: Record<string, string>[];
}

const CAIXA = {
  'data-variante': '4412345',
  'data-caminho': '/products/jaqueta?variant=4412345',
  'data-rotulo': 'Me avise quando voltar',
  'data-confirmacao': 'Pronto! Você será avisado.',
};

function criarAmbiente(opcoes: OpcoesDoAmbiente = {}) {
  const pedidos: { variante: unknown; caminho: unknown }[] = [];
  const caixas = (opcoes.caixas ?? [CAIXA]).map((atributos) => criarNo('div', { ...atributos }));
  const ouvintesDaJanela: ((evento: { data: unknown }) => void)[] = [];
  const relogios = new Map<number, () => void>();
  let proximoRelogio = 1;

  const janela: Record<string, unknown> = {
    document: {
      querySelectorAll: () => caixas,
      createElement: (tag: string) => criarNo(tag),
    },
    addEventListener: (evento: string, ouvinte: (evento: { data: unknown }) => void) => {
      if (evento === 'message') ouvintesDaJanela.push(ouvinte);
    },
    setTimeout: (acao: () => void) => {
      const id = proximoRelogio++;
      relogios.set(id, acao);
      return id;
    },
    clearTimeout: (id: number) => {
      relogios.delete(id);
    },
  };
  if (opcoes.dentroDoApp !== false) {
    janela.__STOREFY__ = {
      platform: 'ios',
      appVersion: '1.0.0',
      pushEnabled: opcoes.comPush ?? true,
    };
  }
  if (opcoes.comApi !== false) {
    janela.Storefy = {
      notifyWhenBack: (variante: unknown, caminho: unknown): boolean => {
        pedidos.push({ variante, caminho });
        return opcoes.entregue ?? true;
      },
    };
  }
  janela.window = janela;

  const contexto = createContext(janela);

  return {
    janela,
    pedidos,
    caixas,
    rodar: (): void => {
      runInContext(SCRIPT, contexto);
    },
    botao: (indice = 0): NoFalso | undefined => caixas[indice]?.filhos[0],
    aviso: (indice = 0): NoFalso | undefined => caixas[indice]?.filhos[1],
    /** O app responde, pelo mesmo caminho da injeção de verdade. */
    responder: (mensagem: NativeToWeb): void => {
      const dados = escreverMensagemParaWeb(mensagem);
      for (const ouvinte of ouvintesDaJanela) ouvinte({ data: dados });
    },
    /** Outra mensagem qualquer da página: outro app do lojista, outro script. */
    mensagemCrua: (dados: unknown): void => {
      for (const ouvinte of ouvintesDaJanela) ouvinte({ data: dados });
    },
    esgotarPrazo: (): void => {
      for (const [id, acao] of [...relogios]) {
        relogios.delete(id);
        acao();
      }
    },
  };
}

describe('quando o botão aparece', () => {
  it('dentro do app, com a API do bridge, ele é montado e revelado', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(false);
    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.type).toBe('button');
    // O lugar onde o resultado é dito, também para o leitor de tela.
    expect(ambiente.aviso()?.atributos.role).toBe('status');
  });

  /*
   * Fora do app não há aparelho para notificar. Mostrar o botão ali seria
   * prometer ao cliente final um aviso que nunca chegaria.
   */
  it('fora do app ele não aparece', () => {
    const ambiente = criarAmbiente({ dentroDoApp: false });
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(true);
    expect(ambiente.botao()).toBeUndefined();
  });

  it('num app sem notificações também não: o aviso é um push', () => {
    const ambiente = criarAmbiente({ comPush: false });
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(true);
  });

  /* App velho, sem a API ainda: mesma regra. */
  it('sem a API do bridge ele não aparece', () => {
    const ambiente = criarAmbiente({ comApi: false });
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(true);
  });

  it('caixa sem variante é ignorada, e as outras continuam', () => {
    const ambiente = criarAmbiente({
      caixas: [{ 'data-variante': '' }, CAIXA],
    });
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(true);
    expect(ambiente.caixas[1]?.hidden).toBe(false);
  });

  it('rodar duas vezes não monta dois botões', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.rodar();

    expect(ambiente.caixas[0]?.filhos).toHaveLength(2);
  });
});

describe('o que o toque faz', () => {
  it('manda a variante e o caminho pelo bridge', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();

    expect(ambiente.pedidos).toEqual([
      { variante: '4412345', caminho: '/products/jaqueta?variant=4412345' },
    ]);
  });

  /*
   * Entregar a mensagem não é gravar o pedido: o app ainda pede a permissão
   * e fala com o servidor. Até a resposta, o botão espera — e não diz nada.
   */
  it('espera a resposta do app antes de dizer qualquer coisa', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();

    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.disabled).toBe(true);
    expect(ambiente.botao()?.atributos['aria-busy']).toBe('true');
    expect(ambiente.aviso()?.textContent).toBe('');
  });

  it('com o pedido gravado, confirma e não deixa tocar de novo', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.responder({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId: '4412345', ok: true });

    expect(ambiente.botao()?.textContent).toBe('Pronto! Você será avisado.');
    expect(ambiente.botao()?.disabled).toBe(true);
    expect(ambiente.botao()?.atributos['aria-busy']).toBeUndefined();

    ambiente.botao()?.clicar();
    expect(ambiente.pedidos).toHaveLength(1);
  });

  it('notificações desligadas: diz onde ligar, e deixa tentar de novo', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.responder({
      type: 'NOTIFY_WHEN_BACK_RESULT',
      variantId: '4412345',
      ok: false,
      reason: 'permission',
    });

    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.disabled).toBe(false);
    expect(ambiente.aviso()?.textContent).toBe(
      'Para receber o aviso, ative as notificações deste app nos ajustes do celular.',
    );
  });

  it('servidor fora: "tente de novo", e o toque seguinte manda outra vez', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.responder({
      type: 'NOTIFY_WHEN_BACK_RESULT',
      variantId: '4412345',
      ok: false,
      reason: 'unavailable',
    });

    expect(ambiente.aviso()?.textContent).toBe('Não deu certo agora. Toque para tentar de novo.');
    expect(ambiente.botao()?.disabled).toBe(false);

    ambiente.botao()?.clicar();
    expect(ambiente.pedidos).toHaveLength(2);
    // Tentando de novo, o aviso antigo sai.
    expect(ambiente.aviso()?.textContent).toBe('');
  });

  /*
   * Um app que não responde (o de antes desta correção, por exemplo) não
   * gravava nada. Depois do prazo, o botão diz que não deu — e uma resposta
   * que chega atrasada ainda vale: a pessoa pode ter demorado no "permitir".
   */
  it('sem resposta no prazo, não deu; resposta atrasada ainda vale', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.esgotarPrazo();

    expect(ambiente.aviso()?.textContent).toBe('Não deu certo agora. Toque para tentar de novo.');
    expect(ambiente.botao()?.disabled).toBe(false);

    ambiente.responder({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId: '4412345', ok: true });
    expect(ambiente.botao()?.textContent).toBe('Pronto! Você será avisado.');
    expect(ambiente.aviso()?.textContent).toBe('');
  });

  it('a resposta de outra variante, e mensagem que não é nossa, não mexem no botão', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();

    ambiente.responder({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId: '999', ok: true });
    ambiente.mensagemCrua('não é json');
    ambiente.mensagemCrua({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId: '4412345', ok: true });
    ambiente.mensagemCrua('{"type":"NOTIFY_WHEN_BACK_RESULT"}');

    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.disabled).toBe(true);
  });

  it('cada botão ouve só a sua variante', () => {
    const ambiente = criarAmbiente({
      caixas: [CAIXA, { ...CAIXA, 'data-variante': '777' }],
    });
    ambiente.rodar();
    ambiente.botao(0)?.clicar();
    ambiente.botao(1)?.clicar();
    ambiente.responder({ type: 'NOTIFY_WHEN_BACK_RESULT', variantId: '777', ok: true });

    expect(ambiente.botao(1)?.textContent).toBe('Pronto! Você será avisado.');
    expect(ambiente.botao(0)?.textContent).toBe('Me avise quando voltar');
  });

  it('usa os textos que o lojista escreveu no editor de tema', () => {
    const ambiente = criarAmbiente({
      caixas: [
        {
          ...CAIXA,
          'data-sem-permissao': 'Ligue as notificações para saber.',
          'data-erro': 'Ops! Tente de novo.',
        },
      ],
    });
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.responder({
      type: 'NOTIFY_WHEN_BACK_RESULT',
      variantId: '4412345',
      ok: false,
      reason: 'permission',
    });
    expect(ambiente.aviso()?.textContent).toBe('Ligue as notificações para saber.');

    ambiente.botao()?.clicar();
    ambiente.responder({
      type: 'NOTIFY_WHEN_BACK_RESULT',
      variantId: '4412345',
      ok: false,
      reason: 'unavailable',
    });
    expect(ambiente.aviso()?.textContent).toBe('Ops! Tente de novo.');
  });

  /*
   * O retorno de `notifyWhenBack` diz se a mensagem CHEGOU ao app. Sem ela
   * ter chegado, não há resposta a esperar.
   */
  it('mensagem que não chegou ao app não põe o botão para esperar', () => {
    const ambiente = criarAmbiente({ entregue: false });
    ambiente.rodar();
    ambiente.botao()?.clicar();

    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.disabled).toBe(false);
  });

  it('e aí dá para tentar de novo', () => {
    const ambiente = criarAmbiente({ entregue: false });
    ambiente.rodar();
    ambiente.botao()?.clicar();
    ambiente.botao()?.clicar();

    expect(ambiente.pedidos).toHaveLength(2);
  });
});
