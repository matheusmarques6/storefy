/**
 * As mensagens de um chamado, iguais nas duas pontas (C17 e A14). Quem é a
 * equipe e quem é o cliente fica visível pelo lado e pela cor, e não só pelo
 * nome — o nome de quem atendeu não aparece para o lojista.
 */
import { formatarDataHora } from '@/lib/fuso';
import { cn } from '@/lib/utils';

export interface MensagemDoChamado {
  id: string;
  daEquipe: boolean;
  texto: string;
  autor: string;
  quando: string | null;
}

export function ConversaDoChamado({
  mensagens,
  fuso,
  ladoDaEquipe,
}: {
  mensagens: MensagemDoChamado[];
  fuso: string;
  /** Quem lê: a equipe vê as próprias mensagens à direita, e o lojista as dele. */
  ladoDaEquipe: boolean;
}) {
  return (
    <ol className="space-y-3" aria-label="Mensagens do chamado">
      {mensagens.map((mensagem) => {
        const minha = mensagem.daEquipe === ladoDaEquipe;
        return (
          <li key={mensagem.id} className={cn('flex', minha ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl border px-4 py-3 text-sm',
                mensagem.daEquipe ? 'bg-muted' : 'bg-background',
              )}
            >
              <p className="text-muted-foreground mb-1 text-xs">
                <span className="text-foreground font-medium">{mensagem.autor}</span> ·{' '}
                {formatarDataHora(mensagem.quando, fuso)}
              </p>
              <p className="break-words whitespace-pre-wrap">{mensagem.texto}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
