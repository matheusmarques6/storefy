/**
 * O contraste das cores do app (seção 10 do plano: "contraste AA").
 *
 * O lojista escolhe as cores pela marca, e a marca nem sempre lê bem: cinza
 * claro sobre branco na barra de abas, texto branco num botão amarelo, os
 * ícones pretos da barra de status sobre um fundo preto. Nada disso quebra o
 * build — só deixa o app difícil de usar, e é pergunta certa na revisão.
 *
 * Aqui estão os pares que o app DESENHA, com o mínimo da WCAG para cada um:
 * 4,5:1 para texto pequeno (o nome das abas tem 11 pt, o texto dos avisos,
 * 15), e 3:1 para o que não é leitura corrida (as abas que não estão abertas
 * e os ícones da barra de status). É um aviso, e não uma trava: a cor é do
 * lojista.
 */
import type { AppConfig } from '@storefy/config-schema';

type Tema = AppConfig['theme'];

/** Luminância relativa (WCAG 2) de `#rgb` ou `#rrggbb`; `null` para o resto. */
export function luminancia(hex: string): number | null {
  const casou = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const cru = casou?.[1];
  if (cru === undefined) return null;
  const cheio =
    cru.length === 3
      ? cru
          .split('')
          .map((digito) => digito + digito)
          .join('')
      : cru;

  const [r, g, b] = [0, 2, 4].map((inicio) => {
    const canal = Number.parseInt(cheio.slice(inicio, inicio + 2), 16) / 255;
    return canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** A razão de contraste entre duas cores, de 1 (iguais) a 21 (preto e branco). */
export function razaoDeContraste(a: string, b: string): number | null {
  const la = luminancia(a);
  const lb = luminancia(b);
  if (la === null || lb === null) return null;
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

export interface ProblemaDeContraste {
  /** O que fica difícil de ler, na língua do lojista. */
  onde: string;
  razao: number;
  minimo: number;
  /** Os campos de cor envolvidos. */
  campos: (keyof Tema)[];
  /** Um conserto concreto, quando existe um que não mexe na marca. */
  dica: string | null;
}

interface Par {
  onde: string;
  frente: string;
  fundo: string;
  minimo: number;
  campos: (keyof Tema)[];
  dica?: string;
}

const PRETO = '#000000';
const BRANCO = '#ffffff';

export function problemasDeContraste(tema: Tema): ProblemaDeContraste[] {
  const iconesDaBarra = tema.statusBar === 'light' ? BRANCO : PRETO;

  const pares: Par[] = [
    {
      onde: 'Os textos das telas do app (sem conexão, erro, atualização)',
      frente: tema.text,
      fundo: tema.background,
      minimo: 4.5,
      campos: ['text', 'background'],
    },
    {
      onde: 'O texto dos botões e do aviso do topo, que usa a cor de fundo sobre a principal',
      frente: tema.background,
      fundo: tema.primary,
      minimo: 4.5,
      campos: ['primary', 'background'],
    },
    {
      onde: 'O nome e o ícone da aba selecionada',
      frente: tema.tabBarActive,
      fundo: tema.tabBarBg,
      minimo: 4.5,
      campos: ['tabBarActive', 'tabBarBg'],
    },
    {
      onde: 'As abas que não estão abertas',
      frente: tema.tabBarInactive,
      fundo: tema.tabBarBg,
      minimo: 3,
      campos: ['tabBarInactive', 'tabBarBg'],
    },
    {
      onde: 'A hora e a bateria, na barra de status',
      frente: iconesDaBarra,
      fundo: tema.background,
      minimo: 3,
      campos: ['background'],
      /*
       * Preto ou branco sempre passa de 3:1 contra qualquer fundo: quando um
       * falha, o outro serve — e trocar a barra de status não mexe na marca.
       */
      dica:
        tema.statusBar === 'light'
          ? 'Escolha "Ícones escuros" em Barra de status.'
          : 'Escolha "Ícones claros" em Barra de status.',
    },
  ];

  const problemas: ProblemaDeContraste[] = [];
  for (const par of pares) {
    const razao = razaoDeContraste(par.frente, par.fundo);
    // Cor ilegível é outro problema, que a validação do editor já aponta.
    if (razao === null || razao >= par.minimo) continue;
    problemas.push({
      onde: par.onde,
      razao,
      minimo: par.minimo,
      campos: par.campos,
      dica: par.dica ?? null,
    });
  }
  return problemas;
}

/** "2,13" vira "2,1:1"; o mínimo inteiro fica sem casa decimal ("3:1"). */
export function textoDaRazao(razao: number): string {
  const arredondado = Math.floor(razao * 10) / 10;
  const texto = Number.isInteger(arredondado)
    ? String(arredondado)
    : arredondado.toFixed(1).replace('.', ',');
  return `${texto}:1`;
}
