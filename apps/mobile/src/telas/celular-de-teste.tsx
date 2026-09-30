/**
 * O celular de teste, visto do celular (C08).
 *
 * Aberto pelo QR do painel: o link `storefy-<loja>://celular-de-teste?codigo=...`
 * cai aqui, e não na página da loja. A tela registra este celular e o pareia
 * como celular de teste do lojista — é só para ele que o envio de teste do
 * painel manda a notificação, e nunca para um cliente.
 */
import { useEffect, useState } from 'react';
import { Modal, Platform } from 'react-native';
import type { Theme } from '@storefy/config-schema';
import { Aviso, TelaDeCarregamento } from './avisos';
import type { Ambiente } from '../nucleo/ambiente';
import { credenciaisDe, parearCelularDeTeste, registrarAparelho } from '../push/api';
import { idDaInstalacao } from '../push/disco';
import { notificadorReal } from '../push/onesignal';
import {
  mensagemDoPareamento,
  parearEsteCelular,
  type ResultadoDoPareamento,
} from '../push/pareamento';

const SEM_CREDENCIAL = { ok: false, motivo: 'recusado' } as const;

export function CelularDeTeste({
  codigo,
  ambiente,
  tema,
  pushAtivo,
  aoFechar,
}: {
  /** O código lido do QR; `null` deixa a tela fechada. */
  codigo: string | null;
  ambiente: Ambiente;
  tema: Pick<Theme, 'background' | 'text' | 'primary'>;
  /** Com o push ligado, a inscrição vai junto e o celular recebe o teste. */
  pushAtivo: boolean;
  aoFechar: () => void;
}): React.ReactNode {
  const [resultado, setResultado] = useState<{
    codigo: string;
    valor: ResultadoDoPareamento;
  } | null>(null);

  useEffect(() => {
    if (codigo === null) return;
    let vivo = true;
    const credenciais = credenciaisDe(ambiente);
    const plataforma = Platform.OS === 'ios' ? 'ios' : 'android';

    void parearEsteCelular(codigo, {
      credenciais,
      instalacao: idDaInstalacao,
      inscricao: () => (pushAtivo ? notificadorReal.idDaInscricao() : Promise.resolve(null)),
      registrar: (identidade) =>
        credenciais === null
          ? Promise.resolve(SEM_CREDENCIAL)
          : registrarAparelho(credenciais, {
              ...identidade,
              platform: plataforma,
              appVersion: ambiente.appVersion,
            }),
      parear: (dados) =>
        credenciais === null
          ? Promise.resolve(SEM_CREDENCIAL)
          : parearCelularDeTeste(credenciais, dados),
    }).then((valor) => {
      if (vivo) setResultado({ codigo, valor });
    });

    return () => {
      vivo = false;
    };
  }, [codigo, ambiente, pushAtivo]);

  // O resultado de um código antigo não vale para o novo: um segundo QR recomeça.
  const atual = resultado !== null && resultado.codigo === codigo ? resultado.valor : null;
  const mensagem = atual === null ? null : mensagemDoPareamento(atual);

  return (
    <Modal
      visible={codigo !== null}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={aoFechar}
    >
      {mensagem === null ? (
        <TelaDeCarregamento cores={tema} />
      ) : (
        <Aviso
          icone={mensagem.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          titulo={mensagem.titulo}
          corpo={mensagem.texto}
          cores={tema}
          acao={{ rotulo: 'Voltar para a loja', aoTocar: aoFechar }}
        />
      )}
    </Modal>
  );
}
