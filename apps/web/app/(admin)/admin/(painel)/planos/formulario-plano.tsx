'use client';

/**
 * A09 — o formulário de um plano, para criar e para editar.
 *
 * As caixas de marcar são livres, com o padrão devolvido pela ação: numa caixa
 * controlada, a limpeza do formulário no fim da ação a devolveria ao valor do
 * primeiro desenho (`formularios-controlados.test.ts`).
 */
import { useActionState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { EstadoDoPlano } from './acoes';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BotaoEnviar } from '@/components/botao-enviar';
import { Campo, propsDoCampo } from '@/components/campo';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ValoresDoPlano {
  nome: string;
  descricao: string;
  preco: string;
  limiteLojas: string;
  limiteAparelhos: string;
  limiteCampanhas: string;
  disponivel: boolean;
  valeNoTeste: boolean;
}

export function FormularioDoPlano({
  acao,
  inicial,
  botao,
}: {
  acao: (anterior: EstadoDoPlano, dados: FormData) => Promise<EstadoDoPlano>;
  inicial: ValoresDoPlano;
  botao: string;
}) {
  const [estado, enviar] = useActionState<EstadoDoPlano, FormData>(acao, {});

  return (
    <form action={enviar} className="space-y-4" noValidate>
      {estado.mensagem == null ? null : (
        <Alert variant={estado.ok === true ? 'info' : 'destructive'}>
          {estado.ok === true ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
          <AlertDescription>{estado.mensagem}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo id="nome" rotulo="Nome" erro={estado.erros?.nome}>
          <Input
            {...propsDoCampo('nome', estado.erros?.nome)}
            defaultValue={estado.valores?.nome ?? inicial.nome}
            maxLength={40}
          />
        </Campo>
        <Campo
          id="preco"
          rotulo="Preço por mês (R$)"
          erro={estado.erros?.preco}
          dica="Ex.: 99,90. A Asaas não cobra menos de R$ 5,00."
        >
          <Input
            {...propsDoCampo('preco', estado.erros?.preco, true)}
            defaultValue={estado.valores?.preco ?? inicial.preco}
            inputMode="decimal"
            maxLength={16}
          />
        </Campo>
      </div>

      <Campo
        id="descricao"
        rotulo="Descrição (opcional)"
        erro={estado.erros?.descricao}
        dica="Uma frase para o lojista entender para quem é o plano."
      >
        <Textarea
          {...propsDoCampo('descricao', estado.erros?.descricao, true)}
          defaultValue={estado.valores?.descricao ?? inicial.descricao}
          rows={2}
          maxLength={200}
        />
      </Campo>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Limites (vazio é sem limite)</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Campo id="limiteLojas" rotulo="Lojas" erro={estado.erros?.limiteLojas}>
            <Input
              {...propsDoCampo('limiteLojas', estado.erros?.limiteLojas)}
              defaultValue={estado.valores?.limiteLojas ?? inicial.limiteLojas}
              inputMode="numeric"
              maxLength={4}
            />
          </Campo>
          <Campo
            id="limiteAparelhos"
            rotulo="Aparelhos ativos (30 dias)"
            erro={estado.erros?.limiteAparelhos}
          >
            <Input
              {...propsDoCampo('limiteAparelhos', estado.erros?.limiteAparelhos)}
              defaultValue={estado.valores?.limiteAparelhos ?? inicial.limiteAparelhos}
              inputMode="numeric"
              maxLength={9}
            />
          </Campo>
          <Campo
            id="limiteCampanhas"
            rotulo="Campanhas por mês"
            erro={estado.erros?.limiteCampanhas}
          >
            <Input
              {...propsDoCampo('limiteCampanhas', estado.erros?.limiteCampanhas)}
              defaultValue={estado.valores?.limiteCampanhas ?? inicial.limiteCampanhas}
              inputMode="numeric"
              maxLength={6}
            />
          </Campo>
        </div>
      </fieldset>

      <div className="space-y-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="disponivel"
            defaultChecked={estado.disponivel ?? inicial.disponivel}
            className="mt-1 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">Disponível para assinar</span>
            <span className="text-muted-foreground block">
              Desmarcado, sai da vitrine; quem já assina continua no plano.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="valeNoTeste"
            defaultChecked={estado.valeNoTeste ?? inicial.valeNoTeste}
            aria-describedby={estado.erros?.valeNoTeste == null ? undefined : 'valeNoTeste-erro'}
            className="mt-1 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">Os limites deste plano valem no teste</span>
            <span className="text-muted-foreground block">
              Quem está no teste grátis usa até estes limites. Só um plano pode ter esta marca.
            </span>
            {estado.erros?.valeNoTeste == null ? null : (
              <span
                id="valeNoTeste-erro"
                role="alert"
                className="text-destructive block text-xs font-medium"
              >
                {estado.erros.valeNoTeste}
              </span>
            )}
          </span>
        </label>
      </div>

      <BotaoEnviar carregando="Salvando...">{botao}</BotaoEnviar>
    </form>
  );
}
