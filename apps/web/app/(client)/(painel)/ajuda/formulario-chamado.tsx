'use client';

/**
 * C17 — abrir um chamado. Assunto, título, a loja (quando é de uma) e a
 * mensagem; depois de abrir, a pessoa vai direto para a conversa.
 */
import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import type { TicketTopic } from '@storefy/db';
import { ASSUNTOS, ROTULO_DO_ASSUNTO, TAMANHO_MAXIMO_DA_MENSAGEM } from '@/lib/chamados';
import { abrirChamado, type EstadoDoChamado } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function FormularioDeChamado({
  lojas,
  lojaAtiva,
  assuntoInicial = null,
}: {
  lojas: { id: string; name: string }[];
  lojaAtiva: string | null;
  /** O assunto já escolhido, quando a pessoa chega de outra tela. */
  assuntoInicial?: TicketTopic | null;
}) {
  const router = useRouter();
  const [estado, acao] = useActionState<EstadoDoChamado, FormData>(async (anterior, dados) => {
    const resultado = await abrirChamado(anterior, dados);
    if (resultado.ok === true && resultado.destino != null) router.push(resultado.destino);
    return resultado;
  }, {});

  const assunto = estado.valores?.assunto ?? assuntoInicial ?? '';
  const loja = estado.valores?.loja ?? lojaAtiva ?? '';

  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.ok === true || estado.mensagem == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo id="assunto" rotulo="Assunto" erro={estado.erros?.assunto}>
          {/* `key`: o `<select>` só lê o valor padrão ao montar. */}
          <Select
            key={`assunto-${assunto}`}
            {...propsDoCampo('assunto', estado.erros?.assunto)}
            defaultValue={estado.valores?.assunto ?? assuntoInicial ?? ''}
          >
            <option value="" disabled>
              Escolha…
            </option>
            {ASSUNTOS.map((item) => (
              <option key={item} value={item}>
                {ROTULO_DO_ASSUNTO[item]}
              </option>
            ))}
          </Select>
        </Campo>

        <Campo id="loja" rotulo="Loja (opcional)" erro={estado.erros?.loja}>
          <Select
            key={`loja-${loja}`}
            {...propsDoCampo('loja', estado.erros?.loja)}
            defaultValue={estado.valores?.loja ?? loja}
          >
            <option value="">Não é sobre uma loja</option>
            {lojas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Campo>
      </div>

      <Campo id="titulo" rotulo="Título" erro={estado.erros?.titulo}>
        <Input
          {...propsDoCampo('titulo', estado.erros?.titulo)}
          defaultValue={estado.valores?.titulo}
          placeholder="Ex.: O app foi recusado pela Apple"
          maxLength={120}
        />
      </Campo>

      <Campo
        id="mensagem"
        rotulo="Mensagem"
        erro={estado.erros?.mensagem}
        dica="Conte o que aconteceu, o que você esperava e, se tiver, a mensagem de erro que apareceu."
      >
        <Textarea
          {...propsDoCampo('mensagem', estado.erros?.mensagem, true)}
          defaultValue={estado.valores?.mensagem}
          rows={5}
          maxLength={TAMANHO_MAXIMO_DA_MENSAGEM}
        />
      </Campo>

      <BotaoEnviar carregando="Enviando...">Abrir chamado</BotaoEnviar>
    </form>
  );
}
