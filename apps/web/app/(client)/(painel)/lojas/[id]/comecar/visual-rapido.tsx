'use client';

/**
 * C03 — o visual rápido: a cor da marca, o ícone e as abas, com a prévia ao
 * vivo. É o passo 2 do começo de cada loja: o lojista confere o que a
 * detecção achou na página dele e sai daqui com o rascunho do app já com a
 * cara da loja. Tudo muda depois no editor (C06), e nada vai ao ar daqui.
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppConfig } from '@storefy/config-schema';
import { editarTema } from '@/lib/editor-de-config';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { CampoDeCor } from '../../../app/campo-de-cor';
import { CampoDeImagem } from '../../../app/campo-de-imagem';
import { IconeDaAba } from '../../../app/icone-da-aba';
import { Previa, caminhoDaPrevia } from '../../../app/previa';
import { salvarConfig } from '../../../app/acoes';

/** O app precisa de ao menos duas abas: uma só não justificaria a barra. */
const MINIMO_DE_ABAS = 2;

/** O que cada tipo de aba faz, em uma linha. */
const O_QUE_A_ABA_FAZ: Record<AppConfig['tabs'][number]['type'], string> = {
  webview: 'Uma página da sua loja.',
  cart: 'O carrinho, com a quantidade de itens.',
  account: 'A conta do cliente: pedidos, endereços e os ajustes do app.',
  search: 'A busca da loja, com o campo do próprio celular.',
  notifications: 'Os avisos que você mandou para o cliente.',
};

interface Props {
  storeId: string;
  nomeDaLoja: string;
  urlDaLoja: string;
  configInicial: AppConfig;
  /** Link assinado do ícone atual, quando já existe. */
  urlDoIcone: string | null;
  somenteLeitura: boolean;
}

export function VisualRapido({
  storeId,
  nomeDaLoja,
  urlDaLoja,
  configInicial,
  urlDoIcone,
  somenteLeitura,
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState(configInicial);
  const [abaEscolhida, setAbaEscolhida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const proximo = `/lojas/${storeId}/comecar/pronto`;

  /** As abas que o app sugeriu, na ordem dele: ligar de novo põe no mesmo lugar. */
  const sugeridas = configInicial.tabs;
  const ligadas = new Set(config.tabs.map((aba) => aba.id));

  const abaDaPrevia =
    config.tabs.find((aba) => aba.id === abaEscolhida)?.id ?? config.tabs[0]?.id ?? '';
  const caminho = useMemo(() => caminhoDaPrevia(config, abaDaPrevia), [abaDaPrevia, config]);

  function alternarAba(id: string, ligar: boolean) {
    setConfig((atual) => {
      const ids = new Set(atual.tabs.map((aba) => aba.id));
      if (ligar) ids.add(id);
      else ids.delete(id);
      return { ...atual, tabs: sugeridas.filter((aba) => ids.has(aba.id)) };
    });
  }

  function continuar() {
    setErro(null);
    // Sem mudança, não há o que gravar: seguir sem tocar no rascunho.
    if (JSON.stringify(config) === JSON.stringify(configInicial)) {
      router.push(proximo);
      return;
    }
    iniciar(async () => {
      const resultado = await salvarConfig(storeId, config);
      if (resultado.ok !== true) {
        const problemas = (resultado.problemas ?? []).map((problema) => problema.mensagem);
        setErro(
          problemas.length > 0
            ? problemas.join(' ')
            : (resultado.mensagem ?? 'Não foi possível salvar o visual. Tente de novo.'),
        );
        return;
      }
      toast.success('Visual salvo no rascunho do app.');
      router.push(proximo);
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Confira o visual do seu app</h1>
          <p className="text-muted-foreground mt-1 text-sm break-words">
            Loja criada: <span className="text-foreground font-medium">{nomeDaLoja}</span> ·{' '}
            {urlDaLoja}. A cor veio da sua página; ajuste o que quiser — tudo muda depois no editor,
            e nada vai para os clientes antes de você publicar.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cor da marca</CardTitle>
            <CardDescription>Botões, selos e a aba selecionada.</CardDescription>
          </CardHeader>
          <CardContent>
            <CampoDeCor
              id="cor-da-marca"
              rotulo="Cor principal"
              ajuda="A mesma cor pinta a aba aberta na barra de baixo."
              valor={config.theme.primary}
              desabilitado={somenteLeitura || salvando}
              aoMudar={(cor) => {
                setConfig((atual) => editarTema(atual, { primary: cor, tabBarActive: cor }));
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ícone do app</CardTitle>
            <CardDescription>
              Dá para enviar agora ou depois, no editor. Sem ele o app não vai para as lojas de
              aplicativos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CampoDeImagem
              storeId={storeId}
              tipo="icone"
              rotulo="Ícone"
              ajuda="Quadrado, pelo menos 1024×1024, sem fundo transparente e sem cantos arredondados — os dois sistemas arredondam sozinhos."
              urlAtual={urlDoIcone}
              somenteLeitura={somenteLeitura}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abas do app</CardTitle>
            <CardDescription>
              As que sugerimos para começar. Deixe ao menos {String(MINIMO_DE_ABAS)}; nome, ícone e
              ordem mudam no editor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {sugeridas.map((aba) => {
                const ligada = ligadas.has(aba.id);
                const ultimaQueSegura = ligada && ligadas.size <= MINIMO_DE_ABAS;
                return (
                  <li key={aba.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconeDaAba nome={aba.icon} className="text-muted-foreground size-5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{aba.label}</p>
                        <p className="text-muted-foreground text-xs">{O_QUE_A_ABA_FAZ[aba.type]}</p>
                      </div>
                    </div>
                    <Switch
                      checked={ligada}
                      disabled={somenteLeitura || salvando || ultimaQueSegura}
                      aria-label={`${ligada ? 'Tirar' : 'Mostrar'} a aba ${aba.label}`}
                      onCheckedChange={(marcado) => {
                        alternarAba(aba.id, marcado);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {erro === null ? null : (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {somenteLeitura ? (
          <p className="text-muted-foreground text-sm">
            Só proprietários e administradores mudam o visual do app.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {somenteLeitura ? (
            <Button asChild>
              <Link href={proximo}>
                Continuar
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <>
              <Button type="button" disabled={salvando} onClick={continuar}>
                {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Salvar e continuar
                {salvando ? null : <ArrowRight aria-hidden />}
              </Button>
              <Button asChild variant="ghost">
                <Link href={proximo}>Pular por agora</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Previa
          config={config}
          abaAtiva={abaDaPrevia}
          aoTrocarAba={setAbaEscolhida}
          lojaId={storeId}
          caminho={caminho}
          selecionando={false}
          aoEscolherSeletor={() => undefined}
        />
      </div>
    </div>
  );
}
