'use client';

/** Liga o formulário da campanha às ações do servidor. */
import { FormularioDaCampanha } from '../formulario';
import type { CelularDeTeste } from '@/lib/celular-de-teste';
import { criarCampanha, salvarRascunhoDeCampanha } from '../acoes';

export function NovaCampanha({
  nomeDoApp,
  urlDaLoja,
  fuso,
  nomeDoFuso,
  celulares,
  alcance,
  notificacoesLigadas,
}: {
  nomeDoApp: string;
  urlDaLoja: string;
  fuso: string;
  nomeDoFuso: string;
  celulares: CelularDeTeste[];
  alcance: number | null;
  notificacoesLigadas: boolean;
}) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      fuso={fuso}
      nomeDoFuso={nomeDoFuso}
      celulares={celulares}
      alcance={alcance}
      notificacoesLigadas={notificacoesLigadas}
      rotuloDoEnvio={{ agora: 'Enviar agora', agendado: 'Agendar campanha' }}
      iniciais={{
        title: '',
        body: '',
        deepLink: '',
        agendarPara: '',
        enviarAgora: true,
        imagem: null,
        publico: { tipo: 'todos', dias: '' },
      }}
      aoEnviar={(valores) => criarCampanha(valores)}
      aoSalvarRascunho={(valores) => salvarRascunhoDeCampanha(valores)}
    />
  );
}
