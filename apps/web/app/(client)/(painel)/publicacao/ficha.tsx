'use client';

/**
 * A ficha do app e a política de privacidade (parte da C12).
 *
 * São os campos que a App Store Connect e o Play Console pedem e que travam o
 * lojista: meia dúzia de textos com limites de caractere diferentes, em inglês
 * na tela deles, sem nenhuma pista do que escrever. Aqui ele copia um rascunho
 * pronto, no tamanho certo, feito com o nome e o endereço da loja dele.
 *
 * A política de privacidade é OBRIGATÓRIA nas duas lojas, e é um endereço
 * público que o revisor abre. A Storefy hospeda o dela, montado a partir do
 * que o app realmente faz.
 */
import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { CampoDaFicha } from '@/lib/ficha-da-loja';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function FichaDaLoja({
  campos,
  urlDaPolitica,
  temContato,
}: {
  campos: readonly CampoDaFicha[];
  urlDaPolitica: string;
  /** A loja preencheu o e-mail de atendimento? */
  temContato: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Textos para a loja de aplicativos</h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          A Apple e o Google pedem estes campos ao cadastrar o app. Copie daqui e cole lá — depois
          mude as palavras que quiser.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Política de privacidade</CardTitle>
          <CardDescription>
            As duas lojas exigem um endereço público de política de privacidade, e o revisor abre
            esse link. A Storefy hospeda o da sua loja e o mantém em dia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <LinhaCopiavel valor={urlDaPolitica} monoespacado />

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={urlDaPolitica} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" aria-hidden />
                Abrir a política
              </a>
            </Button>
          </div>

          {/*
            Sem e-mail de atendimento, a política manda o cliente final falar
            com a loja pelo site. Funciona, mas um canal direto é melhor — e a
            App Store Connect pede um contato de suporte de qualquer forma.
          */}
          {temContato ? null : (
            <p className="text-muted-foreground text-xs">
              Cadastre o e-mail de atendimento da loja para ele aparecer aqui. Sem ele, a política
              manda o cliente falar com você pelo site.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rascunho da ficha</CardTitle>
          <CardDescription>
            Cada campo já vem no limite de caracteres que a loja aceita.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {campos.map((campo) => (
            <div key={campo.chave} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{campo.rotulo}</span>
                <span className="text-muted-foreground text-xs">{campo.onde}</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  {campo.valor.length}/{campo.limite}
                </span>
              </div>
              <LinhaCopiavel valor={campo.valor} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Um texto com botão de copiar.
 *
 * O `navigator.clipboard` não existe fora de contexto seguro e pode ser negado
 * pelo navegador. Quando falhar, o texto é selecionado — o lojista termina com
 * Ctrl+C, em vez de clicar num botão que não faz nada.
 */
function LinhaCopiavel({ valor, monoespacado = false }: { valor: string; monoespacado?: boolean }) {
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
    <div className="bg-muted/50 flex items-start gap-2 rounded-lg border p-2.5">
      <pre
        data-texto
        /*
         * `break-words` nos dois: as palavras-chave da App Store são uma
         * cadeia só, separada por vírgula SEM espaço, e vírgula não é ponto de
         * quebra em CSS. Sem isto, aquela linha furava o card e punha rolagem
         * lateral na página inteira no celular.
         */
        className={
          monoespacado
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
