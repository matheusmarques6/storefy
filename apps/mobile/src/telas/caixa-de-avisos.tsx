/**
 * M07 — a caixa de avisos nativa.
 *
 * É uma das telas que a diretriz 4.2 da Apple espera ver num app que espelha
 * um site: conteúdo que o app tem e o site não. Aqui ela também é útil de
 * verdade — a notificação do sistema some quando o cliente desliza, e sem uma
 * caixa a promoção que ele quis ver depois desaparece para sempre.
 *
 * O que foi lido é LOCAL: fica no aparelho e não sobe para lugar nenhum.
 */
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '@storefy/config-schema';
import { quandoChegou, type AvisoNaTela } from '../push/caixa.ts';

interface Props {
  avisos: readonly AvisoNaTela[];
  carregando: boolean;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  aoRecarregar: () => void;
  /** Toque num aviso: marca como lido e, se houver link, navega. */
  aoTocar: (aviso: AvisoNaTela) => void;
  aoMarcarTudoLido: () => void;
}

export function CaixaDeAvisos({
  avisos,
  carregando,
  tema,
  aoRecarregar,
  aoTocar,
  aoMarcarTudoLido,
}: Props): React.ReactNode {
  const temNaoLido = avisos.some((aviso) => !aviso.lido);
  const agora = Date.now();

  return (
    <View style={[estilos.tela, { backgroundColor: tema.background }]}>
      <View style={estilos.cabecalho}>
        <Text style={[estilos.tituloDaTela, { color: tema.text }]}>Avisos</Text>
        {temNaoLido ? (
          <Pressable accessibilityRole="button" onPress={aoMarcarTudoLido} hitSlop={8}>
            <Text style={[estilos.acaoDoCabecalho, { color: tema.primary }]}>
              Marcar tudo como lido
            </Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={[...avisos]}
        keyExtractor={(aviso) => aviso.id}
        contentContainerStyle={avisos.length === 0 ? estilos.vazioContainer : estilos.lista}
        refreshControl={
          <RefreshControl
            refreshing={carregando}
            onRefresh={aoRecarregar}
            tintColor={tema.primary}
          />
        }
        /*
         * Estado vazio desenhado, e não uma lista em branco: a caixa vazia é o
         * estado NORMAL de quem acabou de instalar o app, e uma tela branca ali
         * parece defeito.
         */
        ListEmptyComponent={
          carregando ? null : (
            <View style={estilos.vazio}>
              <Ionicons name="notifications-off-outline" size={40} color={tema.text} />
              <Text style={[estilos.vazioTitulo, { color: tema.text }]}>Nenhum aviso ainda</Text>
              <Text style={[estilos.vazioCorpo, { color: tema.text }]}>
                Quando a loja enviar uma novidade, ela aparece aqui.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.lido ? 'Lido' : 'Não lido'}.`}
            onPress={() => {
              aoTocar(item);
            }}
            style={({ pressed }) => [estilos.item, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View
              style={[
                estilos.marcador,
                { backgroundColor: item.lido ? 'transparent' : tema.primary },
              ]}
            />
            <View style={estilos.conteudo}>
              <Text
                style={[
                  estilos.titulo,
                  { color: tema.text, fontWeight: item.lido ? '500' : '700' },
                ]}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              <Text style={[estilos.corpo, { color: tema.text }]} numberOfLines={3}>
                {item.body}
              </Text>
              <Text style={[estilos.quando, { color: tema.text }]}>
                {quandoChegou(item.sentAt, agora)}
              </Text>
            </View>
            {item.deepLink !== null ? (
              <Ionicons name="chevron-forward" size={18} color={tema.text} style={estilos.seta} />
            ) : null}
          </Pressable>
        )}
      />
    </View>
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
  acaoDoCabecalho: { fontSize: 14, fontWeight: '600' },
  lista: { paddingBottom: 24 },
  item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, paddingRight: 16 },
  marcador: { width: 7, height: 7, borderRadius: 4, marginTop: 8, marginHorizontal: 8 },
  conteudo: { flex: 1, gap: 3 },
  titulo: { fontSize: 15, lineHeight: 20 },
  corpo: { fontSize: 14, lineHeight: 19, opacity: 0.75 },
  quando: { fontSize: 12, opacity: 0.5, marginTop: 2 },
  seta: { marginTop: 10, opacity: 0.4 },
  vazioContainer: { flexGrow: 1, justifyContent: 'center' },
  vazio: { alignItems: 'center', paddingHorizontal: 40, gap: 8 },
  vazioTitulo: { fontSize: 17, fontWeight: '600', marginTop: 8 },
  vazioCorpo: { fontSize: 14, textAlign: 'center', opacity: 0.7, lineHeight: 20 },
});
