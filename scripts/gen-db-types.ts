/**
 * Gera `packages/db/src/database.types.ts` a partir do schema real do Postgres.
 *
 * POR QUE UM GERADOR PRÓPRIO: `supabase gen types` roda o postgres-meta em um
 * container, e o registro Docker não é acessível em todo ambiente (nem no CI
 * remoto deste projeto). Este script fala direto com o Postgres por `pg`, então
 * funciona em qualquer lugar que alcance o banco — local ou na nuvem.
 *
 * A forma da saída é a mesma do Supabase (Database.public.Tables.<t>.Row etc.),
 * para continuar compatível com `createClient<Database>()`.
 *
 * Uso:
 *   pnpm db:types                                  # cluster local
 *   PGURL=postgres://... pnpm db:types             # qualquer banco
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const PGURL = process.env.PGURL ?? 'postgres://postgres:postgres@127.0.0.1:5432/storefy_local';
const SAIDA = resolve(import.meta.dirname, '../packages/db/src/database.types.ts');

interface Coluna {
  tabela: string;
  nome: string;
  tipo: string;
  tipo_udt: string;
  anulavel: boolean;
  tem_default: boolean;
  is_identity: boolean;
}

interface FuncaoSql {
  nome: string;
  argumentos: string;
  retorno: string;
}

interface ChaveEstrangeira {
  tabela: string;
  coluna: string;
  tabela_ref: string;
  coluna_ref: string;
  nome: string;
}

/** Mapeia um tipo do Postgres para o tipo TypeScript equivalente. */
function tipoTs(coluna: Coluna, enums: Map<string, string[]>): string {
  const { tipo, tipo_udt } = coluna;

  if (tipo === 'ARRAY') {
    const base = tipo_udt.replace(/^_/, '');
    if (enums.has(base)) return `Database["public"]["Enums"]["${base}"][]`;
    return `${escalarTs(base)}[]`;
  }
  if (tipo === 'USER-DEFINED' && enums.has(tipo_udt)) {
    return `Database["public"]["Enums"]["${tipo_udt}"]`;
  }
  return escalarTs(tipo_udt);
}

function escalarTs(udt: string): string {
  switch (udt) {
    case 'uuid':
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'citext':
    case 'timestamptz':
    case 'timestamp':
    case 'date':
    case 'time':
    case 'timetz':
    case 'interval':
    case 'inet':
      return 'string';
    case 'bool':
      return 'boolean';
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'numeric':
      return 'number';
    case 'json':
    case 'jsonb':
      return 'Json';
    default:
      // Um tipo novo e não mapeado vira `unknown` de propósito: `any` esconderia
      // o problema, e a regra 1 do CLAUDE.md proíbe `any` sem justificativa.
      return 'unknown';
  }
}

/** Converte "p_org_id uuid, p_x text" em um objeto TypeScript. */
function argumentosTs(argumentos: string, enums: Map<string, string[]>): string {
  const partes = argumentos
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte !== '');

  if (partes.length === 0) return 'Record<string, never>';

  const campos = partes.map((parte) => {
    /*
     * `pg_get_function_arguments` devolve "p_minutos integer DEFAULT 60". Sem
     * cortar o DEFAULT, o tipo vira "integer DEFAULT 60", não casa com nada e
     * sai `unknown` — que aceita qualquer coisa e some com a checagem justo
     * nos argumentos opcionais. Argumento com default vira opcional aqui.
     */
    const temDefault = / default /i.test(parte);
    const limpo = parte.replace(/ default .*$/i, '');
    const pedacos = limpo.split(/\s+/);
    const nome = pedacos[0] ?? 'arg';
    const tipo = pedacos.slice(1).join(' ');
    return `${nome}${temDefault ? '?' : ''}: ${tipoDeclaradoTs(tipo, enums)}`;
  });

  return `{ ${campos.join('; ')} }`;
}

/** Converte "TABLE(a uuid, b text)" ou um tipo escalar no tipo de retorno. */
function retornoTs(retorno: string, enums: Map<string, string[]>): string {
  const tabela = /^TABLE\((.*)\)$/is.exec(retorno.trim());
  if (tabela?.[1] != null) {
    const campos = tabela[1]
      .split(',')
      .map((parte) => parte.trim())
      .filter((parte) => parte !== '')
      .map((parte) => {
        const pedacos = parte.split(/\s+/);
        const nome = pedacos[0] ?? 'coluna';
        const tipo = pedacos.slice(1).join(' ');
        return `${nome}: ${tipoDeclaradoTs(tipo, enums)} | null`;
      });
    return `{ ${campos.join('; ')} }[]`;
  }

  const semSetof = retorno.replace(/^SETOF\s+/i, '').trim();
  const base = tipoDeclaradoTs(semSetof, enums);
  return /^SETOF\s/i.test(retorno) ? `${base}[]` : base;
}

/** Mapeia um tipo como aparece no DDL ("uuid", "public.membership_role"). */
function tipoDeclaradoTs(tipo: string, enums: Map<string, string[]>): string {
  const limpo = tipo
    .replace(/^public\./, '')
    .replace(/\[\]$/, '')
    .trim()
    .toLowerCase();
  const ehArray = tipo.trim().endsWith('[]');

  let base: string;
  if (enums.has(limpo)) {
    base = `Database["public"]["Enums"]["${limpo}"]`;
  } else {
    base = escalarTs(
      {
        'timestamp with time zone': 'timestamptz',
        'timestamp without time zone': 'timestamp',
        'character varying': 'varchar',
        integer: 'int4',
        bigint: 'int8',
        smallint: 'int2',
        boolean: 'bool',
        'double precision': 'float8',
        real: 'float4',
      }[limpo] ?? limpo,
    );
  }

  return ehArray ? `${base}[]` : base;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: PGURL });
  await client.connect();

  const { rows: enumRows } = await client.query<{ nome: string; valor: string }>(`
    select t.typname as nome, e.enumlabel as valor
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    order by t.typname, e.enumsortorder
  `);

  const enums = new Map<string, string[]>();
  for (const { nome, valor } of enumRows) {
    const atual = enums.get(nome) ?? [];
    atual.push(valor);
    enums.set(nome, atual);
  }

  const { rows: colunas } = await client.query<Coluna>(`
    select
      c.table_name        as tabela,
      c.column_name       as nome,
      c.data_type         as tipo,
      c.udt_name          as tipo_udt,
      (c.is_nullable = 'YES')                     as anulavel,
      (c.column_default is not null)              as tem_default,
      (c.is_identity = 'YES')                     as is_identity
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position
  `);

  const { rows: fks } = await client.query<ChaveEstrangeira>(`
    select
      tc.constraint_name as nome,
      kcu.table_name     as tabela,
      kcu.column_name    as coluna,
      ccu.table_name     as tabela_ref,
      ccu.column_name    as coluna_ref
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    order by kcu.table_name, kcu.column_name
  `);

  /** RPCs sem o prefixo `admin_` que o painel chama. */
  const RPCS = [
    'publicar_config',
    // A02 — os números da visão geral do admin, numa chamada só.
    'resumo_do_admin',
    'restaurar_config',
    'abrir_previa',
    'registrar_aparelho',
    'registrar_evento_de_carrinho',
    'caixa_de_avisos',
    // Os jobs do cron.
    'reservar_campanhas',
    'concluir_campanha',
    'falhar_campanha',
    'devolver_campanhas_presas',
    'reservar_envios_de_automacao',
    'concluir_envio',
    'falhar_envio',
    'devolver_envios_presos',
    'campanhas_para_estatistica',
    'gravar_estatistica',
    'builds_em_revisao',
    'gravar_revisao',
    'reservar_aviso',
    'devolver_aviso',
    'emails_do_build',
    'lojas_para_ota',
    'dados_da_ota',
    'contar_ota',
    'registrar_pedido',
    'consolidar_analytics',
    'ativos_no_periodo',
    'agendar_pedido_enviado',
    'inscrever_de_volta',
    'avisar_de_volta',
    'contar_abertura',
    'dia_da_loja',
    'app_da_loja_shopify',
    'desconectar_shopify',
    'apagar_dados_da_shopify',
    // Usada pelo envio de teste do painel, pela service role.
    'consumir_limite',
  ];

  const { rows: funcoes } = await client.query<FuncaoSql>(
    `
    select
      p.proname                        as nome,
      pg_get_function_arguments(p.oid) as argumentos,
      pg_get_function_result(p.oid)    as retorno
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Só as funções chamadas por .rpc(); gatilhos e helpers de policy ficam
      -- de fora. Esquecer de somar uma RPC nova aqui não passa despercebido:
      -- chamar supabase.rpc() com um nome fora deste mapa é erro de tipo no
      -- typecheck do painel.
      and (p.proname like 'admin\\_%' or p.proname = any ($1::text[]))
    order by p.proname
  `,
    [RPCS],
  );

  await client.end();

  const porTabela = new Map<string, Coluna[]>();
  for (const coluna of colunas) {
    const atual = porTabela.get(coluna.tabela) ?? [];
    atual.push(coluna);
    porTabela.set(coluna.tabela, atual);
  }

  const partes: string[] = [];
  partes.push(`/**
 * ARQUIVO GERADO — NÃO EDITAR À MÃO.
 *
 * Origem: schema do Postgres, via \`pnpm db:types\` (scripts/gen-db-types.ts).
 * Regenere depois de toda migration e commite o resultado: o CI compara o
 * arquivo commitado com o schema e falha se saírem de sincronia.
 */

export type Json = string | number | boolean | null | { [chave: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {`);

  for (const [tabela, cols] of [...porTabela.entries()].sort()) {
    partes.push(`      ${tabela}: {`);

    partes.push('        Row: {');
    for (const c of cols) {
      partes.push(`          ${c.nome}: ${tipoTs(c, enums)}${c.anulavel ? ' | null' : ''};`);
    }
    partes.push('        };');

    partes.push('        Insert: {');
    for (const c of cols) {
      // Opcional na inserção quando tem default, é identidade ou aceita nulo.
      const opcional = c.tem_default || c.is_identity || c.anulavel;
      partes.push(
        `          ${c.nome}${opcional ? '?' : ''}: ${tipoTs(c, enums)}${c.anulavel ? ' | null' : ''};`,
      );
    }
    partes.push('        };');

    partes.push('        Update: {');
    for (const c of cols) {
      partes.push(`          ${c.nome}?: ${tipoTs(c, enums)}${c.anulavel ? ' | null' : ''};`);
    }
    partes.push('        };');

    const fksTabela = fks.filter((f) => f.tabela === tabela);
    if (fksTabela.length === 0) {
      partes.push('        Relationships: [];');
    } else {
      partes.push('        Relationships: [');
      for (const fk of fksTabela) {
        partes.push('          {');
        partes.push(`            foreignKeyName: "${fk.nome}";`);
        partes.push(`            columns: ["${fk.coluna}"];`);
        partes.push(`            referencedRelation: "${fk.tabela_ref}";`);
        partes.push(`            referencedColumns: ["${fk.coluna_ref}"];`);
        partes.push('          },');
      }
      partes.push('        ];');
    }

    partes.push('      };');
  }

  partes.push('    };');
  partes.push('    Views: Record<never, never>;');
  if (funcoes.length === 0) {
    partes.push('    Functions: Record<never, never>;');
  } else {
    partes.push('    Functions: {');
    for (const funcao of funcoes) {
      partes.push(`      ${funcao.nome}: {`);
      partes.push(`        Args: ${argumentosTs(funcao.argumentos, enums)};`);
      partes.push(`        Returns: ${retornoTs(funcao.retorno, enums)};`);
      partes.push('      };');
    }
    partes.push('    };');
  }

  partes.push('    Enums: {');
  for (const [nome, valores] of [...enums.entries()].sort()) {
    partes.push(`      ${nome}: ${valores.map((v) => `"${v}"`).join(' | ')};`);
  }
  partes.push('    };');
  partes.push('    CompositeTypes: Record<never, never>;');
  partes.push('  };');
  partes.push('};');
  partes.push('');

  writeFileSync(SAIDA, partes.join('\n'), 'utf8');
  console.info(
    `Tipos gerados: ${String(porTabela.size)} tabelas, ${String(enums.size)} enums -> ${SAIDA}`,
  );
}

main().catch((erro: unknown) => {
  console.error('Falha ao gerar os tipos:', erro);
  process.exit(1);
});
