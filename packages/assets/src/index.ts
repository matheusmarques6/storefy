/**
 * Geração dos assets de cada loja (seção 7 do plano).
 *
 * O lojista envia UM ícone e UMA tela de abertura. Daqui saem os arquivos que
 * o Expo precisa para montar o binário — e, mais importante, as recusas
 * acontecem AQUI, e não quatro dias depois num e-mail da Apple.
 *
 * As três recusas que este arquivo existe para evitar:
 *
 *   ícone com transparência. A Apple rejeita, e o motivo que ela dá
 *   ("Invalid Icon") não menciona transparência;
 *   ícone com cantos arredondados desenhados. Os dois sistemas arredondam
 *   sozinhos, e um ícone já arredondado sai com uma borda escura em volta;
 *   ícone pequeno demais. 1024×1024 é o mínimo da App Store, e escalar para
 *   cima produz um ícone borrado que passa na validação e fica feio na loja.
 */
export {
  ERROS,
  TAMANHO_DO_ICONE,
  PROPORCAO_SEGURA_DO_ADAPTATIVO,
  analisarIcone,
  gerarAssets,
  problemasDoIcone,
  type AnaliseDoIcone,
  type AssetsGerados,
  type ProblemaDoIcone,
} from './icones';
