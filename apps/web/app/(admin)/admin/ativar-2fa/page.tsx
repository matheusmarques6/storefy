/**
 * A01b — Entrada no admin, primeira vez: cadastrar o app autenticador.
 *
 * Recebe só quem é da equipe, acertou a senha e ainda não tem o app — no
 * primeiro acesso, ou depois de um superadmin redefinir o segundo fator de
 * quem perdeu o celular. Quem já tem o app vai digitar o código.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { equipeNaEntrada } from '@/lib/contexto';
import { MolduraDaEntrada } from '../moldura-da-entrada';
import { CadastroDoAppAutenticador } from './cadastro';

export const metadata: Metadata = { title: 'Ativar a verificação em duas etapas · Admin' };

export default async function PaginaAtivarSegundoFator() {
  const { usuario, segundoFator } = await equipeNaEntrada();
  if (segundoFator === 'verificado') redirect('/admin');
  if (segundoFator === 'falta-verificar') redirect('/admin/verificar');

  return (
    <MolduraDaEntrada>
      <CadastroDoAppAutenticador email={usuario.email ?? ''} />
    </MolduraDaEntrada>
  );
}
