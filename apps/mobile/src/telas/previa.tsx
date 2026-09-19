/**
 * Tela do app Storefy Preview (fase 2 do plano).
 *
 * O lojista gera um código no editor e aponta a câmera. O app busca o RASCUNHO
 * daquela loja e passa a se comportar como o app dela — é a única forma de ver
 * o resultado num aparelho de verdade antes de publicar para os clientes.
 *
 * A câmera é o caminho principal, mas não o único: aparelho antigo lê QR mal,
 * e é comum a permissão estar negada de uma recusa antiga. Digitar os 32
 * caracteres é chato e funciona sempre, então o campo está sempre à mão.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { lerTokenDePrevia } from '@storefy/config-schema';
import { TEMA_NEUTRO } from './avisos';

interface Props {
  /** Por que a tela voltou a aparecer, quando houve um motivo. */
  motivo?: string;
  aoInformarCodigo: (entrada: string) => void;
}

export function TelaDePrevia({ motivo, aoInformarCodigo }: Props): React.ReactNode {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [digitado, setDigitado] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erroDoCampo, setErroDoCampo] = useState<string | null>(null);

  const podeUsarCamera = permissao?.granted === true;

  /*
   * O QR também pode ser lido pela câmera nativa do celular, que abre o app
   * pelo deep link `storefy-preview://p/<código>`. Sem tratar isso aqui, o
   * lojista escanearia pela câmera do sistema, o app abriria — e pararia nesta
   * mesma tela pedindo o código de novo.
   */
  const inicialLida = useRef(false);
  useEffect(() => {
    if (!inicialLida.current) {
      inicialLida.current = true;
      void Linking.getInitialURL().then((url) => {
        if (url !== null && lerTokenDePrevia(url) !== null) aoInformarCodigo(url);
      });
    }
    const inscricao = Linking.addEventListener('url', ({ url }) => {
      if (lerTokenDePrevia(url) !== null) aoInformarCodigo(url);
    });
    return () => {
      inscricao.remove();
    };
  }, [aoInformarCodigo]);

  function enviarDigitado(): void {
    if (lerTokenDePrevia(digitado) === null) {
      setErroDoCampo('Confira o código: são 32 letras e números.');
      return;
    }
    setErroDoCampo(null);
    aoInformarCodigo(digitado);
  }

  return (
    <SafeAreaView style={estilos.tela}>
      <ScrollView contentContainerStyle={estilos.conteudo} keyboardShouldPersistTaps="handled">
        <Ionicons name="qr-code-outline" size={40} color={TEMA_NEUTRO.text} />
        <Text style={estilos.titulo}>Storefy Preview</Text>
        <Text style={estilos.corpo}>
          No painel, abra o editor do app e toque em “Gerar código”. Depois aponte a câmera para o
          QR que aparecer.
        </Text>

        {motivo === undefined ? null : (
          <View style={estilos.aviso}>
            <Text style={estilos.textoDoAviso}>{motivo}</Text>
          </View>
        )}

        <View style={estilos.visor}>
          {podeUsarCamera ? (
            <CameraView
              style={estilos.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={
                lendo
                  ? undefined
                  : ({ data }) => {
                      // Uma leitura por vez: a câmera dispara muitas vezes por
                      // segundo, e sem a trava o app buscaria o mesmo código
                      // dezenas de vezes.
                      setLendo(true);
                      aoInformarCodigo(data);
                    }
              }
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              style={estilos.pedirCamera}
              onPress={() => {
                void pedirPermissao();
              }}
            >
              <Ionicons name="camera-outline" size={28} color={TEMA_NEUTRO.text} />
              <Text style={estilos.textoDoPedido}>
                {permissao === null
                  ? 'Preparando a câmera…'
                  : permissao.canAskAgain
                    ? 'Tocar para liberar a câmera'
                    : 'Libere a câmera nos ajustes do celular, ou digite o código abaixo'}
              </Text>
            </Pressable>
          )}
          {lendo ? (
            <View style={estilos.cobertura}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>

        <Text style={estilos.rotulo}>Ou digite o código</Text>
        <TextInput
          value={digitado}
          onChangeText={(texto) => {
            setDigitado(texto);
            setErroDoCampo(null);
          }}
          placeholder="Cole ou digite aqui"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[estilos.campo, erroDoCampo === null ? null : estilos.campoComErro]}
          onSubmitEditing={enviarDigitado}
          returnKeyType="go"
        />
        {erroDoCampo === null ? null : <Text style={estilos.erro}>{erroDoCampo}</Text>}

        <Pressable
          accessibilityRole="button"
          onPress={enviarDigitado}
          style={({ pressed }) => [estilos.botao, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={estilos.rotuloDoBotao}>Abrir prévia</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: TEMA_NEUTRO.background },
  conteudo: { alignItems: 'center', gap: 12, padding: 24 },
  titulo: { fontSize: 22, fontWeight: '700', color: TEMA_NEUTRO.text },
  corpo: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    color: TEMA_NEUTRO.text,
    opacity: 0.7,
  },
  aviso: {
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  textoDoAviso: { color: '#92400e', fontSize: 14, textAlign: 'center' },
  visor: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    marginTop: 8,
  },
  camera: { flex: 1 },
  pedirCamera: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  textoDoPedido: { textAlign: 'center', color: TEMA_NEUTRO.text, fontSize: 14 },
  cobertura: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00000066',
  },
  rotulo: { alignSelf: 'flex-start', marginTop: 12, fontSize: 14, color: TEMA_NEUTRO.text },
  campo: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: TEMA_NEUTRO.text,
  },
  campoComErro: { borderColor: '#dc2626' },
  erro: { alignSelf: 'flex-start', color: '#dc2626', fontSize: 13 },
  botao: {
    width: '100%',
    backgroundColor: TEMA_NEUTRO.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  rotuloDoBotao: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
