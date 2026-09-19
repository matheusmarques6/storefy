/**
 * O passo a passo do envio manual (parte da C12).
 *
 * Existe por causa de uma regra do Google: o PRIMEIRO `.aab` de um app tem de
 * ser subido à mão no Play Console. Nenhuma API publica um app que ainda não
 * existe lá — não é defeito nosso nem dele, e vale uma vez por app.
 *
 * Sem esta tela, o lojista veria "Falhou" com uma mensagem de API e abriria um
 * chamado achando que o produto quebrou. Com ela, ele resolve em cinco minutos
 * e nunca mais precisa passar por isso.
 */
import { Download, ExternalLink, Info } from 'lucide-react';
import type { AcaoManualDoBuild } from '@/lib/publicacao-servidor';
import { passoAPasso } from '@/lib/passo-manual';
import { Button } from '@/components/ui/button';

const LOJA: Record<'ios' | 'android', { nome: string; url: string }> = {
  ios: { nome: 'Abrir a App Store Connect', url: 'https://appstoreconnect.apple.com' },
  android: { nome: 'Abrir o Play Console', url: 'https://play.google.com/console' },
};

export function PassoManual({
  acao,
  plataforma,
  artifactUrl,
}: {
  acao: AcaoManualDoBuild;
  plataforma: 'ios' | 'android';
  /** Link do binário. Nulo quando o build morreu antes de gerar o arquivo. */
  artifactUrl: string | null;
}) {
  const { titulo, passos } = passoAPasso(acao, artifactUrl !== null);
  const loja = LOJA[plataforma];

  return (
    <div className="bg-muted/50 mt-3 space-y-3 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-sm font-medium">{titulo}</p>
      </div>

      <ol className="text-muted-foreground ml-6 list-decimal space-y-1 text-sm">
        {passos.map((passo) => (
          <li key={passo}>{passo}</li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {/*
          O link do arquivo pode não existir: um build que morreu antes de gerar
          o binário não tem o que baixar. Mostrar um botão que leva a lugar
          nenhum seria pior do que não mostrar botão.
        */}
        {artifactUrl === null ? null : (
          <Button asChild size="sm">
            <a href={artifactUrl} target="_blank" rel="noreferrer noopener">
              <Download className="size-4" aria-hidden />
              Baixar o arquivo do app
            </a>
          </Button>
        )}

        <Button asChild size="sm" variant="outline">
          <a href={loja.url} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="size-4" aria-hidden />
            {loja.nome}
          </a>
        </Button>
      </div>
    </div>
  );
}
