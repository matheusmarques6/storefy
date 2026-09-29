import 'server-only';

/**
 * O que a página de status busca (Fase 8): as datas de cada job, pela função
 * pública `batimentos_publicos`, com a chave ANÔNIMA — a página não precisa de
 * mais que isso, e não deve ter. O tempo de resposta dessa mesma chamada diz
 * como está o banco.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@storefy/db';
import { env, supabaseConfigurado } from '@/lib/env';
import { log } from '@/lib/log';
import {
  JOBS_DO_STATUS,
  resumoDoStatus,
  situacaoDoJob,
  type Batimento,
  type EstadoDoComponente,
  type SituacaoDoComponente,
} from '@/lib/status';

export interface ComponenteNaTela extends SituacaoDoComponente {
  id: string;
  nome: string;
  descricao: string;
}

export interface StatusDaPagina {
  resumo: { estado: EstadoDoComponente; frase: string };
  componentes: ComponenteNaTela[];
  verificadoEm: string;
}

/** Acima disto, o banco responde, mas devagar. */
const BANCO_LENTO_MS = 2000;

export async function lerStatus(): Promise<StatusDaPagina> {
  const batimentos = new Map<string, Batimento>();
  let banco: SituacaoDoComponente;

  if (!supabaseConfigurado) {
    banco = { estado: 'parado', detalhe: 'O banco não está configurado neste ambiente.' };
  } else {
    const inicio = Date.now();
    try {
      const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.rpc('batimentos_publicos');
      const latencia = Date.now() - inicio;
      if (error != null) {
        log.erro('status.banco-nao-respondeu', { falha: error });
        banco = { estado: 'parado', detalhe: 'O banco não respondeu.' };
      } else {
        for (const linha of data) {
          if (linha.job === null) continue;
          batimentos.set(linha.job, {
            ultimoSucesso: linha.ultimo_sucesso,
            ultimaFalha: linha.ultima_falha,
            falhandoDesde: linha.falhando_desde,
          });
        }
        banco =
          latencia > BANCO_LENTO_MS
            ? { estado: 'instavel', detalhe: `Respondendo devagar (${String(latencia)} ms).` }
            : { estado: 'operacional', detalhe: `Respondeu em ${String(latencia)} ms.` };
      }
    } catch (erro) {
      log.erro('status.banco-nao-respondeu', { erro });
      banco = { estado: 'parado', detalhe: 'O banco não respondeu.' };
    }
  }

  const agora = Date.now();
  const componentes: ComponenteNaTela[] = [
    {
      id: 'banco',
      nome: 'Banco de dados',
      descricao: 'Painel, contas e tudo o que o app busca.',
      ...banco,
    },
    ...JOBS_DO_STATUS.map((job) => ({
      id: job.job,
      nome: job.nome,
      descricao: job.descricao,
      // Banco fora do ar: não dá para saber dos jobs, e "aguardando" mentiria.
      ...(banco.estado === 'parado'
        ? { estado: 'parado' as const, detalhe: 'Sem como conferir enquanto o banco não responde.' }
        : situacaoDoJob(batimentos.get(job.job), job.intervaloMin, agora)),
    })),
  ];

  return {
    resumo: resumoDoStatus(componentes.map((componente) => componente.estado)),
    componentes,
    verificadoEm: new Date(agora).toISOString(),
  };
}

export interface RotinaNaTela extends ComponenteNaTela {
  ultimoSucesso: string | null;
  ultimaFalha: string | null;
  /** O texto da última falha — só a equipe o vê. */
  ultimoErro: string | null;
  duracaoMs: number | null;
}

/**
 * As rotinas como a equipe as vê na A13: a mesma situação da página pública,
 * mais o texto da última falha e quanto a última execução levou. A leitura é
 * com a sessão de quem está logado — a política só deixa a equipe ver.
 */
export async function rotinasParaAEquipe(
  supabase: SupabaseClient<Database>,
): Promise<RotinaNaTela[] | null> {
  const { data, error } = await supabase
    .from('job_heartbeats')
    .select('job, last_success_at, last_failure_at, failing_since, last_error, last_duration_ms');
  if (error != null) {
    log.erro('status.rotinas-nao-lidas', { falha: error });
    return null;
  }

  const agora = Date.now();
  return JOBS_DO_STATUS.map((job) => {
    const linha = data.find((item) => item.job === job.job);
    return {
      id: job.job,
      nome: job.nome,
      descricao: job.descricao,
      ...situacaoDoJob(
        linha === undefined
          ? undefined
          : {
              ultimoSucesso: linha.last_success_at,
              ultimaFalha: linha.last_failure_at,
              falhandoDesde: linha.failing_since,
            },
        job.intervaloMin,
        agora,
      ),
      ultimoSucesso: linha?.last_success_at ?? null,
      ultimaFalha: linha?.last_failure_at ?? null,
      ultimoErro: linha?.last_error ?? null,
      duracaoMs: linha?.last_duration_ms ?? null,
    };
  });
}
