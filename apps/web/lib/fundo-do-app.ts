/**
 * A cor de fundo que o BUILD usa na tela de abertura e atrás do ícone
 * adaptativo do Android (`SPLASH_BG`): a cor de fundo do tema, quando é um
 * hexadecimal que o Expo aceita; senão, branco.
 *
 * Mora aqui, e não na rota do build, para a prévia do editor desenhar a
 * abertura com EXATAMENTE a cor que o binário vai ter.
 */
export function fundoDoApp(config: unknown): string {
  if (config === null || typeof config !== 'object') return '#ffffff';
  const tema = (config as Record<string, unknown>).theme;
  if (tema === null || typeof tema !== 'object') return '#ffffff';

  const fundo = (tema as Record<string, unknown>).background;
  return typeof fundo === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(fundo)
    ? fundo
    : '#ffffff';
}
