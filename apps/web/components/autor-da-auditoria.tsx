/** O "quem" de uma linha da auditoria (A12 e A04). Ver `rotuloDoAutor`. */
import { rotuloDoAutor, type AutorDaAuditoria } from '@/lib/autor-da-auditoria';
import { Badge } from '@/components/ui/badge';

export function AutorDaLinha({
  actorId,
  autor,
}: {
  actorId: string | null;
  autor: AutorDaAuditoria | undefined;
}) {
  const rotulo = rotuloDoAutor(actorId, autor);
  if (rotulo.tipo !== 'pessoa') {
    return <span className="text-muted-foreground">{rotulo.texto}</span>;
  }
  return (
    <span className="flex flex-col">
      <span className="flex flex-wrap items-center gap-1.5">
        {rotulo.texto}
        {rotulo.equipe ? <Badge variant="secondary">Equipe</Badge> : null}
      </span>
      {rotulo.detalhe === null ? null : (
        <span className="text-muted-foreground text-xs">{rotulo.detalhe}</span>
      )}
    </span>
  );
}
