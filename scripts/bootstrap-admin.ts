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
 *   --redefinir-2fa             apaga o app autenticador de quem já é da equipe
 *
 * A equipe entra no admin com a senha E o código do app autenticador (A01).
 * No primeiro acesso, a pessoa cadastra o app. Quem perde o celular é
 * destravado por outro superadmin na tela Equipe; `--redefinir-2fa` é a saída
 * de emergência para quando não há outro — o único superadmin sem o celular:
 *   pnpm bootstrap:admin voce@convertfy.me --redefinir-2fa
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

/** O endereço do painel, com esquema: é o que o link de senha precisa. */
function urlDoSite(): string {
  const bruto = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (bruto === '') return 'http://app.localhost:3000';
  return /^https?:\/\//.test(bruto) ? bruto : `https://${bruto}`;
}

function abortar(mensagem: string): never {
  console.error(`\n  ${mensagem}\n`);
  process.exit(1);
}

type Cliente = ReturnType<typeof createClient<Database>>;

/** O id da conta com este e-mail, ou `null`. A API admin não busca por e-mail: pagina até achar. */
async function acharUsuario(supabase: Cliente, email: string): Promise<string | null> {
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error != null) abortar(`Não foi possível listar usuários: ${error.message}`);
    if (data.users.length === 0) return null;
    const achado = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (achado != null) return achado.id;
  }
  return null;
}

/**
 * Apaga o app autenticador de quem é da equipe: no próximo acesso ao admin, a
 * pessoa cadastra um novo. Não mexe no papel. Fica na auditoria sem autor
 * (quem rodou foi o terminal, não uma conta), com a origem dita.
 */
async function redefinirSegundoFator(supabase: Cliente, email: string): Promise<void> {
  const usuarioId = await acharUsuario(supabase, email);
  if (usuarioId == null) abortar(`Não existe conta com o e-mail ${email}.`);

  const { data: registro, error: erroDoRegistro } = await supabase
    .from('platform_admins')
    .select('role')
    .eq('user_id', usuarioId)
    .maybeSingle();
  if (erroDoRegistro != null)
    abortar(`Não foi possível ler platform_admins: ${erroDoRegistro.message}`);
  if (registro == null) abortar(`${email} não é da equipe da plataforma.`);

  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId: usuarioId });
  if (error != null) abortar(`Não foi possível ler o app autenticador: ${error.message}`);

  for (const fator of data.factors) {
    const { error: erroDaExclusao } = await supabase.auth.admin.mfa.deleteFactor({
      id: fator.id,
      userId: usuarioId,
    });
    if (erroDaExclusao != null) {
      abortar(`Não foi possível apagar o app autenticador: ${erroDaExclusao.message}`);
    }
  }

  const { error: erroDaTrilha } = await supabase.from('audit_logs').insert({
    actor_id: null,
    org_id: null,
    action: 'update',
    entity: 'platform_admins',
    entity_id: usuarioId,
    diff: {
      segundo_fator: 'redefinido',
      origem: 'script de bootstrap',
      fatores_removidos: data.factors.length,
    },
  });
  if (erroDaTrilha != null) {
    console.warn(`  A redefinição foi feita, mas a auditoria falhou: ${erroDaTrilha.message}`);
  }

  console.info(
    `\n  Pronto. A verificação em duas etapas de ${email} foi redefinida` +
      ` (${String(data.factors.length)} app(s) apagado(s)).\n` +
      '  No próximo acesso ao /admin, a pessoa entra com a senha e cadastra o app autenticador de novo.\n',
  );
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

  if (argumentos.includes('--redefinir-2fa')) {
    await redefinirSegundoFator(supabase, email);
    return;
  }

  console.info(`\n  Procurando ${email}...`);
  let usuarioId = await acharUsuario(supabase, email);

  if (usuarioId == null) {
    /*
     * A conta nasce marcada como criada pela equipe (`app_metadata`, que só a
     * service role escreve): é a exceção que o banco aceita com o cadastro
     * fechado (A13). O convite do Auth (`inviteUserByEmail`) não tem como
     * levar essa marca, e seria recusado justamente quando esta é a única
     * porta — por exemplo, recuperando o acesso de uma plataforma fechada.
     */
    console.info('  Usuário ainda não existe. Criando a conta...');
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { criado_pela_equipe: true },
    });
    if (error != null) abortar(`Não foi possível criar a conta: ${error.message}`);
    usuarioId = data.user.id;

    // A conta nasce sem senha: um link de "definir senha", impresso aqui —
    // funciona mesmo sem o envio de e-mail configurado no Supabase.
    const { data: link, error: erroLink } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (erroLink != null) {
      console.warn(
        `  Conta criada, mas o link de senha falhou (${erroLink.message}).\n` +
          '  A pessoa pode usar "Esqueci minha senha" na tela de login.',
      );
    } else {
      const site = urlDoSite();
      console.info(
        '  Conta criada. Para definir a senha, abra este link (vale 1 hora, uma vez só):\n' +
          `  ${site}/auth/confirmar?token_hash=${link.properties.hashed_token}&type=recovery`,
      );
    }
  }

  const { error: erroInsert } = await supabase
    .from('platform_admins')
    .upsert({ user_id: usuarioId, role: papel }, { onConflict: 'user_id' });

  if (erroInsert != null) {
    abortar(`Não foi possível gravar em platform_admins: ${erroInsert.message}`);
  }

  console.info(`\n  Pronto. ${email} agora é ${papel} da plataforma.`);
  console.info('  Acesse o painel admin em /admin (ou no subdomínio admin, se configurado).');
  console.info(
    '  No primeiro acesso, depois da senha, a pessoa cadastra um app autenticador no celular\n' +
      '  (Google Authenticator, Microsoft Authenticator, 1Password ou Authy): a equipe entra\n' +
      '  com a senha e o código do app.\n',
  );
}

main().catch((erro: unknown) => {
  console.error('\n  Falha no bootstrap:', erro instanceof Error ? erro.message : erro, '\n');
  process.exit(1);
});
