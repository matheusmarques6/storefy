/**
 * A faixa do aviso no topo (C06e, desenhada na casca da loja — M04).
 *
 * Nas cores da marca, logo abaixo da barra de status e em cima de todas as
 * abas. Com link, o texto inteiro é o alvo do toque; o "fechar" fica à parte,
 * com área de toque própria, para ninguém abrir a promoção ao tentar fechar.
 * O texto vai na cor de fundo do app sobre a cor principal — o mesmo par do
 * botão do convite das notificações, que o lojista já conferiu na prévia.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';
import type { AvisoDoTopo } from '../config/aviso';

interface Props {
  aviso: AvisoDoTopo;
  tema: Pick<Theme, 'primary' | 'background'>;
  aoAbrir: (caminho: string) => void;
  aoFechar: () => void;
}

export function FaixaDeAviso({ aviso, tema, aoAbrir, aoFechar }: Props): React.ReactNode {
  const { caminho } = aviso;
  const conteudo = (
    <>
      <Text numberOfLines={2} style={[estilos.texto, { color: tema.background }]}>
        {aviso.texto}
      </Text>
      {caminho === null ? null : (
        <Ionicons name="chevron-forward" size={14} color={tema.background} />
      )}
    </>
  );

  return (
    <View testID="aviso-do-topo" style={[estilos.faixa, { backgroundColor: tema.primary }]}>
      {caminho === null ? (
        <View style={estilos.miolo} accessible accessibilityRole="text">
          {conteudo}
        </View>
      ) : (
        <Pressable
          testID="aviso-do-topo-abrir"
          accessibilityRole="link"
          accessibilityHint="Abre a página do aviso na loja"
          onPress={() => {
            aoAbrir(caminho);
          }}
          style={({ pressed }) => [estilos.miolo, { opacity: pressed ? 0.8 : 1 }]}
        >
          {conteudo}
        </Pressable>
      )}
      <Pressable
        testID="aviso-do-topo-fechar"
        accessibilityRole="button"
        accessibilityLabel="Fechar aviso"
        hitSlop={10}
        onPress={aoFechar}
        style={({ pressed }) => [estilos.fechar, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="close" size={16} color={tema.background} />
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  faixa: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6 },
  miolo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  texto: { flexShrink: 1, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  fechar: { padding: 8 },
});
