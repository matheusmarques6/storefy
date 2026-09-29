/**
 * `POST /api/erros` — os erros do navegador, a caminho do Sentry (Fase 8).
 *
 * Quem chama é o próprio painel (`lib/erros-do-navegador.ts`), por
 * `sendBeacon`. É um endereço público — o erro pode acontecer antes do login —
 * e por isso tudo aqui é defensivo:
 *
 *   - SEM `SENTRY_DSN`, a resposta é 204 e nada acontece: não há para onde
 *     mandar, e gastar banco com isso seria à toa;
 *   - o corpo é pequeno e conferido campo a campo; o resto é descartado;
 *   - há teto por pessoa e teto geral por hora. Sem eles, qualquer um
 *     encheria o Sentry da Storefy — e a cota dele — com lixo;
 *   - o endereço IP não é guardado: vira um resumo (hash) só para o teto.
 *
 * A resposta é sempre vazia. Um erro de relatório não tem o que dizer a quem
 * já está vendo uma tela de erro.
 */
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { LIMITES_DO_ERRO } from '@/lib/erros-do-navegador';
import { log } from '@/lib/log';
import { relatarErro, sentryConfigurado } from '@/lib/sentry';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Maior corpo aceito: a pilha mais a folga dos outros campos. */
const TAMANHO_MAXIMO = 8 * 1024;
const POR_PESSOA_POR_HORA = 30;
const NO_TOTAL_POR_HORA = 1000;

function semConteudo(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

const CorpoDoErro = z.object({
  tipo: z.string().trim().min(1).max(LIMITES_DO_ERRO.tipo),
  mensagem: z.string().trim().min(1).max(LIMITES_DO_ERRO.mensagem),
  pilha: z.string().max(LIMITES_DO_ERRO.pilha).optional(),
  pagina: z.string().max(LIMITES_DO_ERRO.pagina).regex(/^\//),
  onde: z.enum(['janela', 'promessa', 'tela']),
});

/** Um resumo do IP, só para o teto: o endereço em si não é guardado. */
function quemManda(requisicao: NextRequest): string {
  const ip = (requisicao.headers.get('x-forwarded-for') ?? '').split(',', 1)[0]?.trim() ?? '';
  return createHash('sha256')
    .update(ip === '' ? 'desconhecido' : ip)
    .digest('hex')
    .slice(0, 24);
}

async function dentroDoTeto(requisicao: NextRequest): Promise<boolean> {
  if (!supabaseConfigurado || !serviceRoleConfigurada) return false;
  const servico = criarClientServiceRole();
  const [pessoa, total] = await Promise.all([
    servico.rpc('consumir_limite', {
      p_chave: `erros:${quemManda(requisicao)}`,
      p_maximo: POR_PESSOA_POR_HORA,
      p_janela_segundos: 3600,
    }),
    servico.rpc('consumir_limite', {
      p_chave: 'erros:todos',
      p_maximo: NO_TOTAL_POR_HORA,
      p_janela_segundos: 3600,
    }),
  ]);
  const falha = pessoa.error ?? total.error;
  if (falha != null) {
    // Sem o teto não há como segurar uma enxurrada: melhor não mandar.
    log.erro('erros-do-navegador.teto-indisponivel', { falha });
    return false;
  }
  if (pessoa.data !== true || total.data !== true) {
    log.aviso('erros-do-navegador.acima-do-teto');
    return false;
  }
  return true;
}

export async function POST(requisicao: NextRequest): Promise<NextResponse> {
  if (!sentryConfigurado()) return semConteudo();

  const texto = await requisicao.text().catch(() => '');
  if (texto === '' || texto.length > TAMANHO_MAXIMO) return semConteudo();

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return semConteudo();
  }
  const lido = CorpoDoErro.safeParse(bruto);
  if (!lido.success) return semConteudo();

  if (!(await dentroDoTeto(requisicao))) return semConteudo();

  const { tipo, mensagem, pilha, pagina, onde } = lido.data;
  const erro = new Error(mensagem);
  erro.name = tipo;
  // A pilha é a do navegador, e não a desta rota.
  erro.stack = pilha ?? `${tipo}: ${mensagem}`;

  await relatarErro({
    erro,
    origem: 'navegador',
    marcas: { pagina, onde },
    extras: { navegador: (requisicao.headers.get('user-agent') ?? '').slice(0, 200) },
  });
  return semConteudo();
}
