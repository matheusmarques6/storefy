/**
 * Substituto de `server-only` nos testes.
 *
 * O pacote de verdade existe para QUEBRAR O BUILD quando um módulo de servidor
 * é importado de um componente de cliente — é uma marca, não código. O Next o
 * resolve pelo próprio bundler; o vitest roda em Node e não o encontra, e o
 * teste de um módulo marcado assim nem começava.
 *
 * Trocar por um arquivo vazio mantém a garantia onde ela importa (no build) e
 * deixa o módulo testável.
 */
export {};
