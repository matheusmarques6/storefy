/**
 * Cadastra o primeiro platform_admin real.
 *
 * Substitui o seed com dados fictícios, que a regra 1 do CLAUDE.md proíbe: em
 * vez de inventar um usuário, este script promove uma pessoa de verdade, a
 * partir de um e-mail que você informa.
 *
 * Uso:
 *   pnpm bootstrap:admin voce@convertfy.me
 *   BOOTSTRAP_ADMIN_EMAIL=voce@convertfy.me pnpm bootstrap:admin
 *
 * Opções:
 *   --role=superadmin|support   (padrão: superadmin)
 *
 * Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente
 * (ou em .env.local). A service role é necessária porque `platform_admins` não
 * tem policy de INSERT — de propósito: ninguém vira admin pelo painel.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database, PlatformAdminRole } from '@storefy/db';

/**
 * Lê o `.env.local` sem dependência externa, para o script rodar com `tsx` puro.
 *
 * Procura em `apps/web/` primeiro, porque é lá que o arquivo mora: o Next
 * carrega os `.env*` ao lado do próprio app, e não da raiz do monorepo.
 * A raiz continua na lista para quem preferir manter o arquivo lá e só usar
 * os scripts.
 */
function carregarEnvLocal(): void {
  const candidatos = ['apps/web/.env.local', 'apps/web/.env', '.env.local', '.env'];
  for (const arquivo of candidatos) {
    try {
      const conteudo = readFileSync(resolve(import.meta.dirname, '..', arquivo), 'utf8');
      for (const linha of conteudo.split('\n')) {
        const limpa = linha.trim();
        if (limpa === '' || limpa.startsWith('#')) continue;
        const separador = limpa.indexOf('=');
        if (separador === -1) continue;
        const chave = limpa.slice(0, separador).trim();
        const valor = limpa
          .slice(separador + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        process.env[chave] ??= valor;
      }
    } catch {
      // Arquivo ausente é normal: em produção as variáveis vêm do ambiente.
    }
  }
}

function abortar(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  carregarEnvLocal();

  const argumentos = process.argv.slice(2);
  const email = (
    argumentos.find((arg) => !arg.startsWith('--')) ??
    process.env.BOOTSTRAP_ADMIN_EMAIL ??
    ''
  ).trim();

  const papelBruto = (
    argumentos.find((arg) => arg.startsWith('--role='))?.split('=')[1] ?? 'superadmin'
  ).trim();

  if (email === '') {
    abortar(
      'Informe o e-mail do administrador:\n' +
        '    pnpm bootstrap:admin voce@convertfy.me\n' +
        '  ou defina BOOTSTRAP_ADMIN_EMAIL no ambiente.',
    );
  }
  if (papelBruto !== 'superadmin' && papelBruto !== 'support') {
    abortar(`Papel inválido: "${papelBruto}". Use --role=superadmin ou --role=support.`);
  }
  const papel: PlatformAdminRole = papelBruto;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Dizer QUAL variável falta poupa uma rodada de tentativa e erro: as duas
  // vêm de lugares diferentes do painel do Supabase.
  const faltando: string[] = [];
  if (url == null || url === '') faltando.push('NEXT_PUBLIC_SUPABASE_URL');
  if (chave == null || chave === '') faltando.push('SUPABASE_SERVICE_ROLE_KEY');

  if (faltando.length > 0 || url == null || chave == null) {
    abortar(
      `Faltam estas variáveis: ${faltando.join(', ')}\n` +
        '  Preencha em apps/web/.env.local (copie de .env.example).\n' +
        '  A chave de service role está em: Supabase > Project Settings > API Keys > service_role.',
    );
  }

  const supabase = createClient<Database>(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.info(`\n  Procurando ${email}...`);

  // A API admin não tem busca por e-mail, então paginamos até achar.
  let usuarioId: string | null = null;
  for (let pagina = 1; pagina <= 20 && usuarioId == null; pagina += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error != null) abortar(`Não foi possível listar usuários: ${error.message}`);
    if (data.users.length === 0) break;
    usuarioId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  }

  if (usuarioId == null) {
    console.info('  Usuário ainda não existe. Enviando convite...');
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
    if (error != null) {
      abortar(
        `Não foi possível convidar: ${error.message}\n` +
          '  Se o SMTP ainda não está configurado, peça para a pessoa se cadastrar pelo painel\n' +
          '  e rode este script novamente.',
      );
    }
    usuarioId = data.user.id;
    console.info('  Convite enviado. A pessoa define a senha pelo link do e-mail.');
  }

  const { error: erroInsert } = await supabase
    .from('platform_admins')
    .upsert({ user_id: usuarioId, role: papel }, { onConflict: 'user_id' });

  if (erroInsert != null) {
    abortar(`Não foi possível gravar em platform_admins: ${erroInsert.message}`);
  }

  console.info(`\n  Pronto. ${email} agora é ${papel} da plataforma.`);
  console.info('  Acesse o painel admin em /admin (ou no subdomínio admin, se configurado).\n');
}

main().catch((erro: unknown) => {
  console.error('\n  Falha no bootstrap:', erro instanceof Error ? erro.message : erro, '\n');
  process.exit(1);
});
