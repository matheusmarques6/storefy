'use client';

/**
 * Emoji no título e na mensagem da campanha (C08).
 *
 * O teclado do computador não tem emoji à vista, e é na notificação que ele
 * mais aparece: 🔥 numa promoção relâmpago, 🎁 num presente. A lista é curta
 * de propósito — os que o comércio usa —, e cada um tem nome, para o leitor de
 * tela dizer o que vai entrar.
 */
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const EMOJIS_DO_PUSH: readonly { emoji: string; nome: string }[] = [
  { emoji: '🔥', nome: 'fogo' },
  { emoji: '🎉', nome: 'festa' },
  { emoji: '🛍️', nome: 'sacolas de compras' },
  { emoji: '🎁', nome: 'presente' },
  { emoji: '⏰', nome: 'despertador' },
  { emoji: '⚡', nome: 'raio' },
  { emoji: '💥', nome: 'explosão' },
  { emoji: '✨', nome: 'brilho' },
  { emoji: '🌟', nome: 'estrela' },
  { emoji: '❤️', nome: 'coração' },
  { emoji: '😍', nome: 'apaixonado' },
  { emoji: '🤩', nome: 'deslumbrado' },
  { emoji: '🥳', nome: 'comemorando' },
  { emoji: '😉', nome: 'piscando' },
  { emoji: '👀', nome: 'olhos' },
  { emoji: '👉', nome: 'apontando' },
  { emoji: '✅', nome: 'confirmado' },
  { emoji: '🆕', nome: 'novo' },
  { emoji: '🏷️', nome: 'etiqueta de preço' },
  { emoji: '💸', nome: 'dinheiro voando' },
  { emoji: '💯', nome: 'cem' },
  { emoji: '🚚', nome: 'caminhão de entrega' },
  { emoji: '📦', nome: 'pacote' },
  { emoji: '🔔', nome: 'sino' },
];

export function SeletorDeEmoji({
  rotulo,
  aoEscolher,
  desabilitado = false,
}: {
  /** "Inserir emoji no título" — o nome do botão para o leitor de tela. */
  rotulo: string;
  aoEscolher: (emoji: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={desabilitado}>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={rotulo}>
          <Smile className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="grid w-60 min-w-0 grid-cols-6 gap-0.5 p-1.5"
        // O foco volta para o campo onde o emoji entrou (quem chama cuida
        // disso), e não para este botão.
        onCloseAutoFocus={(evento) => {
          evento.preventDefault();
        }}
      >
        {EMOJIS_DO_PUSH.map(({ emoji, nome }) => (
          <DropdownMenuItem
            key={emoji}
            aria-label={nome}
            title={nome}
            className="justify-center px-0 py-1.5 text-lg"
            onSelect={() => {
              aoEscolher(emoji);
            }}
          >
            {emoji}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
