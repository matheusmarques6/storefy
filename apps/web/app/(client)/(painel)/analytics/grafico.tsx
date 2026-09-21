'use client';

/**
 * Os gráficos da tela C11.
 *
 * Componente de cliente porque o Recharts mede o container para desenhar — no
 * servidor não há largura para medir. O que ele recebe já vem pronto do
 * servidor: aqui não há conta nenhuma, só desenho.
 *
 * DUAS SÉRIES NO MESMO EIXO, app e site, e não um gráfico de cada. Lado a lado
 * o lojista compara duas alturas; separados, ele compararia duas escalas
 * diferentes e leria errado — que é o jeito clássico de um painel mentir sem
 * dado falso.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { comoNumero, comoReais, diaCurto, type DiaDeNumeros } from '@/lib/analytics';

/** Quantos rótulos cabem no eixo sem virar borrão em tela de celular. */
const MAXIMO_DE_ROTULOS = 7;

interface Ponto {
  dia: string;
  app: number;
  site: number;
  ativos: number;
  sessoes: number;
}

function paraPontos(serie: readonly DiaDeNumeros[]): Ponto[] {
  return serie.map((dia) => ({
    dia: diaCurto(dia.day),
    app: dia.revenue_app_cents,
    site: dia.revenue_site_cents,
    ativos: dia.active_users,
    sessoes: dia.sessions,
  }));
}

/**
 * O que o Recharts entrega ao formatador é `unknown` para o TypeScript.
 * Converter aqui, uma vez, evita um `NaN` aparecendo no tooltip do lojista.
 */
function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

/** Mostra um rótulo a cada N dias, para o eixo não virar uma mancha. */
function intervaloDoEixo(pontos: number): number {
  return Math.max(0, Math.ceil(pontos / MAXIMO_DE_ROTULOS) - 1);
}

const EIXO = {
  stroke: 'currentColor',
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

export function GraficoDeReceita({ serie }: { serie: readonly DiaDeNumeros[] }) {
  const pontos = paraPontos(serie);

  return (
    <div className="text-muted-foreground h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cor-app" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
          <XAxis dataKey="dia" interval={intervaloDoEixo(pontos.length)} {...EIXO} />
          <YAxis
            {...EIXO}
            width={72}
            tickFormatter={(valor: number) => comoReais(valor).replace(/\s?,00$/, '')}
          />
          <Tooltip
            formatter={(valor: unknown, nome: unknown) => [comoReais(numero(valor)), String(nome)]}
            labelFormatter={(rotulo: unknown) => `Dia ${String(rotulo)}`}
            contentStyle={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="app"
            name="Pelo app"
            stroke="var(--color-primary)"
            fill="url(#cor-app)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="site"
            name="Pelo site"
            stroke="currentColor"
            fill="none"
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficoDeUso({ serie }: { serie: readonly DiaDeNumeros[] }) {
  const pontos = paraPontos(serie);

  return (
    <div className="text-muted-foreground h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
          <XAxis dataKey="dia" interval={intervaloDoEixo(pontos.length)} {...EIXO} />
          <YAxis {...EIXO} width={48} allowDecimals={false} />
          <Tooltip
            formatter={(valor: unknown, nome: unknown) => [comoNumero(numero(valor)), String(nome)]}
            labelFormatter={(rotulo: unknown) => `Dia ${String(rotulo)}`}
            contentStyle={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="ativos"
            name="Aparelhos ativos"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="sessoes"
            name="Aberturas"
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
