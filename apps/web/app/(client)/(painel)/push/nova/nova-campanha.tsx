'use client';

/** Liga o formulário da campanha às ações do servidor. */
import { FormularioDaCampanha } from '../formulario';
import { criarCampanha, salvarRascunhoDeCampanha } from '../acoes';

export function NovaCampanha({ nomeDoApp, urlDaLoja }: { nomeDoApp: string; urlDaLoja: string }) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      rotuloDoEnvio="Enviar campanha"
      iniciais={{ title: '', body: '', deepLink: '', agendarPara: '', enviarAgora: true }}
      aoEnviar={(valores) => criarCampanha(valores)}
      aoSalvarRascunho={(valores) => salvarRascunhoDeCampanha(valores)}
    />
  );
}
