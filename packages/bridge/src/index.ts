/**
 * `@storefy/bridge` — contrato entre a WebView e a camada nativa.
 *
 * Regra 6 do CLAUDE.md: mensagens do bridge só passam pelos tipos daqui.
 */
export * from './mensagens';
export * from './links';
export * from './injecao';
