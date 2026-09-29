/**
 * M08 — o campo de busca nativo, no topo da aba Busca.
 *
 * O resultado é a página de busca da própria loja (a WebView abaixo); o campo
 * é do app. É ele que abre o teclado certo — com a tecla "Buscar" —, lembra o
 * que foi digitado ao trocar de aba e não some quando a página rola, coisas
 * que o campo do tema, dentro da página, não faz.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';
import { MAXIMO_DA_BUSCA } from '../config/abas';

interface Props {
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  nomeDaLoja: string;
  /** Recebe o termo já sem espaços nas pontas; vazio não chega aqui. */
  aoBuscar: (termo: string) => void;
}

export function CampoDeBusca({ tema, nomeDaLoja, aoBuscar }: Props): React.ReactNode {
  const [termo, setTermo] = useState('');

  const buscar = (): void => {
    const limpo = termo.trim();
    if (limpo === '') return;
    Keyboard.dismiss();
    aoBuscar(limpo);
  };

  return (
    <View style={[estilos.faixa, { borderBottomColor: `${tema.text}1f` }]}>
      <View style={[estilos.campo, { backgroundColor: `${tema.text}0f` }]}>
        <Ionicons name="search" size={18} color={tema.text} style={estilos.icone} />
        <TextInput
          value={termo}
          onChangeText={setTermo}
          onSubmitEditing={buscar}
          placeholder={`Buscar na ${nomeDaLoja}`}
          placeholderTextColor={`${tema.text}80`}
          accessibilityLabel="Buscar produtos"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={MAXIMO_DA_BUSCA}
          selectionColor={tema.primary}
          style={[estilos.entrada, { color: tema.text }]}
        />
        {termo === '' ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Limpar a busca"
            hitSlop={10}
            onPress={() => {
              setTermo('');
            }}
          >
            <Ionicons name="close-circle" size={18} color={tema.text} style={estilos.icone} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  faixa: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
  },
  icone: { opacity: 0.6 },
  entrada: { flex: 1, fontSize: 16, paddingVertical: 9 },
});
