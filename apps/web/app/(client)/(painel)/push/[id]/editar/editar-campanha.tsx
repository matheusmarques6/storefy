'use client';

import { FormularioDaCampanha, type ValoresIniciais } from '../../formulario';
import { editarCampanha } from '../../acoes';

export function EditarCampanha({
  campanhaId,
  nomeDoApp,
  urlDaLoja,
  iniciais,
}: {
  campanhaId: string;
  nomeDoApp: string;
  urlDaLoja: string;
  iniciais: ValoresIniciais;
}) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      rotuloDoEnvio="Salvar alterações"
      iniciais={iniciais}
      aoEnviar={(valores) => editarCampanha(campanhaId, valores)}
    />
  );
}
