/**
 * Telas de aviso do app: carregando, sem conexão, erro e atualização
 * obrigatória (seções 5.3 e 5.4 do plano).
 *
 * Todas são NATIVAS, e não uma página da loja: quando a rede cai, carregar
 * qualquer coisa da web é justamente o que não funciona. Ter essas telas
 * também é o que a diretriz 4.2 da Apple espera de um app que espelha um site.
 *
 * O texto é para o cliente da loja, não para quem programa: nada de "erro 500"
 * nem de "falha na requisição".
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';

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
  acao?: { rotulo: string; aoTocar: () => void };
}

/** Moldura comum: ícone, título, explicação e, quando faz sentido, um botão. */
export function Aviso({ icone, titulo, corpo, cores, acao }: AvisoProps): React.ReactNode {
  const tema = cores ?? TEMA_NEUTRO;

  return (
    <View style={[estilos.centro, { backgroundColor: tema.background }]}>
      <Ionicons name={icone} size={44} color={tema.text} style={estilos.icone} />
      <Text style={[estilos.titulo, { color: tema.text }]}>{titulo}</Text>
      <Text style={[estilos.corpo, { color: tema.text }]}>{corpo}</Text>
      {acao !== undefined ? (
        <Pressable
          accessibilityRole="button"
          onPress={acao.aoTocar}
          style={({ pressed }) => [
            estilos.botao,
            { backgroundColor: tema.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[estilos.rotuloDoBotao, { color: tema.background }]}>{acao.rotulo}</Text>
        </Pressable>
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
 * Atualização obrigatória.
 *
 * Sem botão de fechar de propósito: a config diz que esta versão não funciona
 * mais, e deixar entrar assim mesmo daria uma tela quebrada em vez de um aviso.
 */
export function TelaDeAtualizacao({ cores }: { cores?: Cores }): React.ReactNode {
  return (
    <Aviso
      icone="arrow-up-circle-outline"
      titulo="Atualize o app"
      corpo="Esta versão ficou para trás. Atualize pela loja de aplicativos para continuar comprando."
      cores={cores}
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
});
