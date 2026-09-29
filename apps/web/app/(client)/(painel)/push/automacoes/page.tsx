/** Automações de push (C09). */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Smartphone } from 'lucide-react';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { estadoDasNotificacoes } from '@/lib/ativar-push';
import {
  appDaLoja,
  chaveDoWebhook,
  listarAutomacoes,
  resultadoDasAutomacoes,
} from '@/lib/push-servidor';
import { JANELA_DAS_VENDAS_EM_DIAS, vendasVisiveis } from '@/lib/vendas-do-push';
import { urlDoSite } from '@/lib/env';
import { TIPOS_DE_AUTOMACAO } from '@/lib/automacao';
import { EstadoVazio } from '@/components/estado-vazio';
import { Button } from '@/components/ui/button';
import { AbasDoPush } from '../abas';
import { PushNaoConfigurado } from '../nao-configurado';
import { CartaoDaAutomacao } from './cartao';

export const metadata: Metadata = { title: 'Automações' };

export default async function PaginaDeAutomacoes() {
  const { lojaAtiva, papel } = await exigirContextoCliente();

  if (lojaAtiva == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Cadastre uma loja primeiro"
        descricao="As automações são de uma loja. Cadastre a sua para começar."
        acao={
          <Button asChild>
            <Link href="/lojas/nova">Cadastrar loja</Link>
          </Button>
        }
      />
    );
  }

  const supabase = await criarClientServidor();
  const app = await appDaLoja(supabase, lojaAtiva.id);
  if (app == null) {
    return (
      <EstadoVazio
        icone={Smartphone}
        titulo="Não encontramos o app desta loja"
        descricao="Recarregue a página. Se continuar assim, fale com o suporte."
      />
    );
  }

  const [salvas, notificacoes, chave, resultados] = await Promise.all([
    listarAutomacoes(supabase, app.id),
    estadoDasNotificacoes(criarClientServiceRole(), lojaAtiva.id),
    chaveDoWebhook(supabase, app.id),
    resultadoDasAutomacoes(supabase, app.id, JANELA_DAS_VENDAS_EM_DIAS),
  ]);
  const comVendas = vendasVisiveis(lojaAtiva);
  const podeEscrever = papel === 'owner' || papel === 'admin';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notificações</h1>
        <p className="text-muted-foreground text-sm">
          Mensagens que saem sozinhas, no momento certo, sem você precisar lembrar.
        </p>
      </div>

      {notificacoes.ligado ? null : (
        <PushNaoConfigurado pendencias={notificacoes.pendencias} podeEscrever={podeEscrever} />
      )}

      <AbasDoPush atual="automacoes" />

      <div className="grid gap-4">
        {TIPOS_DE_AUTOMACAO.map((tipo) => {
          const salva = salvas.find((automacao) => automacao.type === tipo) ?? null;
          return (
            <CartaoDaAutomacao
              key={tipo}
              tipo={tipo}
              salva={salva}
              resultado={salva === null ? null : (resultados.get(salva.id) ?? null)}
              vendasVisiveis={comVendas}
              urlDaLoja={lojaAtiva.primary_url}
              nomeDoApp={lojaAtiva.name}
              podeEscrever={podeEscrever}
              fuso={lojaAtiva.timezone}
              {...(tipo === 'custom_webhook'
                ? { webhook: { endereco: `${urlDoSite()}/api/webhooks/automacao`, chave } }
                : {})}
            />
          );
        })}
      </div>
    </div>
  );
}
