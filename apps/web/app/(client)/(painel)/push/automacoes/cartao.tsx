'use client';

/**
 * O card de uma automação (C09).
 *
 * Liga e desliga direto no card, e abre o editor de mensagem quando o lojista
 * quer mexer no texto. Ligar é a ação mais comum de longe, e enterrá-la dentro
 * de um formulário faria a automação que mais traz venda ficar desligada.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ATRASOS_SUGERIDOS,
  DESCRICAO_DO_TIPO,
  descricaoDoAtraso,
  type TipoDeAutomacao,
} from '@/lib/automacao';
import { MAXIMO_DO_CORPO, MAXIMO_DO_TITULO, type ProblemaNoFormulario } from '@/lib/campanha';
import type { AutomacaoSalva } from '@/lib/push-servidor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PreviaDaNotificacao } from '../previa-da-notificacao';
import { salvarAutomacao } from '../acoes';

interface Props {
  tipo: TipoDeAutomacao;
  salva: AutomacaoSalva | null;
  urlDaLoja: string;
  nomeDoApp: string;
  podeEscrever: boolean;
}

export function CartaoDaAutomacao({ tipo, salva, urlDaLoja, nomeDoApp, podeEscrever }: Props) {
  const descricao = DESCRICAO_DO_TIPO[tipo];
  const router = useRouter();

  const [aberto, setAberto] = useState(false);
  const [enviando, iniciar] = useTransition();
  const [problemas, setProblemas] = useState<ProblemaNoFormulario[]>([]);

  /*
   * Sem linha no banco, o formulário abre com a sugestão do tipo — texto de
   * partida para o lojista editar. Nada disso vira dado antes de ele salvar:
   * a automação só existe quando ele decide que existe.
   */
  const [valores, setValores] = useState({
    title: salva?.title ?? descricao.sugestao.title,
    body: salva?.body ?? descricao.sugestao.body,
    deepLink: salva?.deepLink ?? '',
    delayMinutes: salva?.delayMinutes ?? descricao.sugestao.delayMinutes,
  });

  const ligada = salva?.enabled ?? false;
  const erroDe = (campo: ProblemaNoFormulario['campo']): string | undefined =>
    problemas.find((problema) => problema.campo === campo)?.mensagem;

  function salvar(enabled: boolean, fechar: boolean) {
    iniciar(async () => {
      const resultado = await salvarAutomacao({ tipo, ...valores, enabled });

      if (resultado.problemas !== undefined && resultado.problemas.length > 0) {
        setProblemas(resultado.problemas);
        toast.error('Confira os campos destacados.');
        return;
      }
      if (resultado.ok !== true) {
        toast.error(resultado.mensagem ?? 'Não foi possível salvar.');
        return;
      }

      setProblemas([]);
      if (fechar) setAberto(false);
      toast.success(resultado.mensagem ?? 'Pronto.');
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{descricao.nome}</CardTitle>
          <CardDescription>{descricao.gatilho}</CardDescription>
          <p className="text-muted-foreground text-xs">
            {ligada
              ? `Ligada · envia ${descricaoDoAtraso(valores.delayMinutes)} depois`
              : descricao.porque}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {enviando ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />
          ) : null}
          <Switch
            checked={ligada}
            disabled={!podeEscrever || enviando}
            aria-label={`${ligada ? 'Desligar' : 'Ligar'} ${descricao.nome}`}
            onCheckedChange={(marcado) => {
              salvar(marcado, false);
            }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!podeEscrever}
          onClick={() => {
            setAberto((anterior) => !anterior);
          }}
          aria-expanded={aberto}
        >
          {aberto ? 'Fechar' : 'Editar mensagem'}
        </Button>

        {aberto ? (
          <div className="grid gap-6 border-t pt-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`titulo-${tipo}`}>Título</Label>
                <Input
                  id={`titulo-${tipo}`}
                  value={valores.title}
                  maxLength={MAXIMO_DO_TITULO}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, title: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'title'));
                  }}
                  aria-invalid={erroDe('title') !== undefined}
                />
                {erroDe('title') === undefined ? null : (
                  <p className="text-destructive text-sm">{erroDe('title')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`corpo-${tipo}`}>Mensagem</Label>
                <Textarea
                  id={`corpo-${tipo}`}
                  rows={3}
                  value={valores.body}
                  maxLength={MAXIMO_DO_CORPO}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, body: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'body'));
                  }}
                  aria-invalid={erroDe('body') !== undefined}
                />
                {erroDe('body') === undefined ? null : (
                  <p className="text-destructive text-sm">{erroDe('body')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`link-${tipo}`}>Abrir em (opcional)</Label>
                <Input
                  id={`link-${tipo}`}
                  value={valores.deepLink}
                  placeholder={tipo === 'abandoned_cart' ? '/cart' : '/colecoes/novidades'}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, deepLink: evento.target.value }));
                    setProblemas((p) => p.filter((problema) => problema.campo !== 'deepLink'));
                  }}
                  aria-invalid={erroDe('deepLink') !== undefined}
                />
                <p className="text-muted-foreground text-xs">
                  {erroDe('deepLink') ?? `Uma página de ${urlDaLoja}. Vazio abre a tela inicial.`}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`atraso-${tipo}`}>{descricao.rotuloDoAtraso}</Label>
                <select
                  id={`atraso-${tipo}`}
                  value={String(valores.delayMinutes)}
                  onChange={(evento) => {
                    setValores((v) => ({ ...v, delayMinutes: Number(evento.target.value) }));
                  }}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {ATRASOS_SUGERIDOS.map((opcao) => (
                    <option key={opcao.minutos} value={opcao.minutos}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-xs">
                  Entre 22h e 8h o envio espera até as 8h, no horário da sua loja. Ninguém gosta de
                  ser acordado por uma promoção.
                </p>
              </div>

              <Button
                type="button"
                disabled={enviando}
                onClick={() => {
                  salvar(ligada, true);
                }}
              >
                {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Salvar mensagem
              </Button>
            </div>

            <PreviaDaNotificacao nomeDoApp={nomeDoApp} title={valores.title} body={valores.body} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
