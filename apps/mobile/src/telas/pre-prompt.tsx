/**
 * M03 — o pedido de permissão de notificação, antes do pedido do sistema.
 *
 * O iOS mostra o alerta dele UMA VEZ. Quem toca em "não permitir" ali só volta
 * atrás indo nos Ajustes do aparelho, o que praticamente ninguém faz. Então
 * esta tela não é enfeite: é a chance de explicar o que a loja vai mandar
 * ANTES de gastar aquela única vez. Quem diz "agora não" aqui pode ser
 * perguntado de novo daqui a uma semana; quem diz "não permitir" lá, não.
 *
 * O texto fala do que o cliente ganha, e não do que nós queremos. "Avisamos
 * quando o que você quer voltar ao estoque" é uma promessa; "ative as
 * notificações" é um pedido.
 */
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';

interface Props {
  visivel: boolean;
  /** Nome da loja, para a promessa ser dela e não nossa. */
  nomeDaLoja: string;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  aoAceitar: () => void;
  aoRecusar: () => void;
}

const VANTAGENS: { icone: React.ComponentProps<typeof Ionicons>['name']; texto: string }[] = [
  { icone: 'pricetag-outline', texto: 'Promoções e cupons antes de acabarem' },
  { icone: 'cube-outline', texto: 'Aviso quando o seu pedido sair para entrega' },
  { icone: 'refresh-outline', texto: 'O produto que você queria de volta ao estoque' },
];

export function PrePromptDePush({
  visivel,
  nomeDaLoja,
  tema,
  aoAceitar,
  aoRecusar,
}: Props): React.ReactNode {
  return (
    <Modal
      visible={visivel}
      transparent
      animationType="fade"
      /*
       * O botão voltar do Android e o gesto de fechar contam como "agora não",
       * e não como nada: sem isto, o cliente que fecha a tela seria perguntado
       * de novo na abertura seguinte, e na outra, e na outra.
       */
      onRequestClose={aoRecusar}
    >
      <View style={estilos.fundo}>
        <View style={[estilos.cartao, { backgroundColor: tema.background }]}>
          <View style={[estilos.circulo, { backgroundColor: `${tema.primary}1a` }]}>
            <Ionicons name="notifications-outline" size={30} color={tema.primary} />
          </View>

          <Text style={[estilos.titulo, { color: tema.text }]}>
            Quer saber das novidades da {nomeDaLoja}?
          </Text>
          <Text style={[estilos.subtitulo, { color: tema.text }]}>
            A gente avisa só do que importa. Nada de mensagem toda hora.
          </Text>

          <View style={estilos.lista}>
            {VANTAGENS.map((vantagem) => (
              <View key={vantagem.texto} style={estilos.linha}>
                <Ionicons name={vantagem.icone} size={18} color={tema.primary} />
                <Text style={[estilos.itemDaLista, { color: tema.text }]}>{vantagem.texto}</Text>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={aoAceitar}
            style={({ pressed }) => [
              estilos.botao,
              { backgroundColor: tema.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[estilos.rotuloPrincipal, { color: tema.background }]}>
              Quero ser avisado
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={aoRecusar} style={estilos.botaoSecundario}>
            <Text style={[estilos.rotuloSecundario, { color: tema.text }]}>Agora não</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  cartao: { borderRadius: 20, padding: 24, alignItems: 'center' },
  circulo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  titulo: { fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 27 },
  subtitulo: { fontSize: 15, textAlign: 'center', marginTop: 8, opacity: 0.75, lineHeight: 21 },
  lista: { alignSelf: 'stretch', marginTop: 20, gap: 12 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemDaLista: { flex: 1, fontSize: 14, lineHeight: 19 },
  botao: {
    alignSelf: 'stretch',
    marginTop: 24,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  rotuloPrincipal: { fontSize: 16, fontWeight: '600' },
  botaoSecundario: { marginTop: 4, paddingVertical: 12, paddingHorizontal: 16 },
  rotuloSecundario: { fontSize: 15, opacity: 0.6 },
});
