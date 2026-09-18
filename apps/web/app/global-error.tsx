'use client';

/**
 * Última rede de segurança.
 *
 * Só dispara quando o erro acontece no próprio layout raiz — nesse caso o
 * React não conseguiu montar nada, nem o `<body>`, então este arquivo precisa
 * renderizar `<html>` e `<body>` por conta própria e não pode depender de
 * nenhum componente que use contexto.
 */
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          display: 'flex',
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Algo deu errado
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.75, marginBottom: '1.5rem' }}>
            Não conseguimos carregar o Storefy. Tente de novo em alguns instantes.
            {error.digest == null ? null : ` Código: ${error.digest}`}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: '1px solid currentColor',
              borderRadius: '0.75rem',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              background: 'transparent',
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
