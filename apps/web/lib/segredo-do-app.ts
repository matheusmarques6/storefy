import 'server-only';

/**
 * O segredo com que cada app assina o que manda (seção 6 do plano).
 *
 * Um por app, guardado criptografado em `apps.device_secret_enc` e embutido no
 * binário na hora do build. Não é sigilo — quem desmonta o app acha. O que ele
 * entrega é que o acesso é POR LOJA e revogável: um vazamento fica contido
 * numa loja e morre quando o lojista gera outro, em vez de abrir os endpoints
 * públicos para o produto inteiro.
 */
import { randomBytes } from 'node:crypto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criptografar } from '@/lib/cripto';

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
 * Gera um segredo novo para o app e devolve o valor EM CLARO, uma única vez.
 *
 * Em claro porque é a única hora em que ele pode ser mostrado: depois daqui só
 * existe cifrado, e nem o painel nem nós conseguimos lê-lo de volta. Gerar de
 * novo invalida o anterior na hora — é assim que se revoga.
 */
export async function girarSegredoDoApp(appId: string): Promise<string> {
  const segredo = gerarSegredoDeApp();
  const supabase = criarClientServiceRole();
  const { error } = await supabase
    .from('apps')
    .update({ device_secret_enc: criptografar(segredo) })
    .eq('id', appId);

  if (error != null) throw new Error('falha ao gravar o segredo do app');
  return segredo;
}
