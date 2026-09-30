/**
 * O passo a passo do envio manual (parte da C12).
 *
 * Fica separado da tela porque a lista de passos DEPENDE de ter arquivo: um
 * build que morreu antes de gerar o binário não tem o que baixar, e um passo
 * dizendo "baixe o arquivo no botão abaixo" ao lado de nenhum botão faz o
 * lojista procurar uma coisa que não existe.
 */
import type { AcaoManualDoBuild } from '@/lib/publicacao-servidor';

export interface PassoAPasso {
  titulo: string;
  passos: readonly string[];
}

const BAIXAR = 'Baixe o arquivo do app no botão abaixo.';
const SUPORTE = 'Fale com o suporte: a gente envia por você.';

export function passoAPasso(acao: AcaoManualDoBuild, temArquivo: boolean): PassoAPasso {
  if (acao === 'play_primeiro_envio') {
    return {
      titulo: 'Só o primeiro envio é manual',
      passos: temArquivo
        ? [
            BAIXAR,
            'Abra o Google Play Console e escolha o seu app.',
            'Vá em Teste › Teste interno e clique em "Criar nova versão".',
            'Arraste o arquivo baixado e clique em "Salvar" e depois em "Avaliar versão".',
            /*
             * "As próximas saem daqui automaticamente" era meia verdade: elas
             * chegam sozinhas ao TESTE INTERNO, que nenhum cliente vê. Ir para
             * a produção é um passo do lojista a cada versão — e o cartão
             * "Falta um passo seu" mostra qual, quando chegar a hora.
             */
            'Pronto: as próximas versões chegam sozinhas ao teste interno. Para chegar aos clientes, cada uma é publicada em produção — esta tela avisa quando for a hora.',
          ]
        : /*
           * Sem arquivo, mandar abrir o Play Console seria mandar o lojista
           * para uma tela onde ele não tem o que fazer. O caminho é o suporte,
           * que consegue recuperar o binário pelo link da geração.
           */
          [
            'O arquivo desta geração não ficou disponível para download.',
            'Publique de novo por aqui, ou fale com o suporte.',
          ],
    };
  }

  return {
    titulo: 'O app está pronto; o envio é que falhou',
    passos: temArquivo
      ? [
          BAIXAR,
          'Envie pela App Store Connect (iPhone) ou pelo Google Play Console (Android).',
          SUPORTE,
        ]
      : ['Publique de novo por aqui.', SUPORTE],
  };
}
