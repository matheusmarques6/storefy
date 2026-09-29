'use client';

/** A01b — cadastrar o app autenticador: explicar, mostrar o QR code, confirmar o código. */
import { useActionState, useState, useTransition } from 'react';
import Image from 'next/image';
import { AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { sairDoAdmin } from '../acoes';
import { comecarCadastroDoApp, confirmarCadastroDoApp, type EstadoDaConfirmacao } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Button } from '@/components/ui/button';
import { Campo, propsDoCampo } from '@/components/campo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LinhaCopiavel } from '@/components/linha-copiavel';

interface AppEmCadastro {
  fatorId: string;
  qr: string;
  segredo: string;
}

export function CadastroDoAppAutenticador({ email }: { email: string }) {
  const [app, setApp] = useState<AppEmCadastro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, iniciar] = useTransition();

  function gerarQr() {
    setErro(null);
    iniciar(async () => {
      const resultado = await comecarCadastroDoApp();
      if (resultado.ok) {
        setApp({ fatorId: resultado.fatorId, qr: resultado.qr, segredo: resultado.segredo });
      } else {
        setApp(null);
        setErro(resultado.mensagem);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {app === null ? 'Ative a verificação em duas etapas' : 'Leia o QR code com o app'}
        </CardTitle>
        <CardDescription>
          {app === null
            ? 'O painel da Storefy mostra os dados de todos os clientes. Por isso, além da senha, cada acesso pede um código do app autenticador do seu celular.'
            : `No app autenticador, adicione uma conta e aponte a câmera para o código abaixo. Ela aparece como “Storefy Admin”${email === '' ? '' : ` (${email})`}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {erro === null ? null : (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {app === null ? (
          <>
            <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
              <li>
                Instale um app autenticador no celular, se ainda não tiver: Google Authenticator,
                Microsoft Authenticator, 1Password ou Authy.
              </li>
              <li>Toque em “Começar” e leia o QR code com o app.</li>
              <li>Digite o código de 6 números que o app mostrar.</li>
            </ol>
            <Button type="button" className="w-full" disabled={gerando} onClick={gerarQr}>
              <ShieldCheck aria-hidden />
              {gerando ? 'Gerando o QR code...' : 'Começar'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              {/* Fundo branco sempre: no tema escuro, o app do celular não leria o QR. */}
              <div className="rounded-lg border bg-white p-3">
                <Image
                  src={app.qr}
                  alt="QR code para cadastrar a Storefy Admin no app autenticador"
                  width={176}
                  height={176}
                  unoptimized
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                Não consegue ler o QR code? No app, escolha digitar a chave e use esta:
              </p>
              <LinhaCopiavel valor={app.segredo} monoespacado />
            </div>

            <ConfirmarCodigo fatorId={app.fatorId} />

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={gerando}
              onClick={gerarQr}
            >
              <RefreshCw aria-hidden />
              {gerando ? 'Gerando o QR code...' : 'Gerar outro QR code'}
            </Button>
          </>
        )}

        <form action={sairDoAdmin}>
          <Button type="submit" variant="ghost" className="w-full">
            Sair e entrar com outra conta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfirmarCodigo({ fatorId }: { fatorId: string }) {
  const [estado, acao] = useActionState<EstadoDaConfirmacao, FormData>(confirmarCadastroDoApp, {});
  // Controlado: o código recusado continua no campo, selecionado — digitar o
  // novo já troca o velho, e um dígito trocado ainda dá para ver.
  const [codigo, setCodigo] = useState('');

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="fator" value={fatorId} />
      <Campo id="codigo" rotulo="Código que o app mostra" erro={estado.erros?.codigo}>
        <Input
          {...propsDoCampo('codigo', estado.erros?.codigo)}
          key={estado.tentativa ?? 0}
          value={codigo}
          onChange={(evento) => {
            setCodigo(evento.target.value);
          }}
          onFocus={(evento) => {
            evento.currentTarget.select();
          }}
          autoFocus={estado.tentativa !== undefined}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123456"
          className="text-center font-mono text-lg tracking-[0.3em]"
        />
      </Campo>
      <BotaoEnviar className="w-full" carregando="Ativando...">
        Ativar e entrar
      </BotaoEnviar>
    </form>
  );
}
