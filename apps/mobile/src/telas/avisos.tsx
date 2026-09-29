/**
 * Telas de aviso do app: carregando, sem conexão (M09), erro com recarregar
 * (M10) e atualização obrigatória (M11) — seções 5.3 e 5.4 do plano.
 *
 * Todas são NATIVAS, e não uma página da loja: quando a rede cai, carregar
 * qualquer coisa da web é justamente o que não funciona. Ter essas telas
 * também é o que a diretriz 4.2 da Apple espera de um app que espelha um site.
 *
 * O texto é para o cliente da loja, não para quem programa: nada de "erro 500"
 * nem de "falha na requisição".
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';
import { abrirFicha, textosDaAtualizacao, type FichaNaLoja } from '../nucleo/loja-de-apps';

/** Cores usadas antes de haver config, para as telas que aparecem sem ela. */
export const TEMA_NEUTRO = {
  background: '#ffffff',
  text: '#111827',
  primary: '#111827',
} as const;

type Cores = Pick<Theme, 'background' | 'text' | 'primary'>;

interface AvisoProps {
  icone: React.ComponentProps<typeof Ionicons>['name'];
  titulo: string;
  corpo: string;
  cores?: Cores;
  acao?: {
    rotulo: string;
    aoTocar: () => void;
    /** Enquanto a ação anda: o botão fica ocupado, e um segundo toque não repete. */
    ocupado?: boolean;
  };
  /** Uma frase depois do botão — o que deu errado e o que fazer. */
  observacao?: string;
}

/** Moldura comum: ícone, título, explicação e, quando faz sentido, um botão. */
export function Aviso({
  icone,
  titulo,
  corpo,
  cores,
  acao,
  observacao,
}: AvisoProps): React.ReactNode {
  const tema = cores ?? TEMA_NEUTRO;
  const ocupado = acao?.ocupado === true;

  return (
    <View style={[estilos.centro, { backgroundColor: tema.background }]}>
      <Ionicons name={icone} size={44} color={tema.text} style={estilos.icone} />
      <Text style={[estilos.titulo, { color: tema.text }]}>{titulo}</Text>
      <Text style={[estilos.corpo, { color: tema.text }]}>{corpo}</Text>
      {acao !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: ocupado, disabled: ocupado }}
          disabled={ocupado}
          onPress={acao.aoTocar}
          style={({ pressed }) => [
            estilos.botao,
            { backgroundColor: tema.primary, opacity: pressed || ocupado ? 0.8 : 1 },
          ]}
        >
          {ocupado ? (
            <ActivityIndicator color={tema.background} />
          ) : (
            <Text style={[estilos.rotuloDoBotao, { color: tema.background }]}>{acao.rotulo}</Text>
          )}
        </Pressable>
      ) : null}
      {observacao !== undefined ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[estilos.observacao, { color: tema.text }]}
        >
          {observacao}
        </Text>
      ) : null}
    </View>
  );
}

/** Enquanto a config é lida do aparelho. Dura milissegundos no caso normal. */
export function TelaDeCarregamento({ cores }: { cores?: Cores }): React.ReactNode {
  const tema = cores ?? TEMA_NEUTRO;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando"
      style={[estilos.centro, { backgroundColor: tema.background }]}
    >
      <ActivityIndicator size="large" color={tema.primary} />
    </View>
  );
}

/** M09 — sem conexão. */
export function TelaSemConexao({
  cores,
  aoTentarDeNovo,
}: {
  cores?: Cores;
  aoTentarDeNovo: () => void;
}): React.ReactNode {
  return (
    <Aviso
      icone="cloud-offline-outline"
      titulo="Sem conexão"
      corpo="Não conseguimos acessar a internet agora. Verifique o Wi-Fi ou os dados móveis e tente de novo."
      cores={cores}
      acao={{ rotulo: 'Tentar de novo', aoTocar: aoTentarDeNovo }}
    />
  );
}

/** M10 — erro, com recarregar. */
export function TelaDeErro({
  cores,
  aoTentarDeNovo,
}: {
  cores?: Cores;
  aoTentarDeNovo: () => void;
}): React.ReactNode {
  return (
    <Aviso
      icone="alert-circle-outline"
      titulo="A loja não abriu"
      corpo="Algo deu errado ao carregar esta página. Tente de novo em instantes."
      cores={cores}
      acao={{ rotulo: 'Tentar de novo', aoTocar: aoTentarDeNovo }}
    />
  );
}

/**
 * M11 — atualização obrigatória.
 *
 * Sem botão de fechar de propósito: a config diz que esta versão não funciona
 * mais, e deixar entrar assim mesmo daria uma tela quebrada em vez de um aviso.
 *
 * O botão abre a ficha do app na loja de aplicativos (`loja-de-apps.ts`). Sem
 * a ficha — um build que não sabe o próprio número na App Store — ou se nada
 * abrir, a tela diz onde procurar, com o nome do app: nunca um botão que não
 * leva a lugar nenhum.
 */
export function TelaDeAtualizacao({
  cores,
  ficha,
  nomeDoApp,
  plataforma,
}: {
  cores?: Cores;
  ficha: FichaNaLoja | null;
  nomeDoApp: string;
  plataforma: 'ios' | 'android';
}): React.ReactNode {
  const [abrindo, setAbrindo] = useState(false);
  const [naoAbriu, setNaoAbriu] = useState(false);
  const emCurso = useRef(false);

  const textos = textosDaAtualizacao({ plataforma, temFicha: ficha !== null, nomeDoApp });

  const atualizar = useCallback((): void => {
    if (ficha === null || emCurso.current) return;
    emCurso.current = true;
    setAbrindo(true);
    setNaoAbriu(false);
    void abrirFicha(ficha, (url) => Linking.openURL(url)).then((abriu) => {
      emCurso.current = false;
      setAbrindo(false);
      setNaoAbriu(!abriu);
    });
  }, [ficha]);

  return (
    <Aviso
      icone="arrow-up-circle-outline"
      titulo="Atualize o app"
      corpo={textos.corpo}
      cores={cores}
      acao={
        ficha === null
          ? undefined
          : {
              rotulo: 'Atualizar agora',
              aoTocar: atualizar,
              ocupado: abrindo,
            }
      }
      observacao={naoAbriu ? textos.naoAbriu : undefined}
    />
  );
}

/**
 * Nem cache, nem rede, nem config embutida.
 *
 * Só acontece com build mal configurado — `storeId` errado ou `brands/` sem a
 * pasta da loja. O texto diz o que dá para fazer sem culpar o cliente.
 */
export function TelaSemConfig({
  motivo,
  aoTentarDeNovo,
}: {
  motivo: string;
  aoTentarDeNovo: () => void;
}): React.ReactNode {
  return (
    <Aviso
      icone="construct-outline"
      titulo="App em configuração"
      corpo={`Este app ainda não recebeu as configurações da loja. ${motivo}`}
      acao={{ rotulo: 'Tentar de novo', aoTocar: aoTentarDeNovo }}
    />
  );
}

const estilos = StyleSheet.create({
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  icone: { marginBottom: 16, opacity: 0.8 },
  titulo: { fontSize: 20, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  corpo: { fontSize: 15, lineHeight: 22, opacity: 0.7, textAlign: 'center' },
  botao: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  rotuloDoBotao: { fontSize: 16, fontWeight: '600' },
  observacao: { fontSize: 14, lineHeight: 20, marginTop: 16, opacity: 0.8, textAlign: 'center' },
});
