/**
 * A13 — Configurações do sistema.
 *
 * NASCEU DE UM PREJUÍZO. `NEXT_PUBLIC_SITE_URL` foi colada sem o `https://`, e
 * o efeito não foi um erro na tela: foi o OAuth da Shopify recusando o retorno
 * e os webhooks sendo registrados errado em silêncio — a loja conectava e
 * nenhum pedido chegava. O que faltava era poder olhar numa tela e ver o
 * estado de cada integração.
 *
 * SÓ BOOLEANOS SAEM DAQUI. Saber que uma chave falta não ajuda um atacante;
 * saber qual é o valor dela, sim. A tela diz o NOME do que falta e o que
 * quebra sem aquilo — que é o que faz alguém agir.
 *
 * As essenciais vêm primeiro e separadas: a diferença entre "o produto não
 * sobe" e "um recurso está indisponível" é a diferença entre largar tudo e
 * anotar para depois.
 */
import type { Metadata } from 'next';
import { CheckCircle2, CircleSlash, MinusCircle, Settings, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { configuracoesDaPlataforma } from '@/lib/configuracoes-da-plataforma-servidor';
import { versaoDoNumero } from '@/lib/atualizacao-obrigatoria';
import { ChavesDaPlataforma } from './chaves-da-plataforma';
import { conferir, resumo, variaveisCobertas } from '@/lib/configuracoes-sistema';
import type { IntegracaoConferida } from '@/lib/configuracoes-sistema';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sistema · Admin' };

// Sempre dinâmica: o valor tem que refletir o ambiente AGORA. Uma página
// estática mostraria a configuração de quando o build rodou, que é
// exatamente a informação errada numa tela de diagnóstico.
export const dynamic = 'force-dynamic';

export default async function PaginaSistema() {
  const { papel } = await exigirPlatformAdminComPapel();

  /*
   * A leitura é literal, uma variável por vez, e não por índice: o Next
   * substitui `process.env.NEXT_PUBLIC_*` no bundle em tempo de build, e o
   * acesso dinâmico devolveria undefined para todas elas.
   */
  const presentes: Record<string, boolean> = {
    NEXT_PUBLIC_SUPABASE_URL: temValor(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: temValor(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: temValor(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ENCRYPTION_KEY: temValor(process.env.ENCRYPTION_KEY),
    NEXT_PUBLIC_SITE_URL: temValor(process.env.NEXT_PUBLIC_SITE_URL),
    SHOPIFY_API_KEY: temValor(process.env.SHOPIFY_API_KEY),
    SHOPIFY_API_SECRET: temValor(process.env.SHOPIFY_API_SECRET),
    SHOPIFY_SCOPES: temValor(process.env.SHOPIFY_SCOPES),
    ONESIGNAL_ORG_API_KEY: temValor(process.env.ONESIGNAL_ORG_API_KEY),
    GITHUB_DISPATCH_TOKEN: temValor(process.env.GITHUB_DISPATCH_TOKEN),
    GITHUB_REPO: temValor(process.env.GITHUB_REPO),
    BUILD_API_SECRET: temValor(process.env.BUILD_API_SECRET),
    EAS_WEBHOOK_SECRET: temValor(process.env.EAS_WEBHOOK_SECRET),
    CRON_SECRET: temValor(process.env.CRON_SECRET),
    RESEND_API_KEY: temValor(process.env.RESEND_API_KEY),
    EMAIL_REMETENTE: temValor(process.env.EMAIL_REMETENTE),
    NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: temValor(process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED),
    NEXT_PUBLIC_CLIENT_HOST: temValor(process.env.NEXT_PUBLIC_CLIENT_HOST),
    NEXT_PUBLIC_ADMIN_HOST: temValor(process.env.NEXT_PUBLIC_ADMIN_HOST),
  };

  const supabase = await criarClientServidor();
  const [chaves, { data: publicadas, error: erroDasPublicadas }] = await Promise.all([
    configuracoesDaPlataforma(),
    /*
     * As configs no ar, para achar os apps que exigem atualização. O filtro
     * pelo número sai em código: o valor mora dentro do JSON, e a lista de
     * apps publicados é pequena perto do que custaria um índice só para isto.
     */
    supabase
      .from('app_configs')
      .select('app_id, minimo:config->minSupportedBuild, apps(display_name, stores(name, org_id))')
      .eq('status', 'published'),
  ]);
  if (erroDasPublicadas != null) {
    throw new Error(
      `Não foi possível carregar as configs publicadas: ${erroDasPublicadas.message}`,
    );
  }
  const exigindo = publicadas
    .map((linha) => ({ ...linha, minimo: Number(linha.minimo) }))
    .filter((linha) => Number.isFinite(linha.minimo) && linha.minimo > 1);

  const conferidas = conferir(presentes);
  const r = resumo(conferidas);
  const essenciais = conferidas.filter((i) => i.nivel === 'essencial');
  const porRecurso = conferidas.filter((i) => i.nivel === 'recurso');
  const opcionais = conferidas.filter((i) => i.nivel === 'opcional');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sistema</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          O que vale para todos os lojistas e o que este deploy tem configurado. Das variáveis de
          ambiente, só o nome aparece aqui, nunca o valor.
        </p>
      </div>

      {r.essenciaisFaltando > 0 ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 py-4 text-sm">
            <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <strong>
                {r.essenciaisFaltando === 1
                  ? 'Falta uma configuração essencial.'
                  : `Faltam ${String(r.essenciaisFaltando)} configurações essenciais.`}
              </strong>{' '}
              Enquanto for assim, o painel não funciona por inteiro para ninguém.
            </span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
            <CheckCircle2 className="text-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              As configurações essenciais estão no lugar. {r.completas} de {r.total} integrações
              necessárias completas
              {opcionais.length === 0
                ? '.'
                : `, e ${String(r.opcionaisEmUso)} de ${String(opcionais.length)} opcionais em uso.`}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chaves de funcionamento</CardTitle>
          <CardDescription>
            O que a Storefy liga e desliga para todos os lojistas de uma vez. Cada mudança fica na
            auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChavesDaPlataforma
            cadastroAberto={chaves.cadastroAberto}
            avisoNoPainel={chaves.avisoNoPainel}
            podeMudar={papel === 'superadmin'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Versão mínima dos apps</CardTitle>
          <CardDescription>
            Cada loja decide no próprio editor (Recursos › Atualização obrigatória) se obriga os
            clientes a atualizar, e só pode exigir uma versão já aprovada nas duas lojas de
            aplicativos. Aqui ficam os apps que estão exigindo agora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exigindo.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum app está exigindo atualização. Todo cliente usa a versão que tiver.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {exigindo.map((linha) => (
                <li
                  key={linha.app_id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <Link
                    href={`/admin/organizacoes/${linha.apps.stores.org_id}`}
                    className="font-medium hover:underline"
                  >
                    {linha.apps.stores.name}
                    <span className="text-muted-foreground ml-2 font-normal">
                      {linha.apps.display_name}
                    </span>
                  </Link>
                  <Badge variant="outline">Exige {versaoDoNumero(linha.minimo)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Secao titulo="Essenciais" descricao="Sem estas, o painel não funciona." itens={essenciais} />
      <Secao
        titulo="Por recurso"
        descricao="Cada uma liga uma parte do produto. Faltando, só aquela parte fica indisponível."
        itens={porRecurso}
      />
      <Secao
        titulo="Opcionais"
        descricao="Nada deixa de funcionar sem elas. Ligue quando quiser o que cada uma oferece."
        itens={opcionais}
      />

      {/*
       * O que NÃO está nesta tela, dito de propósito: variáveis que o
       * workflow de build usa e a aplicação web não lê. Omiti-las faria
       * alguém procurar aqui por uma chave que nunca vai aparecer.
       */}
      <Card>
        <CardContent className="text-muted-foreground flex items-start gap-2 py-4 text-sm">
          <Settings className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Esta tela cobre as {variaveisCobertas().length} variáveis que a aplicação web lê.{' '}
            <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">EXPO_TOKEN</code>
            ,{' '}
            <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">EXPO_OWNER</code>{' '}
            e{' '}
            <code className="bg-muted text-foreground rounded px-1 py-0.5 text-xs">
              STOREFY_API_URL
            </code>{' '}
            são do workflow que gera os apps, e ficam nos segredos do repositório — não aqui.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function temValor(variavel: string | undefined): boolean {
  return variavel != null && variavel !== '';
}

function Secao({
  titulo,
  descricao,
  itens,
}: {
  titulo: string;
  descricao: string;
  itens: IntegracaoConferida[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{titulo}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{descricao}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {itens.map((item) => (
          <Card key={item.chave}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{item.nome}</CardTitle>
                <Situacao item={item} />
              </div>
              <CardDescription>{item.oQueQuebra}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="flex flex-wrap gap-1">
                {item.variaveis.map((nome) => {
                  // Opcional desligada não "falta": a chave fica neutra, sem
                  // o tracejado vermelho de quem precisa de conserto.
                  const falta = item.nivel !== 'opcional' && item.faltando.includes(nome);
                  return (
                    <li
                      key={nome}
                      className={
                        falta
                          ? 'border-destructive/40 text-destructive rounded border border-dashed px-1.5 py-0.5 font-mono text-xs'
                          : 'bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs'
                      }
                    >
                      {nome}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** O selo de cada integração: configurada, faltando, ou — se opcional — não usada. */
function Situacao({ item }: { item: IntegracaoConferida }) {
  if (item.completa) {
    return (
      <Badge variant="secondary" className="shrink-0 gap-1">
        <CheckCircle2 className="size-3" aria-hidden />
        Configurada
      </Badge>
    );
  }

  if (item.nivel === 'opcional') {
    return (
      <Badge variant="outline" className="text-muted-foreground shrink-0 gap-1">
        <MinusCircle className="size-3" aria-hidden />
        Não usado
      </Badge>
    );
  }

  return (
    <Badge
      variant={item.nivel === 'essencial' ? 'destructive' : 'outline'}
      className="shrink-0 gap-1"
    >
      <CircleSlash className="size-3" aria-hidden />
      Faltando
    </Badge>
  );
}
