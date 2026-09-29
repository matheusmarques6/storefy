/** Moldura do painel do cliente: cabeçalho, seletor de loja e navegação. */
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { ehPlatformAdmin, exigirContextoCliente } from '@/lib/contexto';
import { FaixaDaVisita } from './faixa-da-visita';
import { MenuUsuario } from './menu-usuario';
import { NavegacaoAbas, NavegacaoMovel } from './navegacao';
import { SeletorLoja } from './seletor-loja';

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const contexto = await exigirContextoCliente();
  // Em visita, quem está aqui é da equipe por definição: a visita só abre para
  // quem está em `platform_admins`, conferido a cada request.
  const admin = contexto.visita != null || (await ehPlatformAdmin(contexto.usuario.id));
  const { avisoNoPainel } = await configuracoesDaPlataforma();

  return (
    <div className="flex min-h-dvh flex-col">
      {contexto.visita == null ? null : (
        <FaixaDaVisita cliente={contexto.organizacao.name} expiraEm={contexto.visita.expiraEm} />
      )}
      {avisoNoPainel === '' ? null : (
        // O aviso da Storefy para todos os lojistas (A13): manutenção,
        // instabilidade de uma loja de aplicativos, mudança de preço.
        <div role="status" className="bg-muted border-b">
          <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm">
            <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{avisoNoPainel}</span>
          </p>
        </div>
      )}
      <header className="bg-background/95 sticky top-0 z-40 border-b backdrop-blur">
        {/*
         * Linha 1: o que é da CONTA — marca, loja ativa e usuário. Linha 2 (a
         * partir de 1024px): as seções. Abaixo disso, as seções viram o menu
         * do botão à esquerda. Nenhuma combinação rola a página para o lado.
         */}
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4">
          <NavegacaoMovel />
          <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
            Storefy
          </Link>
          <div className="bg-border hidden h-6 w-px sm:block" />
          {/* `min-w-0` deixa o seletor encolher e truncar o nome da loja, em
              vez de empurrar o menu da conta para fora da tela. */}
          <div className="min-w-0 flex-1">
            <SeletorLoja
              lojas={contexto.lojas}
              lojaAtiva={contexto.lojaAtiva}
              emVisita={contexto.visita != null}
            />
          </div>
          <MenuUsuario
            email={contexto.usuario.email ?? ''}
            ehAdmin={admin}
            emVisita={contexto.visita != null}
          />
        </div>
        <NavegacaoAbas />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t py-6">
        <p className="text-muted-foreground mx-auto max-w-6xl px-4 text-xs">
          Storefy by Convertfy · {contexto.organizacao.name}
        </p>
      </footer>
    </div>
  );
}
