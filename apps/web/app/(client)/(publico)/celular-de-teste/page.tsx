/**
 * A ponte do QR até o app da loja (parte da C08).
 *
 * O QR do celular de teste carrega um link https para esta página, e não o
 * esquema do app: toda câmera abre um link https, e nem toda câmera do
 * Android abre um esquema próprio. Daqui, um toque abre o app da loja com o
 * código, e o app termina o pareamento.
 *
 * Pública e sem banco: a loja e o código vêm no fragmento do link, que o
 * navegador não manda ao servidor. A página só confere o formato e monta o
 * botão.
 */
import type { Metadata } from 'next';
import { AbrirNoApp } from './abrir-no-app';

export const metadata: Metadata = {
  title: 'Celular de teste',
  // O link carrega um código de uso único: não há o que indexar.
  robots: { index: false, follow: false },
};

export default function PaginaDoCelularDeTeste() {
  return <AbrirNoApp />;
}
