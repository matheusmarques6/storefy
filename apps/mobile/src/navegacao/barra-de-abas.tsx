/**
 * A barra de abas nativa (seções 5.3 e 5.7 do plano).
 *
 * É escrita à mão, e não com o `Tabs` do expo-router, porque as abas deste app
 * vêm da config remota: são de duas a cinco, com rótulo, ícone e ordem
 * decididos no painel e trocados sem build novo. O roteador de arquivos precisa
 * de uma rota por aba, escrita antes de existir a loja — o que obrigaria a
 * criar cinco rotas fantasma e esconder as que sobrassem.
 *
 * Em compensação, tudo que o `Tabs` daria de graça está aqui na mão: papel de
 * acessibilidade, estado selecionado, área segura embaixo e alvo de toque com
 * tamanho mínimo.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from '@storefy/config-schema';
import type { AbaResolvida } from '../config/abas';
import { descricaoDoBadge, rotuloDoBadge } from './badge';
import { iconeDaAba } from './icones';

interface Props {
  abas: readonly AbaResolvida[];
  /** `id` da aba visível. */
  ativa: string;
  /** Quantidade de itens no carrinho, para o badge. */
  itensNoCarrinho: number;
  tema: Theme;
  /** Tocar numa aba. Vem com `reabrir` quando já era a aba ativa. */
  aoTocar: (id: string, reabrir: boolean) => void;
}

export function BarraDeAbas({
  abas,
  ativa,
  itensNoCarrinho,
  tema,
  aoTocar,
}: Props): React.ReactNode {
  const margens = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        estilos.barra,
        {
          backgroundColor: tema.tabBarBg,
          // No iPhone sem botão de início, a faixa de gestos come a barra.
          paddingBottom: Math.max(margens.bottom, 8),
          borderTopColor: tema.tabBarInactive,
        },
      ]}
    >
      {abas.map((aba) => {
        const selecionada = aba.id === ativa;
        const cor = selecionada ? tema.tabBarActive : tema.tabBarInactive;
        const mostraBadge = aba.badge === 'cart_count';
        const rotulo = mostraBadge ? rotuloDoBadge(itensNoCarrinho) : null;
        const descricao = mostraBadge ? descricaoDoBadge(itensNoCarrinho) : null;

        return (
          <Pressable
            key={aba.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: selecionada }}
            accessibilityLabel={descricao === null ? aba.label : `${aba.label}, ${descricao}`}
            onPress={() => {
              aoTocar(aba.id, selecionada);
            }}
            style={estilos.aba}
          >
            <View style={estilos.caixaDoIcone}>
              <Ionicons name={glifo(aba.icone, selecionada)} size={24} color={cor} />
              {rotulo !== null ? (
                <View style={[estilos.badge, { backgroundColor: tema.primary }]}>
                  <Text
                    // O número já é anunciado no rótulo da aba; repetir aqui
                    // faria o leitor de tela falar duas vezes.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    numberOfLines={1}
                    style={[estilos.textoDoBadge, { color: tema.tabBarBg }]}
                  >
                    {rotulo}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={[estilos.rotulo, { color: cor }]}>
              {aba.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * O nome do ícone vem da config, então é texto livre.
 *
 * `iconeDaAba` garante um glifo que existe; o `as` aqui é a fronteira entre
 * esse texto e o tipo fechado do Ionicons, e é o único lugar que precisa dela.
 */
function glifo(nome: string, ativa: boolean): React.ComponentProps<typeof Ionicons>['name'] {
  return iconeDaAba(nome, ativa) as React.ComponentProps<typeof Ionicons>['name'];
}

const estilos = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  aba: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // 44pt é o alvo mínimo de toque que a Apple pede.
    minHeight: 44,
    gap: 2,
  },
  caixaDoIcone: { width: 32, height: 26, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textoDoBadge: { fontSize: 11, fontWeight: '700' },
  rotulo: { fontSize: 11, fontWeight: '500' },
});
