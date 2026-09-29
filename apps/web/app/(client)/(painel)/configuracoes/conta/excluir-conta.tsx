'use client';

/**
 * Minha conta — excluir a própria conta.
 *
 * A tela diz ANTES o que acontece com cada empresa (excluída, propriedade
 * passada a alguém, ou só a saída), com a mesma regra que o banco aplica. A
 * confirmação pede o e-mail digitado e, tendo senha, a senha: não é um clique
 * que se dá sem querer.
 */
import { useActionState, useState } from 'react';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { excluirMinhaConta, type EstadoDaExclusao } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface EfeitoNaEmpresa {
  empresa: string;
  efeito: 'excluida' | 'passa_para' | 'sai';
  sucessor: string | null;
  lojas: number;
}

function frase(efeito: EfeitoNaEmpresa): string {
  if (efeito.efeito === 'excluida') {
    const lojas =
      efeito.lojas === 0
        ? 'sem lojas'
        : efeito.lojas === 1
          ? 'com 1 loja e o app dela'
          : `com ${String(efeito.lojas)} lojas e os apps delas`;
    return `será EXCLUÍDA, ${lojas} — você é a única pessoa nela. Se ela tiver assinatura, a assinatura é cancelada.`;
  }
  if (efeito.efeito === 'passa_para') {
    return `${efeito.sucessor ?? 'a pessoa mais antiga da equipe'} passa a ser o proprietário.`;
  }
  return 'você sai da equipe; o resto continua como está.';
}

export function ExcluirConta({
  email,
  pedeSenha,
  efeitos,
  bloqueio,
}: {
  email: string;
  /** Quem entrou só pelo Google não tem senha para digitar. */
  pedeSenha: boolean;
  efeitos: EfeitoNaEmpresa[];
  /** Motivo que impede a exclusão (último superadmin), ou null. */
  bloqueio: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState<EstadoDaExclusao, FormData>(
    async (anterior, dados) => {
      const resultado = await excluirMinhaConta(anterior, dados);
      // A sessão acabou junto com a conta: a página inteira recomeça.
      if (resultado.ok === true) window.location.assign(resultado.destino ?? '/entrar');
      return resultado;
    },
    {},
  );
  const vaiExcluirEmpresa = efeitos.some((efeito) => efeito.efeito === 'excluida');

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Excluir minha conta</CardTitle>
        <CardDescription>
          Apaga sua conta e seus dados de acesso na Storefy. Não dá para desfazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {efeitos.length === 0 ? (
          <p className="text-sm">Nenhuma empresa é afetada: só a sua conta é apagada.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {efeitos.map((efeito) => (
              <li
                key={efeito.empresa}
                className={efeito.efeito === 'excluida' ? 'text-destructive' : undefined}
              >
                <span className="font-medium">{efeito.empresa}</span>: {frase(efeito)}
              </li>
            ))}
          </ul>
        )}

        {bloqueio === null ? (
          <Button
            type="button"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={() => {
              setAberto(true);
            }}
          >
            <Trash2 aria-hidden />
            Excluir minha conta
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">{bloqueio}</p>
        )}
      </CardContent>

      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <form action={acao} className="space-y-4" noValidate>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir sua conta para sempre?</AlertDialogTitle>
              <AlertDialogDescription>
                {vaiExcluirEmpresa
                  ? 'As empresas em que você é a única pessoa são excluídas junto, com as lojas e os apps. Os apps que já estão nas lojas de aplicativos deixam de receber configuração.'
                  : 'Você sai de todas as empresas, e seus dados de acesso são apagados.'}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {estado.mensagem == null ? null : (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{estado.mensagem}</AlertDescription>
              </Alert>
            )}

            {/*
              Ids próprios: esta página já tem um `confirmacao` (repetir a nova
              senha), e com o id repetido o rótulo daqui apontava para aquele
              campo — clicar em "Para confirmar" focava a troca de senha.
            */}
            <Campo
              id="confirmacao-exclusao"
              rotulo={`Para confirmar, digite ${email}`}
              erro={estado.erros?.confirmacao}
            >
              <Input
                {...propsDoCampo('confirmacao-exclusao', estado.erros?.confirmacao)}
                name="confirmacao"
                defaultValue={estado.valores?.confirmacao}
                type="email"
                autoComplete="off"
                spellCheck={false}
              />
            </Campo>

            {pedeSenha ? (
              <Campo id="senha-exclusao" rotulo="Sua senha" erro={estado.erros?.senha}>
                <Input
                  {...propsDoCampo('senha-exclusao', estado.erros?.senha)}
                  name="senha"
                  type="password"
                  autoComplete="current-password"
                />
              </Campo>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={enviando}>
                Voltar
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={enviando}>
                {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Excluir para sempre
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
