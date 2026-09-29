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
import { ExternalLink, Image as Imagem } from 'lucide-react';
import type { CampoDaFicha } from '@/lib/ficha-da-loja';
import { CAPTURAS, ondeTirar } from '@/lib/capturas-da-loja';
import { Button } from '@/components/ui/button';
import { LinhaCopiavel } from '@/components/linha-copiavel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function FichaDaLoja({
  campos,
  urlDaPolitica,
  temContato,
  jaPublicado,
}: {
  campos: readonly CampoDaFicha[];
  urlDaPolitica: string;
  /** A loja preencheu o e-mail de atendimento? */
  temContato: boolean;
  /** O app da loja já está numa loja de aplicativos? */
  jaPublicado: boolean;
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

      {/*
        As capturas são o último item que trava a publicação, e a Storefy NÃO
        as gera: uma imagem feita de um navegador estreito não é o app — falta
        a barra de status do aparelho, a tab bar nativa e o recorte da tela, e
        a Apple recusa screenshot que é claramente montagem. Dizer isso aqui,
        com a medida exata, é o que evita uma recusa que chega dias depois.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Imagem className="size-4" aria-hidden />
            Capturas de tela
          </CardTitle>
          <CardDescription>
            As duas lojas exigem capturas do app rodando. Elas precisam sair de um celular de
            verdade: uma imagem montada no computador é recusada na revisão.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm">{ondeTirar(jaPublicado)}</p>

          <ul className="space-y-3">
            {CAPTURAS.map((captura) => (
              <li key={captura.loja} className="space-y-0.5 border-l-2 pl-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{captura.loja}</span>
                  <span className="text-muted-foreground text-xs">
                    {captura.nome} · {captura.medida}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Pelo menos {captura.minimo} {captura.minimo === 1 ? 'captura' : 'capturas'}.{' '}
                  {captura.comoTirar}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
