/**
 * A01c — Entrada no admin, segundo passo: o código do app autenticador.
 *
 * Recebe só quem é da equipe, acertou a senha e tem o app cadastrado. Quem já
 * confirmou vai direto ao painel; quem ainda não cadastrou o app, ao cadastro.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { equipeNaEntrada } from '@/lib/contexto';
import { MolduraDaEntrada } from '../moldura-da-entrada';
import { FormularioVerificar } from './formulario';

export const metadata: Metadata = { title: 'Verificação em duas etapas · Admin' };

export default async function PaginaVerificar() {
  const { usuario, segundoFator } = await equipeNaEntrada();
  if (segundoFator === 'verificado') redirect('/admin');
  if (segundoFator === 'falta-ativar') redirect('/admin/ativar-2fa');

  return (
    <MolduraDaEntrada>
      <FormularioVerificar email={usuario.email ?? ''} />
    </MolduraDaEntrada>
  );
}
