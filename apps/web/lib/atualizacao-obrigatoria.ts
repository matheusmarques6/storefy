/**
 * A atualização obrigatória do app (`minSupportedBuild`).
 *
 * O app compara o número do build instalado com `minSupportedBuild` da config
 * e, se o instalado for menor, mostra "Atualize o app" e não deixa passar
 * (`apps/mobile/src/config/decisao.ts`). É para quando a versão antiga tem um
 * problema sério — e é drástico: quem não atualizar fica sem o app.
 *
 * O número é um só para as duas plataformas, e o contador é POR APP (ver
 * `reservar_versao_do_build`). Por isso o número que dá para exigir é o MENOR
 * entre os últimos aprovados de cada plataforma: o mais novo do Android pode
 * não existir no iPhone, e exigi-lo travaria quem usa iPhone. O banco confere
 * a mesma regra ao publicar.
 */
import type { AppConfig } from '@storefy/config-schema';

export interface BuildAprovado {
  plataforma: 'ios' | 'android';
  numero: number;
}

/** O número mais alto que dá para exigir hoje, ou `null` sem nada aprovado. */
export function numeroExigivel(aprovados: readonly BuildAprovado[]): number | null {
  const maiorPorPlataforma = new Map<BuildAprovado['plataforma'], number>();
  for (const build of aprovados) {
    const atual = maiorPorPlataforma.get(build.plataforma) ?? 0;
    if (build.numero > atual) maiorPorPlataforma.set(build.plataforma, build.numero);
  }
  if (maiorPorPlataforma.size === 0) return null;
  return Math.min(...maiorPorPlataforma.values());
}

/** A versão que a loja mostra para um número de build. Ver `reservar_versao_do_build`. */
export function versaoDoNumero(numero: number): string {
  return `1.0.${String(numero)}`;
}

/** `1` é o padrão do schema, e quer dizer "não exigir nada". */
export const SEM_EXIGENCIA = 1;

export function exigeAtualizacao(config: AppConfig): boolean {
  return config.minSupportedBuild > SEM_EXIGENCIA;
}

/** A config exigindo este número — ou nada, com `null`. */
export function comAtualizacaoObrigatoria(config: AppConfig, numero: number | null): AppConfig {
  return { ...config, minSupportedBuild: numero ?? SEM_EXIGENCIA };
}
