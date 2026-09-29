/** C01 — Login. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { env } from '@/lib/env';
import { BotaoGoogle } from '../botao-google';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

const MENSAGENS_DE_ERRO: Record<string, string> = {
  google: 'Não foi possível entrar com o Google. Tente novamente ou use e-mail e senha.',
  'link-invalido': 'Esse link não é válido. Peça um novo para continuar.',
  'link-expirado': 'Esse link expirou. Peça um novo para continuar.',
  'cadastro-fechado':
    'Os cadastros estão fechados por enquanto, e não há conta com esse e-mail. Se você recebeu um convite, abra o link que chegou no seu e-mail.',
  'conta-nao-criada':
    'Não conseguimos criar a sua conta agora. Tente de novo em instantes, ou entre com e-mail e senha.',
};

export default async function PaginaEntrar({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; proximo?: string }>;
}) {
  const params = await searchParams;
  const erro = params.erro == null ? undefined : MENSAGENS_DE_ERRO[params.erro];

  return (
    <div className="space-y-6">
      <FormularioLogin erroExterno={erro} proximo={params.proximo ?? ''} />

      <BotaoGoogle habilitado={env.googleHabilitado} />

      <p className="text-muted-foreground text-center text-sm">
        Ainda não tem conta?{' '}
        <Link
          href="/cadastrar"
          className="text-foreground font-medium underline underline-offset-4"
        >
          Criar conta
        </Link>
      </p>
    </div>
  );
}
