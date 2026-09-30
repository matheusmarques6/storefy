/**
 * M07 — a caixa de avisos nativa.
 *
 * É uma das telas que a diretriz 4.2 da Apple espera ver num app que espelha
 * um site: conteúdo que o app tem e o site não. Aqui ela também é útil de
 * verdade — a notificação do sistema some quando o cliente desliza, e sem uma
 * caixa a promoção que ele quis ver depois desaparece para sempre.
 *
 * O que foi lido é LOCAL: fica no aparelho e não sobe para lugar nenhum. A
 * última lista também fica, para a caixa abrir sem internet — com um aviso de
 * que é a da última vez.
 *
 * Cada situação tem a sua tela (`situacaoDaCaixa`): "nenhum aviso" só aparece
 * quando o servidor disse isso. Sem internet e sem nada guardado, é erro com
 * "Tentar de novo"; sem notificações ligadas, é o caminho para ligá-las.
 */
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Theme } from '@storefy/config-schema';
import { quandoChegou, type AvisoNaTela, type SituacaoDaCaixa } from '../push/caixa.ts';

interface Props {
  avisos: readonly AvisoNaTela[];
  carregando: boolean;
  situacao: SituacaoDaCaixa;
  /** A lista é a guardada no aparelho, e o servidor não respondeu. */
  desatualizada: boolean;
  nomeDaLoja: string;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  aoRecarregar: () => void;
  /** Toque num aviso: marca como lido e, se houver link, navega. */
  aoTocar: (aviso: AvisoNaTela) => void;
  aoMarcarTudoLido: () => void;
  /** A engrenagem: abre os ajustes do app (M12), onde se desligam as notificações. */
  aoAbrirAjustes: () => void;
  /** "Ativar notificações", na caixa de quem nunca ligou. */
  aoAtivarNotificacoes: () => void;
  ativando: boolean;
}

export function CaixaDeAvisos({
  avisos,
  carregando,
  situacao,
  desatualizada,
  nomeDaLoja,
  tema,
  aoRecarregar,
  aoTocar,
  aoMarcarTudoLido,
  aoAbrirAjustes,
  aoAtivarNotificacoes,
  ativando,
}: Props): React.ReactNode {
  const temNaoLido = avisos.some((aviso) => !aviso.lido);
  const agora = Date.now();

  return (
    <View style={[estilos.tela, { backgroundColor: tema.background }]}>
      <View style={estilos.cabecalho}>
        <Text style={[estilos.tituloDaTela, { color: tema.text }]}>Avisos</Text>
        <View style={estilos.acoesDoCabecalho}>
          {temNaoLido ? (
            <Pressable accessibilityRole="button" onPress={aoMarcarTudoLido} hitSlop={8}>
              <Text style={[estilos.acaoDoCabecalho, { color: tema.primary }]}>
                Marcar tudo como lido
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes do app"
            onPress={aoAbrirAjustes}
            hitSlop={10}
          >
            <Ionicons name="settings-outline" size={22} color={tema.text} />
          </Pressable>
        </View>
      </View>

      {situacao === 'pronta' ? null : (
        <SemLista
          situacao={situacao}
          carregando={carregando}
          nomeDaLoja={nomeDaLoja}
          tema={tema}
          aoRecarregar={aoRecarregar}
          aoAtivarNotificacoes={aoAtivarNotificacoes}
          ativando={ativando}
        />
      )}

      {situacao === 'pronta' && desatualizada ? (
        <View
          accessibilityRole="alert"
          style={[estilos.faixa, { backgroundColor: `${tema.text}0f` }]}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={tema.text} />
          <Text style={[estilos.textoDaFaixa, { color: tema.text }]}>
            Sem conexão. Estes são os avisos da última vez.
          </Text>
          <Pressable accessibilityRole="button" onPress={aoRecarregar} hitSlop={8}>
            <Text style={[estilos.acaoDaFaixa, { color: tema.primary }]}>
              {carregando ? 'Buscando…' : 'Tentar de novo'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {situacao !== 'pronta' ? null : (
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
      )}
    </View>
  );
}

/** A caixa sem lista: carregando, erro, notificações desligadas ou bloqueadas. */
function SemLista({
  situacao,
  carregando,
  nomeDaLoja,
  tema,
  aoRecarregar,
  aoAtivarNotificacoes,
  ativando,
}: {
  situacao: Exclude<SituacaoDaCaixa, 'pronta'>;
  carregando: boolean;
  nomeDaLoja: string;
  tema: Pick<Theme, 'primary' | 'background' | 'text'>;
  aoRecarregar: () => void;
  aoAtivarNotificacoes: () => void;
  ativando: boolean;
}): React.ReactNode {
  if (situacao === 'carregando') {
    // O esqueleto da lista: o lugar dos avisos, sem inventar nenhum.
    return (
      <View accessible accessibilityLabel="Carregando os avisos" style={estilos.esqueleto}>
        {[0, 1, 2, 3].map((linha) => (
          <View key={linha} style={estilos.linhaDoEsqueleto}>
            <View
              style={[estilos.barra, estilos.barraCurta, { backgroundColor: `${tema.text}14` }]}
            />
            <View style={[estilos.barra, { backgroundColor: `${tema.text}0d` }]} />
            <View
              style={[estilos.barra, estilos.barraMinima, { backgroundColor: `${tema.text}0d` }]}
            />
          </View>
        ))}
      </View>
    );
  }

  const conteudo = {
    erro: {
      icone: 'cloud-offline-outline',
      titulo: 'Não conseguimos carregar os avisos',
      corpo: 'Confira a internet e tente de novo.',
      acao: carregando ? 'Buscando…' : 'Tentar de novo',
      aoAgir: aoRecarregar,
      ocupado: carregando,
    },
    desligada: {
      icone: 'notifications-outline',
      titulo: 'Ative as notificações',
      corpo: `As promoções e novidades da ${nomeDaLoja} chegam por notificação e ficam guardadas aqui.`,
      acao: 'Ativar notificações',
      aoAgir: aoAtivarNotificacoes,
      ocupado: ativando,
    },
    bloqueada: {
      icone: 'notifications-off-outline',
      titulo: 'As notificações estão bloqueadas',
      corpo: `Para receber as novidades da ${nomeDaLoja}, libere as notificações deste app nos ajustes do celular.`,
      acao: 'Abrir ajustes do celular',
      aoAgir: () => {
        void Linking.openSettings();
      },
      ocupado: false,
    },
    indisponivel: {
      icone: 'notifications-off-outline',
      titulo: 'Nenhum aviso por aqui',
      corpo: `Os avisos da ${nomeDaLoja} vão aparecer aqui numa próxima versão do app.`,
      acao: null,
      aoAgir: null,
      ocupado: false,
    },
  } as const satisfies Record<
    Exclude<SituacaoDaCaixa, 'pronta' | 'carregando'>,
    {
      icone: React.ComponentProps<typeof Ionicons>['name'];
      titulo: string;
      corpo: string;
      acao: string | null;
      aoAgir: (() => void) | null;
      ocupado: boolean;
    }
  >;
  const tela = conteudo[situacao];

  return (
    <View style={[estilos.vazioContainer, estilos.vazio]}>
      <Ionicons name={tela.icone} size={40} color={tema.text} />
      <Text style={[estilos.vazioTitulo, { color: tema.text }]}>{tela.titulo}</Text>
      <Text style={[estilos.vazioCorpo, { color: tema.text }]}>{tela.corpo}</Text>
      {tela.acao === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: tela.ocupado, disabled: tela.ocupado }}
          disabled={tela.ocupado}
          onPress={tela.aoAgir}
          style={({ pressed }) => [
            estilos.botao,
            { backgroundColor: tema.primary, opacity: pressed || tela.ocupado ? 0.8 : 1 },
          ]}
        >
          {tela.ocupado ? <ActivityIndicator color={tema.background} /> : null}
          <Text style={[estilos.rotuloDoBotao, { color: tema.background }]}>{tela.acao}</Text>
        </Pressable>
      )}
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
  acoesDoCabecalho: { flexDirection: 'row', alignItems: 'center', gap: 16 },
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
  botao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 12,
  },
  rotuloDoBotao: { fontSize: 15, fontWeight: '600' },
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  textoDaFaixa: { flex: 1, fontSize: 13, lineHeight: 18 },
  acaoDaFaixa: { fontSize: 13, fontWeight: '600' },
  esqueleto: { paddingHorizontal: 23, paddingTop: 8, gap: 22 },
  linhaDoEsqueleto: { gap: 7 },
  barra: { height: 12, borderRadius: 6, width: '100%' },
  barraCurta: { width: '55%', height: 14 },
  barraMinima: { width: '25%', height: 10 },
});
