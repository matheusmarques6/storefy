'use client';

/**
 * C16 — convidar alguém para a equipe.
 *
 * O link aparece UMA vez, logo depois de convidar: o banco guarda só o hash
 * do segredo, e não há como mostrá-lo de novo — reenviar gera outro.
 */
import { useActionState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { ROTULO_PAPEL } from '@storefy/db';
import { O_QUE_O_PAPEL_PODE, PAPEIS_CONVIDAVEIS } from '@/lib/convites';
import { convidarParaEquipe, type EstadoDaEquipe } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LinhaCopiavel } from '@/components/linha-copiavel';

export function FormularioDeConvite({ emailConfigurado }: { emailConfigurado: boolean }) {
  const [estado, acao] = useActionState<EstadoDaEquipe, FormData>(convidarParaEquipe, {});
  const papelDigitado = estado.valores?.papel ?? 'admin';

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      {estado.ok === true && estado.link != null ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Link do convite (aparece só agora):</p>
          <LinhaCopiavel valor={estado.link} monoespacado />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <Campo id="email" rotulo="E-mail da pessoa" erro={estado.erros?.email}>
          <Input
            {...propsDoCampo('email', estado.erros?.email)}
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="nome@empresa.com.br"
            defaultValue={estado.valores?.email}
          />
        </Campo>

        <Campo id="papel" rotulo="Papel" erro={estado.erros?.papel}>
          {/* `key`: o `<select>` só lê o valor padrão ao montar. */}
          <Select
            key={papelDigitado}
            {...propsDoCampo('papel', estado.erros?.papel)}
            defaultValue={estado.valores?.papel ?? 'admin'}
          >
            {PAPEIS_CONVIDAVEIS.map((papel) => (
              <option key={papel} value={papel}>
                {ROTULO_PAPEL[papel]}
              </option>
            ))}
          </Select>
        </Campo>
      </div>

      <ul className="text-muted-foreground space-y-1 text-xs">
        {PAPEIS_CONVIDAVEIS.map((papel) => (
          <li key={papel}>
            <span className="text-foreground font-medium">{ROTULO_PAPEL[papel]}:</span>{' '}
            {O_QUE_O_PAPEL_PODE[papel]}
          </li>
        ))}
        <li>
          Para ter outro <span className="text-foreground font-medium">proprietário</span>, convide
          como administrador e mude o papel depois que a pessoa entrar.
        </li>
      </ul>

      {emailConfigurado ? null : (
        <p className="text-muted-foreground text-xs">
          O envio de e-mail ainda não está ligado. Depois de convidar, copie o link e mande para a
          pessoa.
        </p>
      )}

      <BotaoEnviar carregando="Convidando...">Convidar</BotaoEnviar>
    </form>
  );
}
