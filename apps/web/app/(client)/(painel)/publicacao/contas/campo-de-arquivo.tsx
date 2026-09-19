'use client';

/**
 * Campo que lê um arquivo e entrega o TEXTO dele.
 *
 * O arquivo é lido no navegador e vai como texto na ação do servidor. É o que
 * permite validar com a Apple e o Google antes de gravar qualquer coisa — e
 * evita um upload para storage que teria de ser apagado depois, deixando uma
 * chave privada em mais um lugar por alguns segundos.
 *
 * Aceita colar o conteúdo também: muita gente abre o `.p8` no editor e copia,
 * e recusar isso seria teimosia.
 */
import { useRef, useState } from 'react';
import { FileCheck2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  id: string;
  rotulo: string;
  ajuda: string;
  /** Extensões aceitas no seletor de arquivo. */
  aceita: string;
  valor: string;
  aoMudar: (conteudo: string) => void;
  /** Tamanho máximo, em KB. Chave privada não passa de alguns KB. */
  maximoKb?: number;
}

export function CampoDeArquivo({
  id,
  rotulo,
  ajuda,
  aceita,
  valor,
  aoMudar,
  maximoKb = 64,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{rotulo}</Label>

      <input
        ref={entrada}
        type="file"
        accept={aceita}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(evento) => {
          const arquivo = evento.target.files?.[0];
          if (arquivo === undefined) return;

          if (arquivo.size > maximoKb * 1024) {
            setErro(`Esse arquivo é grande demais para ser uma chave. Confira se é o certo.`);
            return;
          }

          void arquivo.text().then(
            (texto) => {
              setNome(arquivo.name);
              setErro(null);
              aoMudar(texto);
            },
            () => {
              setErro('Não conseguimos ler esse arquivo. Tente colar o conteúdo abaixo.');
            },
          );
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            entrada.current?.click();
          }}
        >
          <Upload className="size-4" aria-hidden />
          Escolher arquivo
        </Button>

        {nome === null ? null : (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
            <FileCheck2 className="size-4" aria-hidden />
            {nome}
          </span>
        )}
      </div>

      <Textarea
        id={id}
        rows={3}
        value={valor}
        spellCheck={false}
        onChange={(evento) => {
          setNome(null);
          setErro(null);
          aoMudar(evento.target.value);
        }}
        placeholder="Ou cole o conteúdo do arquivo aqui"
        className="font-mono text-xs"
      />

      <p className={erro === null ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
        {erro ?? ajuda}
      </p>
    </div>
  );
}
