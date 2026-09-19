'use server';

/**
 * Ações da publicação e das contas de desenvolvedor (C12 e C13).
 *
 * As credenciais da Apple e do Google são o dado mais sensível que um cliente
 * nos entrega: com elas dá para publicar na conta dele. Por isso:
 *
 *   a validação acontece ANTES de gravar, chamando a API de verdade. Um
 *   arquivo que não funciona não tem por que ficar no nosso banco;
 *   a gravação usa a service role, porque as colunas `_enc` são invisíveis
 *   até para o dono — mas a permissão é conferida à mão, aqui, já que a RLS
 *   não vai conferir por ela;
 *   nada é devolvido para a tela além de "deu certo" ou o motivo.
 */
import { revalidatePath } from 'next/cache';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';
import { dadosDaPublicacao } from '@/lib/publicacao-servidor';
import { montarChecklist, pendencias, podePublicar } from '@/lib/checklist-de-publicacao';
import { dispararBuild, faltaConfiguracaoDoDisparo } from '@/lib/disparo-de-build';
import { criptografiaConfigurada } from '@/lib/cripto';
import { pareceChaveP8, validarChaveDaApple } from '@/lib/apple';
import { validarContaDoGoogle } from '@/lib/google';
import {
  desconectar,
  guardarChaveDaApple,
  guardarContaDoGoogle,
  registrarFalha,
  type Plataforma,
} from '@/lib/contas-de-desenvolvedor';

export interface EstadoDaConta {
  ok?: boolean;
  mensagem?: string;
}

/** Só owner e admin mexem nas credenciais da empresa. */
async function exigirPermissao(): Promise<
  { ok: true; orgId: string } | { ok: false; motivo: string }
> {
  const { organizacao, papel } = await exigirContextoCliente();
  if (papel !== 'owner' && papel !== 'admin') {
    return {
      ok: false,
      motivo: 'Apenas proprietários e administradores conectam as contas Apple e Google.',
    };
  }
  if (!criptografiaConfigurada()) {
    return {
      ok: false,
      motivo: 'O servidor ainda não está pronto para guardar credenciais com segurança.',
    };
  }
  return { ok: true, orgId: organizacao.id };
}

/**
 * Põe um build na fila (C12).
 *
 * O checklist é REFEITO aqui, no servidor, com o estado atual do banco. O que
 * a tela sabia pode estar velho — alguém pode ter desconectado a conta Apple
 * entre o carregamento e o clique — e um build que sai sem credencial gasta
 * vinte minutos para falhar.
 */
export async function publicarApp(plataforma: 'ios' | 'android'): Promise<EstadoDaConta> {
  const { lojaAtiva, organizacao, papel, usuario } = await exigirContextoCliente();
  if (lojaAtiva == null) return { mensagem: 'Cadastre uma loja antes de publicar.' };
  if (papel !== 'owner' && papel !== 'admin') {
    return { mensagem: 'Apenas proprietários e administradores publicam o app.' };
  }

  const supabase = await criarClientServidor();
  const dados = await dadosDaPublicacao(supabase, lojaAtiva.id, organizacao.id);
  if (dados == null) return { mensagem: 'Não encontramos o app desta loja.' };

  const itens = montarChecklist(dados.estado);
  if (!podePublicar(itens, plataforma)) {
    const faltando = pendencias(itens, plataforma);
    return {
      mensagem:
        faltando[0]?.comoResolver ??
        'Ainda falta algo para publicar. Confira o checklist e tente de novo.',
    };
  }

  /*
   * Um build por plataforma de cada vez. Dois em paralelo disputam o mesmo
   * número de build na loja de aplicativos, e a Apple recusa o segundo — mas
   * só depois de gerar os dois.
   */
  const servico = criarClientServiceRole();
  const { data: emAndamento } = await servico
    .from('builds')
    .select('id')
    .eq('app_id', dados.appId)
    .eq('platform', plataforma)
    .in('status', ['queued', 'building'])
    .limit(1);

  if ((emAndamento ?? []).length > 0) {
    return {
      mensagem: 'Já existe uma publicação em andamento para esta plataforma. Aguarde ela terminar.',
    };
  }

  const falta = faltaConfiguracaoDoDisparo(
    process.env.GITHUB_DISPATCH_TOKEN,
    process.env.GITHUB_REPO,
  );
  if (falta !== null) return { mensagem: falta };

  const { data: build, error } = await servico
    .from('builds')
    .insert({
      app_id: dados.appId,
      platform: plataforma,
      profile: 'production',
      status: 'queued',
      config_version: dados.estado.versaoPublicada,
      triggered_by: usuario.id,
    })
    .select('id')
    .single();

  // `.single()` já garante a linha quando não há erro: o supabase-js estreita
  // `build` para não-nulo depois desta checagem.
  if (error != null) {
    return { mensagem: 'Não conseguimos registrar a publicação. Tente de novo.' };
  }

  const disparo = await dispararBuild({
    buildId: build.id,
    storeId: lojaAtiva.id,
    appId: dados.appId,
    platform: plataforma,
    configVersion: dados.estado.versaoPublicada ?? 0,
  });

  if (!disparo.ok) {
    /*
     * O disparo falhou, então a linha vira `errored` na hora. Deixá-la em
     * "na fila" mostraria ao lojista uma publicação que ninguém vai processar
     * — e ele esperaria por ela o dia inteiro.
     */
    await servico
      .from('builds')
      .update({ status: 'errored', error: disparo.motivo, finished_at: new Date().toISOString() })
      .eq('id', build.id);

    revalidatePath('/publicacao');
    return { mensagem: disparo.motivo };
  }

  revalidatePath('/publicacao');
  return {
    ok: true,
    mensagem:
      plataforma === 'ios'
        ? 'Publicação na fila. Geramos o binário e enviamos para a Apple — acompanhe aqui.'
        : 'Publicação na fila. Geramos o binário e enviamos para o Google — acompanhe aqui.',
  };
}

export async function conectarApple(entrada: {
  ascP8: string;
  ascKeyId: string;
  ascIssuerId: string;
  teamId: string;
  apnsP8: string;
  apnsKeyId: string;
}): Promise<EstadoDaConta> {
  const permissao = await exigirPermissao();
  if (!permissao.ok) return { mensagem: permissao.motivo };

  if (entrada.teamId.trim() === '') {
    return { mensagem: 'Informe o Team ID, que aparece no topo da sua conta Apple Developer.' };
  }
  /*
   * A chave de APNs é conferida só pelo formato. Não existe chamada barata que
   * prove que ela funciona — a prova é uma notificação chegando, e isso só
   * acontece depois do primeiro build. O formato pelo menos pega o erro
   * comum: enviar o mesmo arquivo nos dois campos.
   */
  if (!pareceChaveP8(entrada.apnsP8)) {
    return { mensagem: 'A chave de notificações (APNs) não parece um arquivo .p8 válido.' };
  }
  if (entrada.apnsKeyId.trim() === '') {
    return { mensagem: 'Informe o Key ID da chave de notificações.' };
  }
  if (entrada.ascP8.trim() === entrada.apnsP8.trim()) {
    return {
      mensagem:
        'Os dois arquivos enviados são iguais. A chave da App Store Connect e a de notificações são diferentes.',
    };
  }

  const servico = criarClientServiceRole();

  const validacao = await validarChaveDaApple({
    p8: entrada.ascP8,
    keyId: entrada.ascKeyId,
    issuerId: entrada.ascIssuerId,
  });

  if (!validacao.ok) {
    await registrarFalha(servico, permissao.orgId, 'apple', validacao.motivo);
    revalidatePath('/publicacao/contas');
    return { mensagem: validacao.motivo };
  }

  const guardado = await guardarChaveDaApple(servico, permissao.orgId, {
    p8: entrada.ascP8,
    keyId: entrada.ascKeyId.trim(),
    issuerId: entrada.ascIssuerId.trim(),
    teamId: entrada.teamId.trim(),
    apnsP8: entrada.apnsP8,
    apnsKeyId: entrada.apnsKeyId.trim(),
  });
  if (!guardado.ok) return { mensagem: 'Não conseguimos guardar a chave. Tente de novo.' };

  revalidatePath('/publicacao/contas');
  revalidatePath('/push');
  return { ok: true, mensagem: 'Conta Apple conectada.' };
}

export async function conectarGoogle(entrada: { arquivo: string }): Promise<EstadoDaConta> {
  const permissao = await exigirPermissao();
  if (!permissao.ok) return { mensagem: permissao.motivo };

  const servico = criarClientServiceRole();
  const validacao = await validarContaDoGoogle(entrada.arquivo);

  if (!validacao.ok) {
    await registrarFalha(servico, permissao.orgId, 'google', validacao.motivo);
    revalidatePath('/publicacao/contas');
    return { mensagem: validacao.motivo };
  }

  const guardado = await guardarContaDoGoogle(servico, permissao.orgId, {
    arquivo: entrada.arquivo,
    email: validacao.email,
  });
  if (!guardado.ok) return { mensagem: 'Não conseguimos guardar o arquivo. Tente de novo.' };

  revalidatePath('/publicacao/contas');
  revalidatePath('/push');
  return { ok: true, mensagem: 'Conta Google conectada.' };
}

export async function desconectarConta(plataforma: Plataforma): Promise<EstadoDaConta> {
  const permissao = await exigirPermissao();
  if (!permissao.ok) return { mensagem: permissao.motivo };

  const resultado = await desconectar(criarClientServiceRole(), permissao.orgId, plataforma);
  if (!resultado.ok) return { mensagem: 'Não conseguimos desconectar. Tente de novo.' };

  revalidatePath('/publicacao/contas');
  revalidatePath('/push');
  return {
    ok: true,
    mensagem:
      plataforma === 'apple'
        ? 'Conta Apple desconectada. Os próximos builds vão falhar até conectar de novo.'
        : 'Conta Google desconectada. Os próximos builds vão falhar até conectar de novo.',
  };
}
