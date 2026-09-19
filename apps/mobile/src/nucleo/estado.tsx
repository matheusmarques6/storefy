/**
 * Estado global do app: qual config está valendo (seção 5.3 do plano).
 *
 * A ordem importa. O app abre com o que já tem no aparelho — cache ou config
 * embutida — e SÓ DEPOIS busca a versão nova em segundo plano. Esperar a rede
 * para desenhar a primeira tela transformaria toda abertura em tela branca no
 * tempo do 3G do cliente.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  decidirConfig,
  deveGravarNoCache,
  urlDaConfig,
  type DecisaoDaConfig,
} from '../config/decisao';
import { configEmbutida } from '../config/embutida';
import { buscarNaRede, gravarCache, lerCache } from '../config/fontes';
import { lerAmbiente, recursosDoBuild, type Ambiente } from './ambiente';

export type EstadoDaConfig = DecisaoDaConfig | { estado: 'carregando' };

interface ValorDoContexto {
  estado: EstadoDaConfig;
  ambiente: Ambiente;
  recursos: { push: boolean; eventos: boolean };
  /** Recarrega tudo, inclusive a busca na rede. Usado no "Tentar de novo". */
  recarregar: () => void;
}

const Contexto = createContext<ValorDoContexto | null>(null);

/** Lê o `extra` deste build a partir do `expo-constants`. */
export function ambienteDoApp(): Ambiente {
  const config = Constants.expoConfig;
  return lerAmbiente({
    extra: config?.extra ?? null,
    plataforma: Platform.OS === 'ios' ? 'ios' : 'android',
    versao: config?.version ?? null,
    buildIos: config?.ios?.buildNumber ?? null,
    buildAndroid: config?.android?.versionCode ?? null,
  });
}

export function ProvedorDaConfig({ children }: { children: ReactNode }): ReactNode {
  const ambiente = useMemo(() => ambienteDoApp(), []);
  const recursos = useMemo(() => recursosDoBuild(ambiente), [ambiente]);
  const [estado, setEstado] = useState<EstadoDaConfig>({ estado: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    /*
     * A busca pode estar no ar quando o componente sai da árvore, ou quando o
     * "Tentar de novo" dispara uma execução nova. Escrever estado depois disso
     * é aviso no console e, pior, sobrescreve o que a execução seguinte já
     * decidiu. O sinal é local a cada execução do efeito de propósito.
     */
    let cancelado = false;
    /*
     * Lido por função, e não direto: o TypeScript estreita `cancelado` para
     * `false` depois do primeiro `if` e considera as checagens seguintes
     * inúteis — mas elas acontecem depois de um `await`, quando a limpeza já
     * pode ter rodado. A chamada tira o estreitamento sem tirar a checagem.
     */
    const foiCancelado = (): boolean => cancelado;

    async function carregar(): Promise<void> {
      const embutida = configEmbutida(ambiente.storeId);
      const cache = await lerCache();
      if (foiCancelado()) return;

      const local = decidirConfig({ cache, embutida, buildAtual: ambiente.buildAtual });
      setEstado(local);

      const url = urlDaConfig(ambiente.apiBase, ambiente.appId);
      // Sem `appId` não existe config remota: este build roda com a embutida,
      // e isso é um estado normal, não uma falha.
      if (url === null) return;

      const rede = await buscarNaRede(url);
      if (foiCancelado() || rede === null) return;

      if (deveGravarNoCache(rede, cache)) await gravarCache(rede);
      if (foiCancelado()) return;

      const comRede = decidirConfig({ rede, cache, embutida, buildAtual: ambiente.buildAtual });

      /*
       * Só troca o estado quando a config realmente mudou. Um `setEstado` com
       * config equivalente remontaria toda WebView e o cliente perderia a
       * rolagem no meio da navegação, por nada.
       */
      if (
        comRede.estado === 'pronta' &&
        local.estado === 'pronta' &&
        comRede.config.version === local.config.version
      ) {
        return;
      }
      setEstado(comRede);
    }

    void carregar();
    return () => {
      cancelado = true;
    };
  }, [ambiente, tentativa]);

  const recarregar = useCallback(() => {
    setEstado({ estado: 'carregando' });
    setTentativa((anterior) => anterior + 1);
  }, []);

  const valor = useMemo<ValorDoContexto>(
    () => ({ estado, ambiente, recursos, recarregar }),
    [estado, ambiente, recursos, recarregar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useConfig(): ValorDoContexto {
  const valor = useContext(Contexto);
  if (valor === null) {
    throw new Error('useConfig precisa estar dentro de <ProvedorDaConfig>.');
  }
  return valor;
}
