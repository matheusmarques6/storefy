'use client';

/** Liga o formulário da campanha às ações do servidor. */
import { FormularioDaCampanha } from '../formulario';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import { criarCampanha, salvarRascunhoDeCampanha } from '../acoes';

export function NovaCampanha({
  nomeDoApp,
  urlDaLoja,
  aparelhos,
}: {
  nomeDoApp: string;
  urlDaLoja: string;
  aparelhos: AparelhoParaTeste[];
}) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      aparelhos={aparelhos}
      rotuloDoEnvio="Enviar campanha"
      iniciais={{ title: '', body: '', deepLink: '', agendarPara: '', enviarAgora: true }}
      aoEnviar={(valores) => criarCampanha(valores)}
      aoSalvarRascunho={(valores) => salvarRascunhoDeCampanha(valores)}
    />
  );
}
