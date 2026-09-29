import 'server-only';

/**
 * O segredo com que cada app assina o que manda (seção 6 do plano).
 *
 * Um por app, guardado criptografado em `apps.device_secret_enc` e embutido no
 * binário na hora do build. Não é sigilo — quem desmonta o app acha. O que ele
 * entrega é que o acesso é POR LOJA: um vazamento fica contido numa loja, em
 * vez de abrir os endpoints públicos para o produto inteiro.
 *
 * Nasce no primeiro build da loja (ou na primeira correção OTA que a alcance),
 * por `garantirSegredoDoApp`, e dali em diante não muda: cada binário já
 * instalado assina com ele.
 */
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografar, descriptografar } from '@/lib/cripto';
import { log } from '@/lib/log';

type Client = SupabaseClient<Database>;

/**
 * 32 bytes em base64url.
 *
 * Sai sem `+`, `/` nem `=` porque este valor atravessa variável de ambiente do
 * EAS, YAML de workflow e `app.config.ts` até chegar ao binário — e é em um
 * desses saltos que um caractere especial vira escape errado e um segredo
 * silenciosamente diferente dos dois lados.
 */
export function gerarSegredoDeApp(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Lê o segredo cifrado de um app. `null` quando o app não existe ou não tem.
 *
 * Devolve o texto CIFRADO: quem decide descriptografar é quem vai conferir a
 * assinatura, e deixar assim mantém o valor em claro fora de todo o resto.
 */
export async function buscarSegredoCifrado(appId: string): Promise<string | null> {
  const supabase = criarClientServiceRole();
  const { data, error } = await supabase
    .from('apps')
    .select('device_secret_enc')
    .eq('id', appId)
    .maybeSingle();

  if (error != null) throw new Error('falha ao ler o segredo do app');
  return data?.device_secret_enc ?? null;
}

/**
 * O segredo deste app, em claro — criado agora, se ainda não existe.
 *
 * FALHA CORRIGIDA: nada no produto criava o segredo. A função que o gerava
 * não tinha quem a chamasse, todo build saía com `deviceSecret` nulo, e o app,
 * sem com que assinar, não registrava o aparelho nem mandava evento nenhum —
 * push, automações e números paravam na origem, sem erro em lugar nenhum.
 *
 * Quem chama é quem entrega o segredo ao binário: a rota do build e a da
 * correção OTA (que o leva aos apps gerados antes desta correção).
 *
 * DOIS BUILDS AO MESMO TEMPO — o iOS e o Android da mesma loja — não podem
 * criar dois segredos: o segundo gravaria por cima do primeiro, e o binário
 * que saiu com o primeiro nasceria sem conseguir falar com o servidor. A
 * gravação só vale se a coluna ainda está vazia; quem perde a corrida relê e
 * usa o segredo de quem ganhou.
 *
 * UM SEGREDO QUE NÃO ABRE não é trocado aqui. Quase sempre é a
 * `ENCRYPTION_KEY` errada neste servidor, e trocar gravaria um segredo novo
 * cifrado com a chave errada por cima do bom — derrubando, sem volta, todo
 * app já instalado da loja. Falhar alto deixa o build na fila e manda a
 * equipe olhar a chave.
 */
export async function garantirSegredoDoApp(
  servico: Client,
  appId: string,
  cifradoLido: string | null,
): Promise<string> {
  let cifrado = cifradoLido;

  // Duas voltas bastam: quem perde a corrida acha, na releitura, o do vencedor.
  for (let volta = 0; volta < 2; volta += 1) {
    if (cifrado != null && cifrado !== '') return abrir(cifrado, appId);

    const segredo = gerarSegredoDeApp();
    const gravacao = servico
      .from('apps')
      .update({ device_secret_enc: criptografar(segredo) })
      .eq('id', appId);
    const { data: gravados, error } = await (
      cifrado === '' ? gravacao.eq('device_secret_enc', '') : gravacao.is('device_secret_enc', null)
    ).select('id');
    if (error != null)
      throw new Error(`Não foi possível gravar o segredo do app: ${error.message}`);

    if (gravados.length > 0) {
      log.info('segredo-do-app.criado', { appId });
      return segredo;
    }

    const { data: relido, error: erroAoReler } = await servico
      .from('apps')
      .select('device_secret_enc')
      .eq('id', appId)
      .maybeSingle();
    if (erroAoReler != null) {
      throw new Error(`Não foi possível reler o segredo do app: ${erroAoReler.message}`);
    }
    if (relido == null) throw new Error('O app não existe mais.');
    cifrado = relido.device_secret_enc;
  }

  throw new Error('O segredo do app mudou durante a gravação e não voltou a aparecer.');
}

function abrir(cifrado: string, appId: string): string {
  let emClaro: string;
  try {
    emClaro = descriptografar(cifrado);
  } catch {
    log.erro('segredo-do-app.ilegivel', { appId });
    throw new Error(
      'O segredo do app não abre com a ENCRYPTION_KEY deste servidor. Confira a chave antes de gerar outro build.',
    );
  }
  if (emClaro === '') throw new Error('O segredo do app está vazio depois de aberto.');
  return emClaro;
}
