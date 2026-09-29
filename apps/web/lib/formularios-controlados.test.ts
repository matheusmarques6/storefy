/**
 * Formulário não pode se apagar quando a ação devolve erro.
 *
 * O React 19 limpa, ao fim de toda ação de `<form action={…}>`, os campos que
 * ele não controla — e ter dado erro não conta. A limpeza devolve cada campo
 * ao seu `defaultValue`. Foi assim que errar a senha passou a apagar o e-mail,
 * e que a credencial recusada pela Shopify apagava o Client ID recém-colado.
 *
 * O conserto é o `defaultValue` ser o que foi ENVIADO, que a ação devolve em
 * `valores` (ver `valoresDigitados`). Esta varredura trava a volta: num
 * arquivo com `<form action=`, todo campo de texto tem `value=` (controlado)
 * ou um `defaultValue` que lê `valores`. Senha, segredo, campo escondido e
 * arquivo ficam de fora — os três primeiros DEVEM voltar vazios, e o de
 * arquivo não tem como voltar.
 *
 * `<select>` tem uma regra a mais: o React só aplica o `defaultValue` dele ao
 * MONTAR. Sem uma `key` que mude com o valor devolvido, a limpeza voltaria o
 * seletor para a primeira escolha — calada, e com o próximo envio levando o
 * valor errado.
 *
 * Caixa de marcar é o CONTRÁRIO do campo de texto: controlada (`checked=`),
 * ela NÃO sobrevive. O React acompanha o padrão de um campo de texto
 * controlado, mas não o de uma caixa de marcar — a limpeza a devolve ao
 * valor do primeiro desenho. Foi assim que a A13 mostrava "Cadastro aberto"
 * marcado logo depois de a equipe fechar o cadastro. Numa ação, ela é livre,
 * com um `defaultChecked` que lê o que a ação devolveu.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function arquivos(raiz: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivos(caminho));
    else if (nome.endsWith('.tsx')) achados.push(caminho);
  }
  return achados;
}

/**
 * As tags de abertura com esses nomes, inteiras.
 *
 * A tag só termina no `>` que está FORA de chaves: `onChange={(e) => …}` tem
 * um `>` que não fecha nada.
 */
function tags(fonte: string, nomes: readonly string[]): { texto: string; linha: number }[] {
  const resultado: { texto: string; linha: number }[] = [];
  const padrao = new RegExp(`<(${nomes.join('|')})(?=[\\s/>])`, 'g');

  for (const achado of fonte.matchAll(padrao)) {
    const inicio = achado.index;
    let profundidade = 0;
    let fim = inicio + achado[0].length;

    for (; fim < fonte.length; fim += 1) {
      const letra = fonte[fim];
      if (letra === '{') profundidade += 1;
      else if (letra === '}') profundidade -= 1;
      else if (letra === '>' && profundidade === 0) break;
    }

    resultado.push({
      texto: fonte.slice(inicio, fim + 1),
      linha: fonte.slice(0, inicio).split('\n').length,
    });
  }

  return resultado;
}

const CAMPOS = ['Input', 'input', 'Textarea', 'textarea', 'Select', 'select'] as const;
const LIVRES = /type="(password|hidden|file|radio|checkbox|submit|button)"/;
const DE_MARCAR = /type="(checkbox|radio)"/;

const RAIZ = resolve(import.meta.dirname, '..');

/** Os arquivos com um `<form action=`, sem os comentários. */
function formulariosDeAcao(): { arquivo: string; fonte: string }[] {
  const achados: { arquivo: string; fonte: string }[] = [];

  for (const arquivo of [...arquivos(join(RAIZ, 'app')), ...arquivos(join(RAIZ, 'components'))]) {
    // Comentários saem, trocados por espaço para as linhas não mudarem: um
    // comentário que EXPLICA o `<select>` não é um `<select>`.
    const fonte = readFileSync(arquivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comentario) =>
      comentario.replace(/[^\n]/g, ' '),
    );
    // `method="get"` é a busca que vira URL: o navegador navega, e a página
    // nova já nasce com o termo no campo. Não há ação do React para limpar.
    const temFormDeAcao = tags(fonte, ['form']).some(
      ({ texto }) => /\saction=/.test(texto) && !/\smethod="get"/.test(texto),
    );
    if (temFormDeAcao) achados.push({ arquivo: relative(RAIZ, arquivo), fonte });
  }

  return achados;
}

describe('formulário de ação não se apaga depois de um erro', () => {
  it('todo campo de texto num `<form action=` é controlado', () => {
    const soltos: string[] = [];

    for (const { arquivo, fonte } of formulariosDeAcao()) {
      for (const { texto, linha } of tags(fonte, CAMPOS)) {
        if (LIVRES.test(texto) || /\svalue=/.test(texto)) continue;

        const devolvido = /\sdefaultValue=\{[^}]*valores/.test(texto);
        const ehSeletor = /^<(Select|select)\b/.test(texto);
        if (devolvido && (!ehSeletor || /\skey=/.test(texto))) continue;

        soltos.push(`${arquivo}:${String(linha)}`);
      }
    }

    expect(soltos, 'campos que o React apaga no fim da ação').toEqual([]);
  });

  it('caixa de marcar num `<form action=` é livre, com o padrão devolvido pela ação', () => {
    const erradas: string[] = [];

    for (const { arquivo, fonte } of formulariosDeAcao()) {
      for (const { texto, linha } of tags(fonte, ['Input', 'input'])) {
        if (!DE_MARCAR.test(texto)) continue;

        const controlada = /\schecked(?=[=\s/>])/.test(texto);
        const devolvida = /\sdefaultChecked=\{[^}]*(estado|valores)/.test(texto);
        if (!controlada && devolvida) continue;

        erradas.push(`${arquivo}:${String(linha)}`);
      }

      // O Checkbox e o Switch do Radix ouvem a limpeza do formulário e
      // devolvem o valor ao do primeiro desenho pelo próprio `onCheckedChange`.
      for (const { linha } of tags(fonte, ['Checkbox', 'Switch'])) {
        erradas.push(`${arquivo}:${String(linha)}`);
      }
    }

    expect(erradas, 'caixas de marcar que a limpeza do React desfaz').toEqual([]);
  });
});
