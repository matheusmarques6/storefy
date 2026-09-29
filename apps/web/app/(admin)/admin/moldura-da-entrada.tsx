/**
 * A moldura das telas de entrada do admin (A01): a marca em cima e o cartão
 * no meio. Login, código do app autenticador e cadastro do app usam a mesma,
 * para os três passos parecerem um caminho só.
 */
export function MolduraDaEntrada({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-tight">Storefy</p>
          <p className="text-muted-foreground mt-1 text-sm">Administração da plataforma</p>
        </div>
        {children}
      </div>
    </div>
  );
}
