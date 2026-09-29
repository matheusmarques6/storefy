'use client';

import { entrarComGoogle } from './acoes';
import { Button } from '@/components/ui/button';

/**
 * Entrar com Google — e o divisor "ou" que o antecede.
 *
 * SEM O GOOGLE CONFIGURADO, NADA APARECE. Esta já foi a decisão contrária:
 * o botão aparecia desabilitado com "Login com Google ainda não configurado
 * neste ambiente". A intenção era a da regra 1 — integração ausente mostra
 * estado claro —, mas a regra fala de integração que QUEM ESTÁ NA TELA pode
 * configurar. Esta é uma chave da plataforma: o lojista não tem o que fazer
 * com o aviso, e "neste ambiente" é jargão de operador na primeira tela do
 * produto. O estado de "não configurado" mora onde alguém pode agir sobre
 * ele: a A13, no admin, que lista `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED`.
 *
 * O divisor vem junto porque, sem o botão, ele sobraria como um "ou" órfão
 * separando o formulário de nada. Quem descobriu isso foi o e2e, na primeira
 * vez que rodou: a tela tinha dois botões "Entrar", e um deles não fazia nada.
 */
export function BotaoGoogle({ habilitado }: { habilitado: boolean }) {
  if (!habilitado) return null;

  return (
    <>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-muted/30 text-muted-foreground px-2">ou</span>
        </div>
      </div>

      <form action={entrarComGoogle}>
        <Button type="submit" variant="outline" className="w-full">
          <IconeGoogle />
          Entrar com Google
        </Button>
      </form>
    </>
  );
}

function IconeGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z"
      />
    </svg>
  );
}
