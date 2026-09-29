'use client';

/**
 * C15 — trocar os dados de quem paga. O documento é pedido de novo (ele não
 * fica guardado aqui para voltar preenchido) e vai direto para a Asaas.
 */
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { atualizarQuemPaga, type EstadoDaCobranca } from './acoes';
import { AvisoDaAcao } from './escolher-plano';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function AlterarQuemPaga({ nome, email }: { nome: string; email: string }) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Alterar dados de cobrança
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dados de cobrança</DialogTitle>
          <DialogDescription>
            Valem para as próximas faturas. A Asaas manda a fatura para este e-mail.
          </DialogDescription>
        </DialogHeader>
        {/* Remonta a cada abertura: o formulário volta limpo, sem o aviso da vez anterior. */}
        {aberto ? <Formulario nome={nome} email={email} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({ nome, email }: { nome: string; email: string }) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDaCobranca, FormData>(async (anterior, dados) => {
    const resultado = await atualizarQuemPaga(anterior, dados);
    if (resultado.ok === true) router.refresh();
    return resultado;
  }, {});

  return (
    <form action={acao} className="space-y-4" noValidate>
      <AvisoDaAcao estado={estado} />

      <Campo id="nome-cobranca" rotulo="Nome ou razão social" erro={estado.erros?.nome}>
        <Input
          {...propsDoCampo('nome-cobranca', estado.erros?.nome)}
          name="nome"
          defaultValue={estado.valores?.nome ?? nome}
          autoComplete="organization"
          maxLength={120}
        />
      </Campo>

      <Campo
        id="documento-cobranca"
        rotulo="CPF ou CNPJ"
        erro={estado.erros?.documento}
        dica="Digite de novo: por segurança, o documento inteiro não fica guardado no painel."
      >
        <Input
          {...propsDoCampo('documento-cobranca', estado.erros?.documento, true)}
          name="documento"
          defaultValue={estado.valores?.documento ?? ''}
          autoComplete="off"
          maxLength={20}
        />
      </Campo>

      <Campo id="email-cobranca" rotulo="E-mail que recebe as faturas" erro={estado.erros?.email}>
        <Input
          {...propsDoCampo('email-cobranca', estado.erros?.email)}
          name="email"
          type="email"
          defaultValue={estado.valores?.email ?? email}
          autoComplete="email"
          maxLength={200}
        />
      </Campo>

      <div className="flex justify-end">
        <BotaoEnviar carregando="Salvando...">Salvar</BotaoEnviar>
      </div>
    </form>
  );
}
