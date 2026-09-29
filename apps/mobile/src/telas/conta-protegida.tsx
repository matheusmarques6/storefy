/**
 * M06 — a aba Conta trancada, esperando o Face ID ou a digital.
 *
 * A tela pede o desbloqueio sozinha quando a aba aparece (é o que a pessoa
 * espera ao tocar em "Conta"), e mantém o botão para tentar de novo depois de
 * um cancelamento — sem ele, quem cancelou por engano ficaria preso aqui.
 */
import { useEffect, useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';

interface Props {
  /** A aba está na frente: é quando o pedido automático faz sentido. */
  visivel: boolean;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  pedindo: boolean;
  aviso: string | null;
  aoDesbloquear: () => Promise<void>;
}

export function ContaProtegida({
  visivel,
  tema,
  pedindo,
  aviso,
  aoDesbloquear,
}: Props): React.ReactNode {
  // Um pedido automático por vez que a aba aparece. Cancelou? O botão fica
  // ali; pedir de novo sozinho viraria um laço que não deixa sair da aba.
  const jaPediu = useRef(false);

  useEffect(() => {
    if (!visivel) {
      jaPediu.current = false;
      return;
    }
    if (jaPediu.current) return;
    jaPediu.current = true;
    void aoDesbloquear();
  }, [visivel, aoDesbloquear]);

  return (
    <View style={[estilos.tela, { backgroundColor: tema.background }]}>
      <View style={[estilos.circulo, { backgroundColor: `${tema.primary}1a` }]}>
        <Ionicons name="lock-closed-outline" size={30} color={tema.primary} />
      </View>
      <Text accessibilityRole="header" style={[estilos.titulo, { color: tema.text }]}>
        Sua conta está protegida
      </Text>
      <Text style={[estilos.texto, { color: tema.text }]}>
        Use o Face ID, a digital ou a senha do celular para ver os seus pedidos e os seus dados.
      </Text>
      {aviso === null ? null : (
        <Text accessibilityLiveRegion="polite" style={[estilos.aviso, { color: tema.text }]}>
          {aviso}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pedindo, busy: pedindo }}
        disabled={pedindo}
        onPress={() => {
          void aoDesbloquear();
        }}
        style={({ pressed }) => [
          estilos.botao,
          { backgroundColor: tema.primary, opacity: pressed || pedindo ? 0.8 : 1 },
        ]}
      >
        {pedindo ? (
          <ActivityIndicator color={tema.background} accessibilityLabel="Esperando o desbloqueio" />
        ) : (
          <Text style={[estilos.textoDoBotao, { color: tema.background }]}>Desbloquear</Text>
        )}
      </Pressable>
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  circulo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  titulo: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  texto: { fontSize: 15, lineHeight: 21, opacity: 0.75, textAlign: 'center' },
  aviso: { fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  botao: {
    marginTop: 12,
    minWidth: 200,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  textoDoBotao: { fontSize: 16, fontWeight: '600' },
});
