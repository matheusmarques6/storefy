/** A01 — Login admin. */
import type { Metadata } from 'next';
import { MolduraDaEntrada } from '../moldura-da-entrada';
import { FormularioLoginAdmin } from './formulario';

export const metadata: Metadata = { title: 'Entrar · Admin' };

export default function PaginaEntrarAdmin() {
  return (
    <MolduraDaEntrada>
      <FormularioLoginAdmin />
    </MolduraDaEntrada>
  );
}
