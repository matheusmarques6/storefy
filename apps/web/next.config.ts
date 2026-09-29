import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo são TypeScript puro, sem build próprio.
  transpilePackages: ['@storefy/db', '@storefy/config-schema'],
  typedRoutes: true,
  experimental: {
    serverActions: {
      /*
       * O ícone, a tela de abertura e a imagem do push aceitam até 8 MB, e
       * chegam por Server Action. O padrão do Next é 1 MB: acima disso o
       * pedido morria antes da validação, e quem mandava a tela de abertura
       * de 2 MB via um erro genérico em vez de "passa de 8 MB". A folga
       * cobre o que o multipart acrescenta.
       */
      bodySizeLimit: '9mb',
    },
  },
};

export default config;
