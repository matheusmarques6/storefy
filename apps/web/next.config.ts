import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo são TypeScript puro, sem build próprio.
  transpilePackages: ['@storefy/db', '@storefy/config-schema'],
  typedRoutes: true,
};

export default config;
