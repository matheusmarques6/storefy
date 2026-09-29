/** C17 — um guia da central de ajuda. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ARTIGOS, artigoPorSlug } from '@/lib/ajuda';
import { Button } from '@/components/ui/button';

export function generateStaticParams() {
  return ARTIGOS.map((artigo) => ({ slug: artigo.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const artigo = artigoPorSlug((await params).slug);
  return { title: artigo === null ? 'Ajuda' : `${artigo.titulo} · Ajuda` };
}

export default async function PaginaArtigo({ params }: { params: Promise<{ slug: string }> }) {
  const artigo = artigoPorSlug((await params).slug);
  if (artigo === null) notFound();

  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/ajuda"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Voltar para a ajuda
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{artigo.titulo}</h1>
        <p className="text-muted-foreground">{artigo.resumo}</p>
      </header>

      {artigo.secoes.map((secao) => (
        <section key={secao.titulo} className="space-y-3">
          <h2 className="text-lg font-semibold">{secao.titulo}</h2>
          {secao.paragrafos.map((paragrafo) => (
            <p key={paragrafo} className="text-sm leading-relaxed">
              {paragrafo}
            </p>
          ))}
          {secao.passos === undefined ? null : (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {secao.passos.map((passo) => (
                <li key={passo}>{passo}</li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {artigo.atalhos.length === 0 ? null : (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {artigo.atalhos.map((atalho) => (
            <Button key={atalho.href} asChild variant="outline" size="sm">
              <Link href={atalho.href}>
                {atalho.rotulo}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ))}
        </div>
      )}

      <p className="text-muted-foreground border-t pt-4 text-sm">
        Não resolveu?{' '}
        <Link
          href="/ajuda#falar-com-o-suporte"
          className="text-foreground underline underline-offset-4"
        >
          Fale com o suporte
        </Link>
        .
      </p>
    </article>
  );
}
