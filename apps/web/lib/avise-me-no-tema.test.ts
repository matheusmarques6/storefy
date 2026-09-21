/**
 * O botão "me avise quando voltar", rodando na página de produto.
 *
 * Como o banner, este arquivo EXECUTA
 * `extensions/storefy-tema/assets/storefy-avise-me.js` num `node:vm` com um DOM
 * falso. Os defeitos que importam são de comportamento, e dois deles seriam
 * promessas quebradas na cara do cliente final: o botão aparecer fora do app,
 * onde não há para onde mandar a notificação, e dizer "pronto!" quando a
 * mensagem não chegou ao app.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

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

  const janela: Record<string, unknown> = {
    document: {
      querySelectorAll: () => caixas,
      createElement: (tag: string) => criarNo(tag),
    },
  };
  if (opcoes.dentroDoApp !== false) {
    janela.__STOREFY__ = { platform: 'ios', appVersion: '1.0.0', pushEnabled: true };
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
  };
}

describe('quando o botão aparece', () => {
  it('dentro do app, com a API do bridge, ele é montado e revelado', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();

    expect(ambiente.caixas[0]?.hidden).toBe(false);
    expect(ambiente.botao()?.textContent).toBe('Me avise quando voltar');
    expect(ambiente.botao()?.type).toBe('button');
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

    expect(ambiente.caixas[0]?.filhos).toHaveLength(1);
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

  it('e confirma na cara do cliente, sem deixar tocar de novo', () => {
    const ambiente = criarAmbiente();
    ambiente.rodar();
    ambiente.botao()?.clicar();

    expect(ambiente.botao()?.textContent).toBe('Pronto! Você será avisado.');
    expect(ambiente.botao()?.disabled).toBe(true);
  });

  /*
   * O retorno diz se a mensagem CHEGOU ao app. Confirmar sem ela ter chegado
   * seria a pior mentira possível aqui: o cliente sai achando que vai ser
   * avisado, e não vai.
   */
  it('mensagem que não chegou ao app não vira "pronto"', () => {
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
