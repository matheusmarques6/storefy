'use server';

/**
 * A13 — gravar as chaves de funcionamento da plataforma.
 *
 * Só superadmin: fechar o cadastro ou falar com todos os lojistas de uma vez
 * é decisão da plataforma, não de atendimento. `support` vê a tela, mas o
 * servidor recusa de novo — a tela esconder o botão não é a autorização.
 *
 * Grava pela SERVICE ROLE (a tabela não tem policy de escrita, de propósito)
 * e AUDITA cada chave que mudou, com o antes e o depois.
 */
import { revalidatePath } from 'next/cache';
import type { Json } from '@storefy/db';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  conferirAviso,
  conferirLinkDaPrevia,
  lerConfiguracoes,
} from '@/lib/configuracoes-da-plataforma';
import { valoresDigitados, type ValoresDigitados } from '@/lib/validacao';
import { log } from '@/lib/log';

export interface EstadoDasChaves {
  ok?: boolean;
  mensagem?: string;
  valores?: ValoresDigitados;
  /** O que foi ENVIADO na caixa do cadastro, para ela não voltar atrás. */
  cadastroAberto?: boolean;
}

export async function salvarChavesDaPlataforma(
  _anterior: EstadoDasChaves,
  dados: FormData,
): Promise<EstadoDasChaves> {
  const { usuario, papel } = await exigirPlatformAdminComPapel();
  // O checkbox só vai no envio quando marcado: ausência é "fechado".
  const cadastroAberto = dados.get('cadastroAberto') === 'on';
  const valores = valoresDigitados(dados, ['aviso', 'previaNoIphone', 'previaNoAndroid']);

  if (papel !== 'superadmin') {
    return { mensagem: 'Só superadmin muda as chaves da plataforma.', valores, cadastroAberto };
  }

  const texto = (campo: string): string => {
    const valor = dados.get(campo);
    return typeof valor === 'string' ? valor : '';
  };
  const aviso = conferirAviso(texto('aviso'));
  if (!aviso.ok) return { mensagem: aviso.mensagem, valores, cadastroAberto };
  const previaNoIphone = conferirLinkDaPrevia(texto('previaNoIphone'), 'iphone');
  if (!previaNoIphone.ok) return { mensagem: previaNoIphone.mensagem, valores, cadastroAberto };
  const previaNoAndroid = conferirLinkDaPrevia(texto('previaNoAndroid'), 'android');
  if (!previaNoAndroid.ok) return { mensagem: previaNoAndroid.mensagem, valores, cadastroAberto };

  const servico = criarClientServiceRole();
  const { data: linhas, error: erroDeLeitura } = await servico
    .from('platform_settings')
    .select('chave, valor');
  if (erroDeLeitura != null) {
    return {
      mensagem: 'Não conseguimos ler as chaves atuais. Tente de novo.',
      valores,
      cadastroAberto,
    };
  }
  const antes = lerConfiguracoes(linhas);

  const mudancas: { chave: string; de: Json; para: Json }[] = [];
  if (antes.cadastroAberto !== cadastroAberto) {
    mudancas.push({ chave: 'cadastro_aberto', de: antes.cadastroAberto, para: cadastroAberto });
  }
  if (antes.avisoNoPainel !== aviso.aviso) {
    mudancas.push({ chave: 'aviso_no_painel', de: antes.avisoNoPainel, para: aviso.aviso });
  }
  if (antes.previaNoIphone !== previaNoIphone.link) {
    mudancas.push({
      chave: 'previa_no_iphone',
      de: antes.previaNoIphone,
      para: previaNoIphone.link,
    });
  }
  if (antes.previaNoAndroid !== previaNoAndroid.link) {
    mudancas.push({
      chave: 'previa_no_android',
      de: antes.previaNoAndroid,
      para: previaNoAndroid.link,
    });
  }
  if (mudancas.length === 0) return { ok: true, mensagem: 'Nada mudou.', valores, cadastroAberto };

  const { error } = await servico.from('platform_settings').upsert(
    mudancas.map((mudanca) => ({
      chave: mudanca.chave,
      valor: mudanca.para,
      updated_by: usuario.id,
    })),
    { onConflict: 'chave' },
  );
  if (error != null) {
    return { mensagem: 'Não conseguimos salvar. Tente de novo.', valores, cadastroAberto };
  }

  const { error: erroDaTrilha } = await servico.from('audit_logs').insert(
    mudancas.map((mudanca) => ({
      actor_id: usuario.id,
      org_id: null,
      action: 'update' as const,
      entity: 'platform_settings',
      entity_id: null,
      diff: { [mudanca.chave]: { de: mudanca.de, para: mudanca.para } },
    })),
  );
  if (erroDaTrilha != null) {
    log.erro('plataforma.mudanca-sem-auditoria', { falha: erroDaTrilha });
  }

  // O aviso aparece em toda tela do painel, o cadastro na tela dele, e os
  // links do Storefy Preview no editor e no começo de cada loja.
  revalidatePath('/', 'layout');
  return { ok: true, mensagem: 'Chaves salvas.', valores, cadastroAberto };
}
