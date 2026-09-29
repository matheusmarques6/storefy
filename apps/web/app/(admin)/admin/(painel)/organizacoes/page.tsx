/** A03 — Organizações: busca, filtros (plano, situação, etapa, saúde) e paginação. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { ROTULO_STATUS_ORG } from '@storefy/db';
import { exigirPlatformAdmin } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { CampoBusca, POR_PAGINA, Paginacao, lerParams } from '../paginacao';
import {
  ETAPAS,
  ROTULO_DA_ETAPA,
  ROTULO_DA_SAUDE,
  SAUDES,
  lerFiltros,
  rotuloDoMotivo,
  temFiltro,
  type Etapa,
  type Saude,
} from '@/lib/clientes-do-admin';
import { FUSO_PADRAO, formatarData } from '@/lib/fuso';
import { emailConfigurado } from '@/lib/email';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import {
  ConvitesDaPlataforma,
  FormularioConviteDeLojista,
} from '../_convites/convites-da-plataforma';
import { lerConvitesDaPlataforma } from '../_convites/ler';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EstadoVazio } from '@/components/estado-vazio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Organizações · Admin' };

export default async function PaginaOrganizacoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirPlatformAdmin();
  const params = await searchParams;
  const { busca, pagina, de } = lerParams({
    q: typeof params.q === 'string' ? params.q : undefined,
    pagina: typeof params.pagina === 'string' ? params.pagina : undefined,
  });
  const { filtros, extras } = lerFiltros(params);
  const supabase = await criarClientServidor();

  const [lidos, lidosPlanos, convites, { cadastroAberto }] = await Promise.all([
    supabase.rpc('admin_organizacoes', {
      ...(busca === '' ? {} : { p_busca: busca }),
      ...(filtros.situacao === undefined ? {} : { p_situacao: filtros.situacao }),
      ...(filtros.plano === undefined ? {} : { p_plano: filtros.plano }),
      ...(filtros.etapa === undefined ? {} : { p_etapa: filtros.etapa }),
      ...(filtros.saude === undefined ? {} : { p_saude: filtros.saude }),
      p_limite: POR_PAGINA,
      p_deslocamento: de,
    }),
    supabase.from('plans').select('id, nome').order('nome'),
    lerConvitesDaPlataforma('conta'),
    configuracoesDaPlataforma(),
  ]);
  if (lidos.error != null) {
    throw new Error(`Não foi possível carregar as organizações: ${lidos.error.message}`);
  }
  if (lidosPlanos.error != null) {
    throw new Error(`Não foi possível carregar os planos: ${lidosPlanos.error.message}`);
  }

  const lista = lidos.data;
  const total = lista[0]?.total ?? 0;
  const filtrado = temFiltro(filtros, busca);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizações</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Todos os clientes da plataforma, com a etapa em que cada um está e se precisa de alguém.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convidar lojista</CardTitle>
          <CardDescription>
            {cadastroAberto
              ? 'O cadastro está aberto, e qualquer lojista cria a conta sozinho. O convite serve para chamar alguém com o link pronto.'
              : 'O cadastro está fechado (A13): só entra quem tem convite. O lojista cria a conta pelo link, com a própria empresa.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <FormularioConviteDeLojista emailConfigurado={emailConfigurado()} />
          <div className="space-y-2">
            <p className="text-sm font-medium">Convites de lojista em aberto</p>
            <ConvitesDaPlataforma
              convites={convites}
              podeGerir
              vazio="Nenhum convite de lojista em aberto."
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <CampoBusca
          acao="/admin/organizacoes"
          valor={busca}
          placeholder="Buscar por nome ou identificador"
          extras={extras}
        />

        {/*
          Por GET, como a busca: o filtro vive na URL e o link se compartilha.
          A `key` segue os filtros da URL: o `<select>` só lê o `defaultValue`
          ao montar, e sem ela "Limpar filtros" mostraria a lista inteira com
          os seletores ainda marcando o filtro de antes.
        */}
        <form
          key={JSON.stringify(extras)}
          action="/admin/organizacoes"
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Filtros"
        >
          {busca === '' ? null : <input type="hidden" name="q" value={busca} />}
          <Filtro id="filtro-situacao" nome="situacao" rotulo="Situação" valor={filtros.situacao}>
            {Object.entries(ROTULO_STATUS_ORG).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Filtro>
          <Filtro id="filtro-plano" nome="plano" rotulo="Plano" valor={filtros.plano}>
            <option value="teste">Em teste (sem plano)</option>
            {lidosPlanos.data.map((plano) => (
              <option key={plano.id} value={plano.id}>
                {plano.nome}
              </option>
            ))}
          </Filtro>
          <Filtro id="filtro-etapa" nome="etapa" rotulo="Etapa do começo" valor={filtros.etapa}>
            {ETAPAS.map((etapa) => (
              <option key={etapa} value={etapa}>
                {ROTULO_DA_ETAPA[etapa]}
              </option>
            ))}
          </Filtro>
          <Filtro id="filtro-saude" nome="saude" rotulo="Saúde" valor={filtros.saude}>
            {SAUDES.map((saude) => (
              <option key={saude} value={saude}>
                {ROTULO_DA_SAUDE[saude]}
              </option>
            ))}
          </Filtro>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
          {Object.keys(filtros).length === 0 ? null : (
            <Button variant="ghost" asChild>
              <Link
                href={
                  busca === ''
                    ? '/admin/organizacoes'
                    : `/admin/organizacoes?q=${encodeURIComponent(busca)}`
                }
              >
                Limpar filtros
              </Link>
            </Button>
          )}
        </form>
      </div>

      {lista.length === 0 ? (
        <EstadoVazio
          icone={Building2}
          titulo={filtrado ? 'Nada encontrado' : 'Nenhuma organização ainda'}
          descricao={
            filtrado
              ? 'Nenhuma organização corresponde à busca e aos filtros escolhidos.'
              : 'As organizações aparecem aqui conforme os clientes se cadastram.'
          }
        />
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Última atividade</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <p className="font-medium">{org.nome}</p>
                      <p className="text-muted-foreground font-mono text-xs">{org.identificador}</p>
                    </TableCell>
                    <TableCell>
                      {org.plano === null ? (
                        <span className="text-muted-foreground">
                          Teste até {formatarData(org.teste_ate, FUSO_PADRAO)}
                        </span>
                      ) : org.assinatura_cancelada === true ? (
                        `${org.plano} (cancelada)`
                      ) : (
                        org.plano
                      )}
                    </TableCell>
                    <TableCell>
                      {org.situacao === null ? null : (
                        <Badge variant="secondary">{ROTULO_STATUS_ORG[org.situacao]}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {ROTULO_DA_ETAPA[(org.etapa ?? 'sem_loja') as Etapa]}
                      <p className="text-muted-foreground text-xs">
                        {org.lojas === 1 ? '1 loja' : `${String(org.lojas ?? 0)} lojas`}
                      </p>
                    </TableCell>
                    <TableCell>
                      <SeloDaSaude
                        saude={(org.saude ?? 'boa') as Saude}
                        motivos={org.motivos ?? []}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {org.ultima_atividade === null
                        ? 'Nenhuma ainda'
                        : formatarData(org.ultima_atividade, FUSO_PADRAO)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/organizacoes/${org.id ?? ''}`}>Detalhes</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao
            pagina={pagina}
            total={total}
            base="/admin/organizacoes"
            busca={busca}
            extras={extras}
          />
        </>
      )}
    </div>
  );
}

function Filtro({
  id,
  nome,
  rotulo,
  valor,
  children,
}: {
  id: string;
  nome: string;
  rotulo: string;
  valor: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {rotulo}
      </label>
      <Select id={id} name={nome} defaultValue={valor ?? ''} className="w-48">
        <option value="">Todos</option>
        {children}
      </Select>
    </div>
  );
}

/** A saúde em uma palavra, e embaixo o porquê — é o porquê que a equipe resolve. */
function SeloDaSaude({ saude, motivos }: { saude: Saude; motivos: readonly string[] }) {
  return (
    <div className="space-y-1">
      <Badge
        variant={
          saude === 'critica' ? 'destructive' : saude === 'atencao' ? 'outline' : 'secondary'
        }
      >
        {ROTULO_DA_SAUDE[saude]}
      </Badge>
      {motivos.length === 0 ? null : (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {motivos.map((motivo) => (
            <li key={motivo}>{rotuloDoMotivo(motivo)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
