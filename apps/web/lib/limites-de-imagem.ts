/**
 * O teto das imagens que o lojista envia (ícone, tela de abertura, imagem do
 * push), num lugar que a tela e o servidor leem igual.
 *
 * A tela confere antes de enviar — um arquivo de 20 MB não precisa subir
 * inteiro para ouvir "grande demais" — e o servidor confere de novo.
 */
export const TAMANHO_MAXIMO_DE_IMAGEM = 8 * 1024 * 1024;

export const MENSAGEM_DE_IMAGEM_GRANDE = 'A imagem passa de 8 MB. Use uma versão menor.';
