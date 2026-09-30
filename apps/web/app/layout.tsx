import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

/*
 * Inter, a tipografia da seção 10 do plano, servida pelo próprio painel: o
 * `next/font` a baixa no build, e o navegador de quem usa não fala com o
 * Google. Antes o CSS só DIZIA "Inter" — quem não a tinha instalada via a
 * fonte do sistema, e o painel mudava de cara de um computador para outro.
 */
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: {
    default: 'Storefy',
    template: '%s · Storefy',
  },
  description: 'Sua loja virou app. Transforme sua loja Shopify em um app iOS e Android.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        {children}
        <Toaster
          position="top-right"
          richColors
          closeButton
          // Os rótulos de fábrica são em inglês ("Close toast", "Notifications"),
          // e é assim que o leitor de tela os leria para o lojista.
          containerAriaLabel="Avisos"
          toastOptions={{ closeButtonAriaLabel: 'Fechar aviso' }}
        />
      </body>
    </html>
  );
}
