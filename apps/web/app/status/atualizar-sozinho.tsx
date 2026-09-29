'use client';

/** A página de status se atualiza sozinha, para quem a deixa aberta. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function AtualizarSozinho({ segundos }: { segundos: number }) {
  const router = useRouter();
  useEffect(() => {
    const relogio = setInterval(() => {
      router.refresh();
    }, segundos * 1000);
    return () => {
      clearInterval(relogio);
    };
  }, [router, segundos]);
  return null;
}
