/**
 * A política de privacidade pública de uma loja (seção 7 do plano).
 *
 * A Apple e o Google EXIGEM uma URL pública de política de privacidade para
 * publicar, e o revisor abre este endereço. Por isso ela é uma página de
 * servidor sem login, fora do painel e fora do `proxy`: um revisor da Apple
 * que caísse na tela de entrar recusaria o app.
 *
 * Só três campos da loja chegam aqui — nome, endereço e contato —, e todos
 * são públicos por natureza: os dois primeiros estão na vitrine dela, e o
 * terceiro é o atendimento que ela mesma divulga.
 *
 * Sem `loading.tsx` de propósito: com ele a resposta começaria antes da
 * busca, e a loja que não existe sairia como 200, não como 404. A busca é uma
 * linha só; o documento chega inteiro.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { safeParseAppConfig } from '@storefy/config-schema';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { serviceRoleConfigurada, supabaseConfigurado } from '@/lib/env';
import { montarPolitica } from '@/lib/politica-de-privacidade';
import { lido } from '@/lib/leitura';

export const dynamic = 'force-dynamic';

/** Uma hora de cache na borda: o texto muda quando a loja muda, e isso é raro. */
export const revalidate = 3600;

interface Loja {
  name: string;
  primary_url: string;
  support_email: string | null;
  updated_at: string;
  pushLigado: boolean;
  eventosDeCarrinho: boolean;
  protecaoDaConta: boolean;
}

async function buscarLoja(id: string): Promise<Loja | null> {
  if (!supabaseConfigurado || !serviceRoleConfigurada) return null;
  // Um id que não é uuid vira 404 sem ir ao banco: o Postgres estouraria.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  const servico = criarClientServiceRole();

  // Erro de leitura é página de erro, e não "política não encontrada": o
  // revisor da Apple que visse um 404 recusaria o app.
  const { data: loja } = lido(
    await servico
      .from('stores')
      .select('name, primary_url, support_email, updated_at')
      .eq('id', id)
      .maybeSingle(),
    'a loja',
  );
  if (loja == null) return null;

  /*
   * O push só entra na política quando a loja REALMENTE o tem ligado. Uma
   * política que descreve notificações num app que não notifica é uma mentira
   * que o revisor às vezes pega; uma que as omite num app que notifica é um
   * problema jurídico do lojista.
   */
  const { data: app } = lido(
    await servico.from('apps').select('id, onesignal_app_id').eq('store_id', id).maybeSingle(),
    'o app da loja',
  );

  /*
   * Sem o segredo do aparelho o app não consegue assinar o que manda, então
   * não há evento de carrinho nenhum chegando. Pergunta-se SE ele existe, sem
   * trazê-lo: esta página é pública, e o valor cifrado não tem o que fazer
   * aqui.
   */
  const { count: comSegredo } =
    app == null
      ? { count: 0 }
      : lido(
          await servico
            .from('apps')
            .select('id', { count: 'exact', head: true })
            .eq('id', app.id)
            .not('device_secret_enc', 'is', null)
            .neq('device_secret_enc', ''),
          'o segredo do app',
        );

  /*
   * O Face ID é da config NO AR — a que está nos celulares. Um rascunho com o
   * recurso ligado ainda não protege conta de ninguém.
   */
  const { data: publicada } =
    app == null
      ? { data: null }
      : lido(
          await servico
            .from('app_configs')
            .select('config, published_at')
            .eq('app_id', app.id)
            .eq('status', 'published')
            .maybeSingle(),
          'a configuração no ar',
        );
  const lida = publicada == null ? null : safeParseAppConfig(publicada.config);
  const config = lida?.success === true ? lida.data : null;

  return {
    ...loja,
    // O texto muda também quando a config no ar muda (o Face ID vem dela).
    updated_at: maisRecente(loja.updated_at, publicada?.published_at ?? null),
    protecaoDaConta:
      config !== null &&
      config.features.biometricLogin &&
      config.tabs.some((aba) => aba.type === 'account'),
    pushLigado: app?.onesignal_app_id != null && app.onesignal_app_id !== '',
    eventosDeCarrinho: (comSegredo ?? 0) > 0,
  };
}

/** A mais recente de duas datas ISO; a inválida não conta. */
function maisRecente(uma: string, outra: string | null): string {
  if (outra === null || Number.isNaN(Date.parse(outra))) return uma;
  if (Number.isNaN(Date.parse(uma))) return outra;
  return Date.parse(outra) > Date.parse(uma) ? outra : uma;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ loja: string }>;
}): Promise<Metadata> {
  const { loja: id } = await params;
  const loja = await buscarLoja(id);

  return {
    title: loja === null ? 'Política de Privacidade' : `Política de Privacidade — ${loja.name}`,
    // Fora do índice de propósito: a política de um cliente não é conteúdo
    // nosso, e não tem por que competir com a loja dele na busca.
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDaPolitica({ params }: { params: Promise<{ loja: string }> }) {
  const { loja: id } = await params;
  const loja = await buscarLoja(id);
  if (loja === null) notFound();

  const politica = montarPolitica({
    nomeDaLoja: loja.name,
    urlDaLoja: loja.primary_url,
    emailDeContato: loja.support_email,
    pushLigado: loja.pushLigado,
    eventosDeCarrinho: loja.eventosDeCarrinho,
    protecaoDaConta: loja.protecaoDaConta,
    atualizadaEm: loja.updated_at,
  });

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-balance">{politica.titulo}</h1>
      {politica.atualizadaEm === '' ? null : (
        <p className="text-muted-foreground mt-2 text-sm">Atualizada em {politica.atualizadaEm}</p>
      )}

      <div className="mt-10 space-y-8">
        {politica.secoes.map((secao) => (
          <section key={secao.titulo} className="space-y-2">
            <h2 className="text-base font-semibold">{secao.titulo}</h2>
            {secao.paragrafos.map((paragrafo) => (
              <p key={paragrafo} className="text-muted-foreground text-sm leading-relaxed">
                {paragrafo}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p className="text-muted-foreground mt-12 border-t pt-6 text-xs">App feito com a Storefy.</p>
    </main>
  );
}
