/**
 * O que muda, agrupado pela seção do editor (C06 ao publicar, C06f ao
 * comparar versões). As frases vêm de `diferencasDaConfig`.
 */
import type { Diferenca, SecaoDaDiferenca } from '@/lib/diferencas-da-config';

export function ListaDeDiferencas({
  diferencas,
  maximo,
}: {
  diferencas: readonly Diferenca[];
  /** Quantas mostrar; o resto vira "e mais N". Sem limite quando ausente. */
  maximo?: number;
}) {
  const visiveis = maximo === undefined ? diferencas : diferencas.slice(0, maximo);
  const escondidas = diferencas.length - visiveis.length;

  const grupos = new Map<SecaoDaDiferenca, string[]>();
  for (const diferenca of visiveis) {
    const lista = grupos.get(diferenca.secao) ?? [];
    lista.push(diferenca.texto);
    grupos.set(diferenca.secao, lista);
  }

  return (
    <div className="space-y-3 text-sm">
      {[...grupos].map(([secao, textos]) => (
        <section key={secao} aria-label={secao} className="space-y-1">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {secao}
          </h4>
          <ul className="text-foreground list-disc space-y-0.5 pl-5">
            {textos.map((texto, indice) => (
              <li key={`${String(indice)}-${texto}`}>{texto}</li>
            ))}
          </ul>
        </section>
      ))}
      {escondidas > 0 ? (
        <p className="text-muted-foreground text-xs">
          E mais {escondidas} {escondidas === 1 ? 'mudança' : 'mudanças'}.
        </p>
      ) : null}
    </div>
  );
}
