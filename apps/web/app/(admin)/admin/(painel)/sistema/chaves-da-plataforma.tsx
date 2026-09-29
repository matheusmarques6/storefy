'use client';

/**
 * A13 — as chaves de funcionamento: cadastro aberto, aviso no painel e onde
 * baixar o app Storefy Preview.
 *
 * O aviso tem prévia: é uma frase que TODOS os lojistas vão ler no topo de
 * toda tela, e ver como ela fica antes de salvar evita o erro de digitação
 * publicado para a base inteira.
 */
import { useActionState, useState } from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import { TAMANHO_MAXIMO_DO_AVISO } from '@/lib/configuracoes-da-plataforma';
import { salvarChavesDaPlataforma, type EstadoDasChaves } from './acoes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ChavesDaPlataforma({
  cadastroAberto,
  avisoNoPainel,
  previaNoIphone,
  previaNoAndroid,
  videoDaApple,
  videoDoGoogle,
  podeMudar,
}: {
  cadastroAberto: boolean;
  avisoNoPainel: string;
  previaNoIphone: string;
  previaNoAndroid: string;
  /** O vídeo do passo a passo de cada conta (C13), no endereço de incorporar. */
  videoDaApple: string;
  videoDoGoogle: string;
  /** Só superadmin muda; `support` vê. O servidor confere de novo. */
  podeMudar: boolean;
}) {
  /*
   * No fim de toda ação, o React devolve cada campo do formulário ao seu
   * valor PADRÃO. O aviso é controlado (a prévia acompanha a digitação), e
   * numa caixa de texto controlada o React atualiza o padrão junto com o
   * valor — ela sobrevive. Numa caixa de MARCAR controlada, não: o padrão
   * fica o do primeiro desenho. Era assim que, ao fechar o cadastro e salvar,
   * a caixa "Cadastro aberto" voltava a aparecer marcada com o cadastro
   * fechado — e o próximo salvamento gravava o contrário do que a tela
   * mostrava. Por isso a caixa é livre, e o padrão dela é o que o servidor
   * devolveu (`formularios-controlados.test.ts` trava a volta).
   */
  const [aviso, setAviso] = useState(avisoNoPainel);
  const [estado, enviar, enviando] = useActionState<EstadoDasChaves, FormData>(
    async (anterior, dados) => {
      const resultado = await salvarChavesDaPlataforma(anterior, dados);
      if (resultado.ok === true) toast.success(resultado.mensagem ?? 'Chaves salvas.');
      else if (resultado.mensagem != null) toast.error(resultado.mensagem);
      return resultado;
    },
    {},
  );

  return (
    <form action={enviar} className="space-y-6" noValidate>
      <fieldset disabled={!podeMudar || enviando} className="space-y-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="cadastroAberto"
            defaultChecked={estado.cadastroAberto ?? cadastroAberto}
            className="mt-1 size-4"
          />
          <span>
            <span className="text-sm font-medium">Cadastro aberto</span>
            <span className="text-muted-foreground block text-sm">
              Desligado, a tela de criar conta diz que os cadastros estão fechados, e quem já tem
              conta entra normalmente. Quem entra pelo Google ainda cria conta: para fechar esse
              caminho também, desligue o provedor Google no Supabase.
            </span>
          </span>
        </label>

        <div className="space-y-2">
          <Label htmlFor="aviso">Aviso no painel de todos os lojistas</Label>
          <textarea
            id="aviso"
            name="aviso"
            rows={2}
            maxLength={TAMANHO_MAXIMO_DO_AVISO}
            value={aviso}
            onChange={(evento) => {
              setAviso(evento.target.value);
            }}
            placeholder="Ex.: Manutenção programada hoje, das 23h à meia-noite. O app dos seus clientes não para."
            className="border-input bg-background focus-visible:ring-ring w-full rounded-xl border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-describedby="aviso-dica"
          />
          <p id="aviso-dica" className="text-muted-foreground text-xs">
            Vazio, não aparece nada. Uma frase só: ela fica no topo de toda tela, para todo lojista,
            até ser apagada.
          </p>

          {aviso.trim() === '' ? null : (
            <div className="bg-muted rounded-lg border" aria-label="Prévia do aviso">
              <p className="flex items-start gap-2 px-3 py-2 text-sm">
                <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{aviso.trim().replace(/\s+/g, ' ')}</span>
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">App Storefy Preview</p>
            <p className="text-muted-foreground text-sm">
              Onde o lojista baixa o app que lê o código da prévia. Vazio, a tela diz que o app
              ainda não está disponível, em vez de mostrar um botão que não leva a lugar nenhum.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="previa-no-iphone">Link para iPhone (App Store ou TestFlight)</Label>
            <Input
              id="previa-no-iphone"
              name="previaNoIphone"
              type="url"
              inputMode="url"
              defaultValue={estado.valores?.previaNoIphone ?? previaNoIphone}
              placeholder="https://apps.apple.com/…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="previa-no-android">Link para Android (Google Play)</Label>
            <Input
              id="previa-no-android"
              name="previaNoAndroid"
              type="url"
              inputMode="url"
              defaultValue={estado.valores?.previaNoAndroid ?? previaNoAndroid}
              placeholder="https://play.google.com/…"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">Vídeos do passo a passo (C13)</p>
            <p className="text-muted-foreground text-sm">
              Aparecem na tela de contas Apple e Google, enquanto o lojista ainda não conectou. Link
              do YouTube, do Vimeo ou do Loom; vazio, a tela fica só com os passos escritos.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="video-da-apple">Vídeo: conectar a conta Apple</Label>
            <Input
              id="video-da-apple"
              name="videoDaApple"
              type="url"
              inputMode="url"
              defaultValue={estado.valores?.videoDaApple ?? videoDaApple}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="video-do-google">Vídeo: conectar a conta Google</Label>
            <Input
              id="video-do-google"
              name="videoDoGoogle"
              type="url"
              inputMode="url"
              defaultValue={estado.valores?.videoDoGoogle ?? videoDoGoogle}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </div>
        </div>
      </fieldset>

      {estado.ok !== true && estado.mensagem != null ? (
        <p role="alert" className="text-destructive text-sm">
          {estado.mensagem}
        </p>
      ) : null}

      {podeMudar ? (
        <Button type="submit" disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Salvar chaves
        </Button>
      ) : (
        <p className="text-muted-foreground text-sm">Só superadmin muda estas chaves.</p>
      )}
    </form>
  );
}
