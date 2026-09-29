import { Button } from '@/components/ui/button';

// A leitura e a sanitização dos parâmetros vivem em `@/lib/listagem`, que tem
// testes próprios. Aqui fica só o que desenha. A paginação em si é comum aos
// dois painéis (a Ajuda do cliente também lista).
export { POR_PAGINA, lerParams } from '@/lib/listagem';
export { Paginacao } from '@/components/paginacao';

/**
 * Campo de busca. Envia por GET para o filtro viver na URL.
 *
 * `extras` são os outros filtros da tela (a organização, na A12), que seguem
 * junto: sem eles, buscar apagaria o filtro que já estava aplicado.
 */
export function CampoBusca({
  acao,
  valor,
  placeholder,
  extras,
}: {
  acao: string;
  valor: string;
  placeholder: string;
  extras?: Record<string, string>;
}) {
  return (
    <form action={acao} method="get" className="flex gap-2">
      {Object.entries(extras ?? {}).map(([nome, conteudo]) => (
        <input key={nome} type="hidden" name={nome} value={conteudo} />
      ))}
      <input
        type="search"
        name="q"
        defaultValue={valor}
        placeholder={placeholder}
        aria-label={placeholder}
        className="border-input bg-background focus-visible:ring-ring h-10 w-full max-w-sm rounded-xl border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      />
      <Button type="submit" variant="outline">
        Buscar
      </Button>
    </form>
  );
}
