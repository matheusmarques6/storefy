/** C01 — Definir nova senha, a partir do link recebido por e-mail. */
import type { Metadata } from 'next';
import { FormularioRedefinir } from './formulario';

export const metadata: Metadata = { title: 'Nova senha' };

export default function PaginaRedefinirSenha() {
  return <FormularioRedefinir />;
}
