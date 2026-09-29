'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Um texto com botão de copiar.
 *
 * O `navigator.clipboard` não existe fora de contexto seguro e pode ser negado
 * pelo navegador. Quando falhar, o texto é selecionado — o lojista termina com
 * Ctrl+C, em vez de clicar num botão que não faz nada.
 */
export function LinhaCopiavel({
  valor,
  monoespacado = false,
  codigo = false,
}: {
  valor: string;
  monoespacado?: boolean;
  /**
   * Um bloco de código (um JSON de exemplo): as linhas ficam como estão e a
   * caixa rola de lado. Quebrar no meio da palavra, como numa chave comprida,
   * deixaria o exemplo ilegível justo no celular.
   */
  codigo?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  function copiar(elemento: HTMLElement) {
    /*
     * O tipo do DOM diz que `navigator.clipboard` sempre existe; o navegador
     * discorda. Em `http://` — que é como o painel roda numa rede local ou
     * atrás de um proxy sem TLS — a propriedade vem de fato `undefined`, e o
     * acesso direto estoura. A anotação abaixo é o tipo verdadeiro.
     */
    const area = (navigator as { clipboard?: Clipboard }).clipboard;
    if (area === undefined) {
      selecionar(elemento);
      return;
    }

    void area
      .writeText(valor)
      .then(() => {
        setCopiado(true);
        setTimeout(() => {
          setCopiado(false);
        }, 2000);
      })
      .catch(() => {
        // Permissão negada acontece: o lojista termina com Ctrl+C.
        selecionar(elemento);
      });
  }

  return (
    /*
     * Centralizado com o botão, menos no bloco de código: numa linha só, o
     * texto ficava grudado no topo e o botão sobrava embaixo, desalinhados.
     * O código de várias linhas continua começando do alto, junto do botão.
     */
    <div
      className={`bg-muted/50 flex gap-2 rounded-lg border p-2.5 ${codigo ? 'items-start' : 'items-center'}`}
    >
      <pre
        data-texto
        /*
         * `break-words` nos dois: as palavras-chave da App Store são uma
         * cadeia só, separada por vírgula SEM espaço, e vírgula não é ponto de
         * quebra em CSS. Sem isto, aquela linha furava o card e punha rolagem
         * lateral na página inteira no celular.
         */
        className={
          codigo
            ? 'min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre'
            : monoespacado
              ? 'min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap'
              : 'min-w-0 flex-1 font-sans text-sm break-words whitespace-pre-wrap'
        }
      >
        {valor}
      </pre>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={(evento) => {
          copiar(evento.currentTarget.parentElement ?? evento.currentTarget);
        }}
      >
        {copiado ? (
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        <span className="sr-only">{copiado ? 'Copiado' : 'Copiar'}</span>
      </Button>
    </div>
  );
}

/** Seleciona o texto para o lojista terminar com Ctrl+C. */
function selecionar(container: HTMLElement): void {
  const alvo = container.querySelector('[data-texto]');
  if (alvo === null) return;

  const intervalo = document.createRange();
  intervalo.selectNodeContents(alvo);
  const selecao = window.getSelection();
  selecao?.removeAllRanges();
  selecao?.addRange(intervalo);
}
