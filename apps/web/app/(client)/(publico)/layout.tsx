import Link from 'next/link';

/** Moldura das telas públicas (C01): cartão centrado, sem navegação do painel. */
export default function LayoutPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <Link href="/" className="text-2xl font-semibold tracking-tight">
              Storefy
            </Link>
            <p className="text-muted-foreground mt-1 text-sm">Sua loja virou app.</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
