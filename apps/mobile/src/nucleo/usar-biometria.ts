/**
 * A trava da aba Conta com Face ID ou digital (M06).
 *
 * O que decide é `biometria.ts` (puro e testado). Aqui fica o que depende do
 * aparelho: o sensor, o cadastro, o pedido ao sistema e o relógio do segundo
 * plano.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  binarioComBiometria,
  depoisDoPedido,
  deveProtegerConta,
  trancarAoVoltar,
} from './biometria';

/**
 * - `livre`: a página da conta aparece (sem proteção, ou já desbloqueada);
 * - `verificando`: perguntando ao aparelho se há sensor e cadastro — dura
 *   milissegundos, e nesse meio tempo a conta não aparece;
 * - `trancada`: a tela de desbloqueio cobre a conta.
 */
export type SituacaoDaConta = 'livre' | 'verificando' | 'trancada';

export interface ProtecaoDaConta {
  situacao: SituacaoDaConta;
  /** Este aparelho, com esta config, pede desbloqueio para ver a conta. */
  protegida: boolean;
  /**
   * Já foi desbloqueada nesta sessão. A página da conta pode ficar montada por
   * baixo da trava quando ela volta; antes disso, nem é carregada.
   */
  jaAbriu: boolean;
  /** Um pedido está na tela do sistema. */
  pedindo: boolean;
  /** O que dizer depois de uma tentativa que não abriu. */
  aviso: string | null;
  /** Pede o rosto, a digital ou a senha do aparelho. */
  desbloquear: () => Promise<void>;
}

interface Aparelho {
  temSensor: boolean;
  temCadastro: boolean;
}

export function usarProtecaoDaConta(recursoLigado: boolean): ProtecaoDaConta {
  // O binário não muda durante a sessão.
  const binarioPermite = useMemo(() => binarioComBiometria(Constants.expoConfig?.plugins), []);
  const podeProteger = recursoLigado && binarioPermite;

  const [aparelho, setAparelho] = useState<Aparelho | null>(null);
  const [trancada, setTrancada] = useState(true);
  const [jaAbriu, setJaAbriu] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const pedidoEmCurso = useRef(false);
  const saiuEm = useRef<number | null>(null);

  // A config pode ligar o recurso com o app aberto (a busca em segundo plano
  // traz a versão nova); é quando vale a pena perguntar ao aparelho.
  useEffect(() => {
    if (!podeProteger || aparelho !== null) return;
    let ativo = true;
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()])
      .then(([temSensor, temCadastro]) => {
        if (ativo) setAparelho({ temSensor, temCadastro });
      })
      .catch(() => {
        // Sem como perguntar ao aparelho, ninguém fica trancado para fora.
        if (ativo) setAparelho({ temSensor: false, temCadastro: false });
      });
    return () => {
      ativo = false;
    };
  }, [podeProteger, aparelho]);

  // Depois de um tempo em segundo plano, a conta volta a pedir desbloqueio.
  // Só `background` conta: o próprio Face ID deixa o app `inactive` no iOS, e
  // contar isso trancaria a conta logo depois de abri-la.
  useEffect(() => {
    const assinatura = AppState.addEventListener('change', (estado) => {
      if (estado === 'background') {
        saiuEm.current = Date.now();
      } else if (estado === 'active') {
        if (trancarAoVoltar(saiuEm.current, Date.now())) {
          setTrancada(true);
          setAviso(null);
        }
        saiuEm.current = null;
      }
    });
    return () => {
      assinatura.remove();
    };
  }, []);

  const desbloquear = useCallback(async (): Promise<void> => {
    // Dois toques rápidos no botão, ou o toque junto com o pedido automático,
    // abririam duas vezes a tela do sistema.
    if (pedidoEmCurso.current) return;
    pedidoEmCurso.current = true;
    setPedindo(true);
    setAviso(null);
    try {
      const resposta = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloquear a sua conta',
        cancelLabel: 'Cancelar',
        fallbackLabel: 'Usar a senha do celular',
        // A senha do aparelho vale como alternativa: quem está de máscara ou
        // com o dedo molhado não fica sem a conta.
        disableDeviceFallback: false,
      });
      const depois = depoisDoPedido(resposta);
      if (depois.acao === 'abrir') {
        setTrancada(false);
        setJaAbriu(true);
      } else {
        setAviso(depois.aviso);
      }
    } catch {
      setAviso('Não deu para confirmar que é você. Tente de novo.');
    } finally {
      pedidoEmCurso.current = false;
      setPedindo(false);
    }
  }, []);

  const protegida =
    podeProteger &&
    aparelho !== null &&
    deveProtegerConta({ recursoLigado, binarioPermite, ...aparelho });

  const situacao: SituacaoDaConta = !podeProteger
    ? 'livre'
    : aparelho === null
      ? 'verificando'
      : protegida && trancada
        ? 'trancada'
        : 'livre';

  return { situacao, protegida, jaAbriu, pedindo, aviso, desbloquear };
}
