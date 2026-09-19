import 'server-only';

/**
 * Criptografia dos segredos do produto (regra 3 do CLAUDE.md).
 *
 * Guardam-se aqui a chave REST do OneSignal de cada loja, a chave APNs da
 * Apple, a conta de serviço do Google e o segredo que o app usa para assinar as
 * requisições. Nenhum deles pode ficar em claro no banco: quem lê um backup, ou
 * um dump vazado, teria em mãos o poder de publicar app e disparar push em nome
 * dos clientes.
 *
 * AES-256-GCM, e não AES-CBC: o GCM autentica além de cifrar, então um texto
 * adulterado falha ao abrir em vez de virar lixo silencioso. O IV é sorteado a
 * cada chamada — reaproveitar IV em GCM quebra a cifra inteira, não só aquela
 * mensagem.
 *
 * A CHAVE NUNCA VEM DAQUI. Ela mora em `ENCRYPTION_KEY`, variável de ambiente
 * do servidor, e este módulo é `server-only`: importá-lo de um componente de
 * cliente é erro de build, não descoberta em produção.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** Marca de versão no começo do pacote, para trocar de algoritmo um dia. */
const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_DO_IV = 12; // 96 bits, o recomendado para GCM
const TAMANHO_DA_TAG = 16;

export class ErroDeCriptografia extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeCriptografia';
  }
}

/**
 * A chave de 32 bytes, lida da variável de ambiente.
 *
 * Lançar aqui é proposital: quem chama já decidiu guardar um segredo, e seguir
 * sem chave significaria gravar em claro — exatamente o que este módulo existe
 * para impedir.
 */
function chave(): Buffer {
  const bruta = process.env.ENCRYPTION_KEY ?? '';
  if (bruta === '') {
    throw new ErroDeCriptografia(
      'ENCRYPTION_KEY não configurada. Ela é obrigatória para guardar chaves de Apple, Google e OneSignal.',
    );
  }

  const bytes = Buffer.from(bruta, 'base64');
  if (bytes.length !== 32) {
    throw new ErroDeCriptografia(
      'ENCRYPTION_KEY precisa ser 32 bytes em base64. Gere com: openssl rand -base64 32',
    );
  }
  return bytes;
}

/** A chave está configurada e no formato certo? Para a tela de diagnóstico. */
export function criptografiaConfigurada(): boolean {
  try {
    chave();
    return true;
  } catch {
    return false;
  }
}

/** Cifra um texto. O resultado é seguro para gravar numa coluna `*_enc`. */
export function criptografar(texto: string): string {
  const iv = randomBytes(TAMANHO_DO_IV);
  const cifrador = createCipheriv(ALGORITMO, chave(), iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [VERSAO, iv.toString('base64'), cifrado.toString('base64'), tag.toString('base64')].join(
    '.',
  );
}

/**
 * Abre um pacote cifrado.
 *
 * Qualquer coisa fora do lugar — versão desconhecida, pacote truncado, byte
 * trocado — vira `ErroDeCriptografia`. O GCM é quem percebe a adulteração, e
 * falhar alto aqui é o comportamento certo: usar meia chave de API é pior do
 * que não ter chave nenhuma.
 */
export function descriptografar(pacote: string): string {
  const partes = pacote.split('.');
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new ErroDeCriptografia('Pacote criptografado em formato desconhecido.');
  }

  const [, ivB64 = '', cifradoB64 = '', tagB64 = ''] = partes;
  const iv = Buffer.from(ivB64, 'base64');
  const cifrado = Buffer.from(cifradoB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  if (iv.length !== TAMANHO_DO_IV || tag.length !== TAMANHO_DA_TAG || cifrado.length === 0) {
    throw new ErroDeCriptografia('Pacote criptografado com tamanhos inválidos.');
  }

  try {
    const decifrador = createDecipheriv(ALGORITMO, chave(), iv);
    decifrador.setAuthTag(tag);
    return Buffer.concat([decifrador.update(cifrado), decifrador.final()]).toString('utf8');
  } catch (erro) {
    if (erro instanceof ErroDeCriptografia) throw erro;
    throw new ErroDeCriptografia(
      'Não foi possível abrir o segredo: ele foi alterado ou a chave mudou.',
    );
  }
}

/**
 * Comparação que não entrega o segredo pelo tempo de resposta.
 *
 * `a === b` para em cima da primeira diferença, e a diferença de microssegundos
 * entre "errou no primeiro byte" e "errou no último" é o suficiente para
 * descobrir um segredo byte a byte.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` exige tamanhos iguais; o tamanho em si não é segredo.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
