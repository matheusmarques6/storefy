import 'server-only';

/**
 * A leitura das chaves da plataforma no servidor.
 *
 * Pela service role: o cadastro é lido por quem ainda não tem conta, e o
 * painel por lojistas — nenhum dos dois lê `platform_settings` pela RLS, que é
 * só da equipe. O que sai daqui são dois valores públicos por natureza (o
 * cadastro está aberto? há aviso?), nunca a tabela.
 *
 * Falhou a leitura, vale o padrão — e o log diz. O painel de todos os
 * lojistas não pode cair porque esta consulta caiu.
 *
 * `connection()` tira de quem chama isto a geração no build. Sem ela, a tela
 * de cadastro — que não lê cookie nem cabeçalho — saía ESTÁTICA, congelada
 * com as chaves do dia do deploy: a equipe fechava o cadastro na A13 e a tela
 * continuava mostrando o formulário (só a ação recusava, depois de a pessoa
 * preencher tudo). As chaves mudam a qualquer hora; lê-las é sempre na hora.
 */
import { cache } from 'react';
import { connection } from 'next/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  PADRAO,
  lerConfiguracoes,
  type ConfiguracoesDaPlataforma,
} from '@/lib/configuracoes-da-plataforma';

export const configuracoesDaPlataforma = cache(
  async function configuracoesDaPlataforma(): Promise<ConfiguracoesDaPlataforma> {
    await connection();
    try {
      const { data, error } = await criarClientServiceRole()
        .from('platform_settings')
        .select('chave, valor');
      if (error != null) {
        console.error('[plataforma] chaves não lidas, valendo o padrão:', error.message);
        return PADRAO;
      }
      return lerConfiguracoes(data);
    } catch (erro) {
      console.error(
        '[plataforma] chaves não lidas, valendo o padrão:',
        erro instanceof Error ? erro.message : erro,
      );
      return PADRAO;
    }
  },
);
