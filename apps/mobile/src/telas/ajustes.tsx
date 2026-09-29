/**
 * M12 — Ajustes do app.
 *
 * Três coisas, e todas são exigência de loja de aplicativos antes de serem
 * conveniência:
 *
 *   - DESLIGAR AS NOTIFICAÇÕES AQUI DENTRO. A Apple exige, para push de
 *     promoção, um caminho no próprio app para parar de receber (diretriz
 *     4.5.4) — e campanha de promoção é o que a loja manda. Os ajustes do
 *     celular só aparecem quando o sistema bloqueou: aí é o único caminho, e
 *     a tela diz isso em vez de mostrar uma chave que não faz nada;
 *   - a POLÍTICA DE PRIVACIDADE ao alcance de um toque (diretriz 5.1.1);
 *   - a versão, que é a primeira pergunta do suporte da loja.
 *
 * Abre pela engrenagem da caixa de avisos (M07), pela linha no topo da aba
 * Conta quando o app não tem caixa de avisos, e por `Storefy.openAppSettings()`
 * na página da loja.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Theme } from '@storefy/config-schema';
import type { EstadoDasNotificacoes } from '../push/ajustes.ts';

interface Props {
  visivel: boolean;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  nomeDaLoja: string;
  notificacoes: EstadoDasNotificacoes;
  mudando: boolean;
  erro: string | null;
  aoLigar: () => void;
  aoDesligar: () => void;
  aoTentarDeNovo: () => void;
  /** "Versão 1.2.0 (12)". */
  versao: string;
  /** `null` quando o build não sabe de qual loja é (app de prévia). */
  urlDaPolitica: string | null;
  aoFechar: () => void;
}

export function AjustesDoApp({
  visivel,
  tema,
  nomeDaLoja,
  notificacoes,
  mudando,
  erro,
  aoLigar,
  aoDesligar,
  aoTentarDeNovo,
  versao,
  urlDaPolitica,
  aoFechar,
}: Props): React.ReactNode {
  return (
    <Modal
      visible={visivel}
      animationType="slide"
      // No iPhone, a folha que desce com o dedo; no Android, a tela cheia.
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={aoFechar}
    >
      <SafeAreaView style={[estilos.tela, { backgroundColor: tema.background }]}>
        <View style={estilos.cabecalho}>
          <Text accessibilityRole="header" style={[estilos.tituloDaTela, { color: tema.text }]}>
            Ajustes
          </Text>
          <Pressable accessibilityRole="button" onPress={aoFechar} hitSlop={12}>
            <Text style={[estilos.acaoDoCabecalho, { color: tema.primary }]}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={estilos.conteudo}>
          {notificacoes === 'indisponivel' ? null : (
            <Secao titulo="Notificações" tema={tema}>
              <Notificacoes
                tema={tema}
                nomeDaLoja={nomeDaLoja}
                estado={notificacoes}
                mudando={mudando}
                aoLigar={aoLigar}
                aoDesligar={aoDesligar}
              />
              {erro === null ? null : (
                <View style={estilos.erro} accessibilityLiveRegion="polite">
                  <Text style={[estilos.textoDoErro, { color: tema.text }]}>{erro}</Text>
                  <Pressable accessibilityRole="button" onPress={aoTentarDeNovo} hitSlop={8}>
                    <Text style={[estilos.link, { color: tema.primary }]}>Tentar de novo</Text>
                  </Pressable>
                </View>
              )}
            </Secao>
          )}

          {urlDaPolitica === null ? null : (
            <Secao titulo="Privacidade" tema={tema}>
              <Pressable
                accessibilityRole="link"
                accessibilityHint="Abre no navegador"
                onPress={() => {
                  void Linking.openURL(urlDaPolitica);
                }}
                style={({ pressed }) => [estilos.linha, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[estilos.rotulo, { color: tema.text }]}>Política de privacidade</Text>
                <Ionicons name="open-outline" size={18} color={tema.text} style={estilos.seta} />
              </Pressable>
            </Secao>
          )}

          <Secao titulo="Sobre" tema={tema}>
            <View style={estilos.linha}>
              <Text style={[estilos.rotulo, { color: tema.text }]}>App da {nomeDaLoja}</Text>
            </View>
            <Text style={[estilos.detalhe, { color: tema.text }]}>{versao}</Text>
          </Secao>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Secao({
  titulo,
  tema,
  children,
}: {
  titulo: string;
  tema: Pick<Theme, 'text'>;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <View style={estilos.secao}>
      <Text accessibilityRole="header" style={[estilos.tituloDaSecao, { color: tema.text }]}>
        {titulo.toUpperCase()}
      </Text>
      <View style={[estilos.cartao, { borderColor: `${tema.text}1f` }]}>{children}</View>
    </View>
  );
}

function Notificacoes({
  tema,
  nomeDaLoja,
  estado,
  mudando,
  aoLigar,
  aoDesligar,
}: {
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  nomeDaLoja: string;
  estado: Exclude<EstadoDasNotificacoes, 'indisponivel'>;
  mudando: boolean;
  aoLigar: () => void;
  aoDesligar: () => void;
}): React.ReactNode {
  if (estado === 'carregando') {
    return (
      <View style={estilos.linha} accessibilityRole="progressbar">
        <ActivityIndicator color={tema.primary} />
        <Text style={[estilos.detalhe, estilos.carregando, { color: tema.text }]}>
          Conferindo as notificações…
        </Text>
      </View>
    );
  }

  const ligadas = estado === 'ligadas';
  const bloqueadas = estado === 'bloqueadas';

  return (
    <View>
      <View style={estilos.linha}>
        <Text style={[estilos.rotulo, { color: tema.text }]}>Receber notificações</Text>
        {mudando ? (
          <ActivityIndicator color={tema.primary} />
        ) : (
          <Switch
            accessibilityLabel="Receber notificações"
            value={ligadas}
            disabled={bloqueadas}
            onValueChange={(ligar) => {
              if (ligar) aoLigar();
              else aoDesligar();
            }}
            trackColor={{ true: tema.primary }}
          />
        )}
      </View>
      <Text style={[estilos.detalhe, { color: tema.text }]}>
        {bloqueadas
          ? 'As notificações deste app estão bloqueadas nos ajustes do celular. Para receber, ligue por lá.'
          : ligadas
            ? `Promoções, novidades e avisos dos seus pedidos da ${nomeDaLoja}.`
            : `Você não recebe as promoções nem os avisos dos seus pedidos da ${nomeDaLoja}.`}
      </Text>
      {bloqueadas ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void Linking.openSettings();
          }}
          style={({ pressed }) => [
            estilos.botao,
            { backgroundColor: tema.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[estilos.rotuloDoBotao, { color: tema.background }]}>
            Abrir ajustes do celular
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A entrada dos ajustes no topo da aba Conta, para o app sem caixa de avisos
 * (onde a engrenagem mora). Discreta: é a página da loja que manda na aba.
 */
export function EntradaDosAjustes({
  tema,
  aoAbrir,
}: {
  tema: Pick<Theme, 'text'>;
  aoAbrir: () => void;
}): React.ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ajustes do app"
      onPress={aoAbrir}
      style={({ pressed }) => [
        estilos.entrada,
        { borderBottomColor: `${tema.text}1f`, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name="settings-outline" size={16} color={tema.text} />
      <Text style={[estilos.textoDaEntrada, { color: tema.text }]}>Ajustes do app</Text>
      <Ionicons name="chevron-forward" size={16} color={tema.text} style={estilos.seta} />
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1 },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  tituloDaTela: { fontSize: 24, fontWeight: '700' },
  acaoDoCabecalho: { fontSize: 16, fontWeight: '600' },
  conteudo: { paddingHorizontal: 20, paddingBottom: 32 },
  secao: { marginTop: 20 },
  tituloDaSecao: { fontSize: 12, fontWeight: '600', opacity: 0.55, marginBottom: 8 },
  cartao: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 16, gap: 8 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  rotulo: { flex: 1, fontSize: 16 },
  detalhe: { fontSize: 14, lineHeight: 19, opacity: 0.7 },
  carregando: { flex: 1, marginLeft: 12 },
  seta: { opacity: 0.5 },
  erro: { gap: 4, marginTop: 4 },
  textoDoErro: { fontSize: 14, lineHeight: 19 },
  link: { fontSize: 14, fontWeight: '600' },
  botao: { marginTop: 12, paddingVertical: 13, borderRadius: 10, alignItems: 'center' },
  rotuloDoBotao: { fontSize: 15, fontWeight: '600' },
  entrada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  textoDaEntrada: { flex: 1, fontSize: 14 },
});
