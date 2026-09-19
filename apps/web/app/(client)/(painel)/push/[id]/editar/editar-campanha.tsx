'use client';

import { FormularioDaCampanha, type ValoresIniciais } from '../../formulario';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import { editarCampanha } from '../../acoes';

export function EditarCampanha({
  campanhaId,
  nomeDoApp,
  urlDaLoja,
  aparelhos,
  iniciais,
}: {
  campanhaId: string;
  nomeDoApp: string;
  urlDaLoja: string;
  aparelhos: AparelhoParaTeste[];
  iniciais: ValoresIniciais;
}) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      aparelhos={aparelhos}
      rotuloDoEnvio="Salvar alterações"
      iniciais={iniciais}
      aoEnviar={(valores) => editarCampanha(campanhaId, valores)}
    />
  );
}
