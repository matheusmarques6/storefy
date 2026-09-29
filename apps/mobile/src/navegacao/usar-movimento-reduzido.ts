/**
 * "Reduzir movimento" ligado no aparelho (iOS e Android).
 *
 * Quem liga isso nos ajustes pediu ao sistema menos animação — por enjoo,
 * por foco, por bateria. O app obedece: as trocas de aba entram sem movimento.
 * Acompanha a mudança com o app aberto.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function usarMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);

  useEffect(() => {
    let ativo = true;
    const estaAtivo = (): boolean => ativo;
    void AccessibilityInfo.isReduceMotionEnabled().then((valor) => {
      if (estaAtivo()) setReduzido(valor);
    });
    const inscricao = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzido);
    return () => {
      ativo = false;
      inscricao.remove();
    };
  }, []);

  return reduzido;
}
