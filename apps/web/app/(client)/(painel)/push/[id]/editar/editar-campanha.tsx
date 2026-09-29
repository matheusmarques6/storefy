'use client';

import { FormularioDaCampanha, type ValoresDoEnvio, type ValoresIniciais } from '../../formulario';
import type { AparelhoParaTeste } from '@/lib/push-servidor';
import { atualizarRascunho, editarCampanha } from '../../acoes';

/**
 * A edição, que é duas telas numa só.
 *
 * Rascunho: salvar guarda o texto e NÃO envia; enviar ou agendar é um botão à
 * parte, que diz o que faz. Agendada: salvar mantém o agendamento, com o novo
 * texto e a nova hora.
 */
export function EditarCampanha({
  campanhaId,
  rascunho,
  nomeDoApp,
  urlDaLoja,
  fuso,
  nomeDoFuso,
  aparelhos,
  alcance,
  notificacoesLigadas,
  iniciais,
}: {
  campanhaId: string;
  rascunho: boolean;
  nomeDoApp: string;
  urlDaLoja: string;
  fuso: string;
  nomeDoFuso: string;
  aparelhos: AparelhoParaTeste[];
  alcance: number | null;
  notificacoesLigadas: boolean;
  iniciais: ValoresIniciais;
}) {
  return (
    <FormularioDaCampanha
      nomeDoApp={nomeDoApp}
      urlDaLoja={urlDaLoja}
      fuso={fuso}
      nomeDoFuso={nomeDoFuso}
      aparelhos={aparelhos}
      alcance={alcance}
      notificacoesLigadas={notificacoesLigadas}
      rotuloDoEnvio={
        rascunho
          ? { agora: 'Enviar agora', agendado: 'Agendar campanha' }
          : { agora: 'Enviar agora', agendado: 'Salvar alterações' }
      }
      iniciais={iniciais}
      aoEnviar={(valores) => editarCampanha(campanhaId, valores)}
      {...(rascunho
        ? {
            aoSalvarRascunho: (valores: Omit<ValoresDoEnvio, 'agendarPara' | 'enviarAgora'>) =>
              atualizarRascunho(campanhaId, valores),
            rotuloDoRascunho: 'Salvar rascunho',
          }
        : {})}
    />
  );
}
