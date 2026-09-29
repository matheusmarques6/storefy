'use client';

/**
 * O nome do app (C06a): o que aparece embaixo do ícone e na loja de aplicativos.
 *
 * Fica FORA do rascunho: o nome vai dentro do binário, e não na config remota
 * — muda no celular do cliente no próximo envio às lojas, e não ao publicar.
 * Por isso tem o próprio botão, em vez do salvamento automático do resto do
 * editor, e diz quando passa a valer.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MAXIMO_DO_NOME } from '@/lib/checklist-de-publicacao';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renomearApp } from './acoes';

/** Embaixo do ícone, a tela inicial do iPhone mostra por volta disto e corta o resto. */
const CABE_EMBAIXO_DO_ICONE = 12;

export function CampoDeNome({
  nomeAtual,
  somenteLeitura,
}: {
  nomeAtual: string;
  somenteLeitura: boolean;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const limpo = nome.trim().replace(/\s+/g, ' ');
  const mudou = limpo !== nomeAtual;

  function salvar() {
    if (limpo === '') {
      setErro('Dê um nome ao app.');
      return;
    }
    if (limpo.length > MAXIMO_DO_NOME) {
      setErro(
        `O nome passa de ${String(MAXIMO_DO_NOME)} caracteres, e a App Store cortaria. Encurte o nome.`,
      );
      return;
    }
    setErro(null);
    iniciar(async () => {
      const resultado = await renomearApp(limpo);
      if (resultado.ok === true) {
        toast.success(resultado.mensagem ?? 'Nome do app salvo.');
        router.refresh();
      } else {
        // O que foi digitado fica no campo, com o motivo embaixo.
        setErro(resultado.mensagem ?? 'Não foi possível salvar o nome.');
      }
    });
  }

  return (
    <form
      className="max-w-md space-y-1.5"
      onSubmit={(evento) => {
        evento.preventDefault();
        salvar();
      }}
    >
      <Label htmlFor="nome-do-app">Nome do app</Label>
      <div className="flex gap-2">
        <Input
          id="nome-do-app"
          value={nome}
          disabled={somenteLeitura}
          autoComplete="off"
          aria-invalid={erro !== null}
          aria-describedby="nome-do-app-ajuda"
          onChange={(evento) => {
            setNome(evento.target.value);
            setErro(null);
          }}
        />
        {somenteLeitura ? null : (
          <Button type="submit" variant="outline" disabled={salvando || !mudou}>
            {salvando ? 'Salvando…' : 'Salvar nome'}
          </Button>
        )}
      </div>
      <p
        id="nome-do-app-ajuda"
        role={erro === null ? undefined : 'alert'}
        className={erro === null ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}
      >
        {erro ??
          `${String(limpo.length)} de ${String(MAXIMO_DO_NOME)} caracteres. Aparece embaixo do ícone e na loja de aplicativos, e muda no celular dos clientes no próximo envio às lojas.`}
      </p>
      {erro === null && limpo.length > CABE_EMBAIXO_DO_ICONE ? (
        <p className="text-muted-foreground text-xs">
          Embaixo do ícone, o iPhone mostra uns {CABE_EMBAIXO_DO_ICONE} caracteres e corta o resto
          com &quot;…&quot;. Um nome curto aparece inteiro.
        </p>
      ) : null}
    </form>
  );
}
