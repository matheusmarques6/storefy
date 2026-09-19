'use client';

/**
 * Cadastro e edição de loja, com detecção automática (C02–C04).
 *
 * A detecção é o que transforma um cadastro em dois campos: o lojista cola o
 * endereço, o painel lê a página dele e já sabe o nome, a cor e o logo.
 *
 * O que não for encontrado fica em branco, e a tela diz isso. Preencher com um
 * chute — o domínio virando nome, por exemplo — apareceria como certeza, e o
 * app iria para a loja de aplicativos com ele.
 */
import { useActionState, useState, useTransition } from 'react';
import { AlertCircle, Check, Search, Sparkles } from 'lucide-react';
import { detectarLoja, type EstadoLoja } from './acoes';
import type { MarcaDetectada } from '@/lib/deteccao-da-loja';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';

export function FormularioLoja({
  acao,
  nomeInicial = '',
  urlInicial = '',
  rotuloEnvio,
  carregando,
  comDeteccao = false,
}: {
  acao: (anterior: EstadoLoja, dados: FormData) => Promise<EstadoLoja>;
  nomeInicial?: string;
  urlInicial?: string;
  rotuloEnvio: string;
  carregando: string;
  /** A detecção só faz sentido no cadastro; na edição a loja já está lida. */
  comDeteccao?: boolean;
}) {
  const [estado, despachar] = useActionState<EstadoLoja, FormData>(acao, {});
  const [nome, setNome] = useState(nomeInicial);
  const [url, setUrl] = useState(urlInicial);
  const [marca, setMarca] = useState<MarcaDetectada | null>(null);
  const [avisoDaDeteccao, setAviso] = useState<string | null>(null);
  const [detectando, iniciarDeteccao] = useTransition();

  function detectar() {
    setAviso(null);
    iniciarDeteccao(() => {
      void detectarLoja(url).then((resultado) => {
        if (!resultado.ok) {
          setMarca(null);
          setAviso(resultado.motivo);
          return;
        }
        setMarca(resultado.marca);
        // O nome digitado pelo lojista tem prioridade sobre o que lemos.
        if (nome.trim() === '' && resultado.marca.nome !== null) setNome(resultado.marca.nome);
        if (resultado.marca.nome === null) {
          setAviso('Não achamos o nome da loja na página. Preencha acima.');
        }
      });
    });
  }

  return (
    <form action={despachar} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      <Campo
        id="url"
        rotulo="Endereço da loja"
        erro={estado.erros?.url}
        dica="O site que o app vai abrir. Exemplo: minhaloja.com.br"
      >
        <div className="flex gap-2">
          <Input
            {...propsDoCampo('url', estado.erros?.url, true)}
            value={url}
            onChange={(evento) => {
              setUrl(evento.target.value);
              setMarca(null);
            }}
            placeholder="minhaloja.com.br"
            inputMode="url"
            required
          />
          {comDeteccao ? (
            <Button
              type="button"
              variant="outline"
              disabled={detectando || url.trim() === ''}
              onClick={detectar}
              className="shrink-0"
            >
              <Search className="size-4" aria-hidden />
              {detectando ? 'Lendo…' : 'Ler loja'}
            </Button>
          ) : null}
        </div>
      </Campo>

      {avisoDaDeteccao === null ? null : (
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>{avisoDaDeteccao}</AlertDescription>
        </Alert>
      )}

      {marca === null ? null : (
        <div className="flex items-center gap-3 rounded-xl border p-4">
          {marca.logo === null ? (
            <div className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-lg">
              <Sparkles className="text-muted-foreground size-5" aria-hidden />
            </div>
          ) : (
            /*
             * Imagem de fundo, e não `<img>` nem `next/image`: o logo vem do
             * domínio do cliente, que muda a cada loja e não dá para declarar
             * na configuração de imagens do Next.
             */
            <div
              role="img"
              aria-label={`Logo de ${marca.nome ?? 'sua loja'}`}
              className="bg-muted size-12 shrink-0 rounded-lg bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url(${JSON.stringify(marca.logo)})` }}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check className="size-4 text-emerald-600" aria-hidden />
              Encontramos a sua loja
            </p>
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {marca.descricao ?? 'Sem descrição na página inicial.'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {marca.ehShopify ? <Badge variant="secondary">Shopify</Badge> : null}
              {marca.corPrincipal === null ? (
                <Badge variant="outline">Sem cor declarada</Badge>
              ) : (
                <Badge variant="outline" className="gap-1.5">
                  <span
                    aria-hidden
                    className="size-3 rounded-full border"
                    style={{ backgroundColor: marca.corPrincipal }}
                  />
                  {marca.corPrincipal}
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}

      <Campo
        id="nome"
        rotulo="Nome da loja"
        erro={estado.erros?.nome}
        dica="É o nome que aparece no painel e, depois, no app."
      >
        <Input
          {...propsDoCampo('nome', estado.erros?.nome, true)}
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
          }}
          placeholder="Minha Loja"
          required
        />
      </Campo>

      {/* A cor detectada entra no rascunho do app. O servidor revalida. */}
      <input type="hidden" name="corDetectada" value={marca?.corPrincipal ?? ''} />

      <BotaoEnviar carregando={carregando}>{rotuloEnvio}</BotaoEnviar>
    </form>
  );
}
