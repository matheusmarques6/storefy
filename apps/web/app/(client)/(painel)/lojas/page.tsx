/** Lista de lojas da organização ativa. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Store as IconeLoja } from 'lucide-react';
import { ROTULO_STATUS_LOJA, podeEscrever } from '@storefy/db';
import { exigirContextoCliente } from '@/lib/contexto';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EstadoVazio } from '@/components/estado-vazio';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Lojas' };

export default async function PaginaLojas() {
  const { lojas, papel } = await exigirContextoCliente();
  const podeCriar = podeEscrever(papel);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lojas</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Cada loja vira um app próprio, com configurações e publicação separadas.
          </p>
        </div>
        {podeCriar && lojas.length > 0 ? (
          <Button asChild>
            <Link href="/lojas/nova">
              <Plus aria-hidden />
              Nova loja
            </Link>
          </Button>
        ) : null}
      </div>

      {lojas.length === 0 ? (
        <EstadoVazio
          icone={IconeLoja}
          titulo="Nenhuma loja cadastrada"
          descricao={
            podeCriar
              ? 'Cadastre a primeira informando o nome e o endereço do site.'
              : 'Peça a um proprietário ou administrador para cadastrar a primeira loja.'
          }
          acao={
            podeCriar ? (
              <Button asChild>
                <Link href="/lojas/nova">
                  <Plus aria-hidden />
                  Cadastrar loja
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lojas.map((loja) => (
                <TableRow key={loja.id}>
                  <TableCell className="font-medium">{loja.name}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[18rem] truncate">
                    {loja.primary_url}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROTULO_STATUS_LOJA[loja.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/lojas/${loja.id}`}>Abrir</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
