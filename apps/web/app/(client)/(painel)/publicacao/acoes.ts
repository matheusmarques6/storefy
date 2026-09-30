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
import { FALHA_GENERICA, mensagemDaFalha } from '@/lib/erros';
import { buildParado } from '@/lib/builds-admin';
import { log } from '@/lib/log';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import { criarClientServidor } from '@/lib/supabase/server';
import { dadosDaPublicacao } from '@/lib/publicacao-servidor';
import { montarChecklist, pendencias, podePublicar } from '@/lib/checklist-de-publicacao';
import { dispararBuild, faltaConfiguracaoDoDisparo } from '@/lib/disparo-de-build';
import { criptografiaConfigurada } from '@/lib/cripto';
import {
  pareceChaveP8,
  procurarAppNaApple,
  registrarIdentificadorNaApple,
  validarChaveDaApple,
} from '@/lib/apple';
import { validarContaDoGoogle } from '@/lib/google';
import {
  chaveDaAppleDaOrganizacao,
  desconectar,
  guardarChaveDaApple,
  guardarContaDoGoogle,
  registrarFalha,
  type Plataforma,
} from '@/lib/contas-de-desenvolvedor';
import { appIdDaApple, lerImpressaoDigital, situacaoDosLinks } from '@/lib/links-do-app';
import { normalizarIdentificador, problemaDoIdentificador } from '@/lib/identificador-do-app';
import { tokenDaLoja } from '@/lib/shopify-conexao';
import { vincularAppNoDominio } from '@/lib/shopify-servidor';

export interface EstadoDaConta {
  ok?: boolean;
  mensagem?: string;
}

/** Só owner e admin mexem nas credenciais da empresa. */
async function exigirPermissao(): Promise<
  { ok: true; orgId: string; usuarioId: string } | { ok: false; motivo: string }
> {
  const { organizacao, papel, usuario } = await exigirContextoCliente();
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
  return { ok: true, orgId: organizacao.id, usuarioId: usuario.id };
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
  // Em nome de quem pediu: a trilha do build diz quem publicou.
  const servico = criarClientServiceRole({ ator: usuario.id });
  // Com o banco fora, seguir poderia disparar um segundo build da mesma versão.
  const { data: emAndamento, error: erroDoAndamento } = await servico
    .from('builds')
    .select('id, status, created_at, started_at')
    .eq('app_id', dados.appId)
    .eq('platform', plataforma)
    .in('status', ['queued', 'building'])
    .limit(1);

  if (erroDoAndamento != null) {
    return { mensagem: mensagemDaFalha('publicacao', erroDoAndamento, FALHA_GENERICA) };
  }
  const andamento = emAndamento[0];
  if (andamento !== undefined) {
    // "Aguarde" dito de um build parado há horas deixaria o lojista esperando por nada.
    const parado = buildParado({
      status: andamento.status,
      criadoEm: andamento.created_at,
      iniciadoEm: andamento.started_at,
    });
    return {
      mensagem: parado
        ? 'A publicação anterior desta plataforma parou no meio. Fale com o suporte pela Ajuda: a equipe confere e libera para você publicar de novo.'
        : 'Já existe uma publicação em andamento para esta plataforma. Aguarde ela terminar.',
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
  // `build` para não-nulo depois desta checagem. A recusa do banco que fala
  // com o lojista (a assinatura fora de dia, por exemplo) atravessa inteira.
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'publicacao',
        error,
        'Não conseguimos registrar a publicação. Tente de novo.',
      ),
    };
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
    const { error: erroDaMarca } = await servico
      .from('builds')
      .update({ status: 'errored', error: disparo.motivo, finished_at: new Date().toISOString() })
      .eq('id', build.id);

    revalidatePath('/publicacao');
    if (erroDaMarca != null) {
      // Sem a marca, a publicação fica "na fila" e trava a próxima tentativa.
      log.erro('publicacao.erro-nao-marcado', { build: build.id, falha: erroDaMarca });
      return {
        mensagem: `${disparo.motivo} A publicação ficou presa na fila: fale com o suporte pela Ajuda para liberá-la.`,
      };
    }
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

// ------------------------------------------- o identificador do app (C12)

export interface EstadoDoIdentificador {
  ok?: boolean;
  mensagem?: string;
  /** Deu certo, mas um passo seguinte (o registro na Apple) não: vai num aviso à parte. */
  aviso?: string;
}

/**
 * O app da loja ativa, para as ações do identificador. Lido pela SESSÃO: é a
 * RLS que decide se esta pessoa enxerga esta loja.
 */
async function appParaIdentidade(): Promise<
  | {
      ok: true;
      app: {
        id: string;
        display_name: string;
        bundle_id_ios: string | null;
        ios_asc_app_id: string | null;
      };
      orgId: string;
      usuarioId: string;
    }
  | { ok: false; motivo: string }
> {
  const { lojaAtiva, organizacao, papel, usuario } = await exigirContextoCliente();
  if (lojaAtiva == null) return { ok: false, motivo: 'Cadastre uma loja primeiro.' };
  if (papel !== 'owner' && papel !== 'admin') {
    return {
      ok: false,
      motivo: 'Apenas proprietários e administradores cuidam do identificador do app.',
    };
  }

  const supabase = await criarClientServidor();
  const { data: app, error } = await supabase
    .from('apps')
    .select('id, display_name, bundle_id_ios, ios_asc_app_id')
    .eq('store_id', lojaAtiva.id)
    .maybeSingle();
  if (error != null) {
    return {
      ok: false,
      motivo: mensagemDaFalha(
        'publicacao',
        error,
        'Não conseguimos ler o app agora. Tente de novo.',
      ),
    };
  }
  if (app == null) return { ok: false, motivo: 'Não encontramos o app desta loja.' };
  return { ok: true, app, orgId: organizacao.id, usuarioId: usuario.id };
}

/**
 * Define o identificador do app nas duas lojas (C12, "preenchemos para você").
 *
 * Com a conta Apple conectada, o identificador segue na hora para ela: é o que
 * o faz aparecer na lista "ID do pacote" quando o lojista cria o app no App
 * Store Connect. Se esse registro falhar, o identificador fica salvo e a tela
 * diz o motivo — o botão "Registrar na Apple" tenta de novo.
 */
export async function definirIdentificador(texto: string): Promise<EstadoDoIdentificador> {
  const problema = problemaDoIdentificador(texto);
  if (problema !== null) return { mensagem: problema };
  const identificador = normalizarIdentificador(texto);

  const base = await appParaIdentidade();
  if (!base.ok) return { mensagem: base.motivo };
  if (base.app.bundle_id_ios === identificador) {
    return { ok: true, mensagem: 'Esse já é o identificador do app.' };
  }

  const servico = criarClientServiceRole();
  const { error } = await servico.rpc('definir_identificador_do_app', {
    p_app_id: base.app.id,
    p_ator: base.usuarioId,
    p_identificador: identificador,
  });
  if (error != null) {
    // O índice único do banco: outro app da Storefy já usa esse identificador.
    if (error.code === '23505') {
      return { mensagem: 'Esse identificador já é de outro app da Storefy. Escolha outro.' };
    }
    return {
      mensagem: mensagemDaFalha(
        'publicacao',
        error,
        'Não conseguimos salvar o identificador. Tente de novo.',
      ),
    };
  }
  revalidatePath('/publicacao');

  const chave = await chaveDaAppleDaOrganizacao(servico, base.orgId);
  if (!chave.ok) return { ok: true, mensagem: 'Identificador salvo.' };

  const registro = await registrarIdentificadorNaApple(
    chave.chave,
    identificador,
    base.app.display_name,
  );
  return registro.ok
    ? { ok: true, mensagem: 'Identificador salvo e registrado na sua conta Apple.' }
    : {
        ok: true,
        mensagem: 'Identificador salvo.',
        aviso: `Ainda não está registrado na sua conta Apple: ${registro.motivo}`,
      };
}

/** Registra (de novo) o identificador na conta Apple — o botão do passo 1. */
export async function registrarNaApple(): Promise<EstadoDoIdentificador> {
  const base = await appParaIdentidade();
  if (!base.ok) return { mensagem: base.motivo };
  if (base.app.bundle_id_ios === null)
    return { mensagem: 'Defina o identificador do app primeiro.' };

  const chave = await chaveDaAppleDaOrganizacao(criarClientServiceRole(), base.orgId);
  if (!chave.ok) return { mensagem: chave.motivo };

  const registro = await registrarIdentificadorNaApple(
    chave.chave,
    base.app.bundle_id_ios,
    base.app.display_name,
  );
  if (!registro.ok) return { mensagem: registro.motivo };
  return {
    ok: true,
    mensagem: registro.jaExistia
      ? 'O identificador já estava registrado na sua conta Apple. Siga para criar o app.'
      : 'Identificador registrado na sua conta Apple. Siga para criar o app.',
  };
}

/**
 * "Já criei o app": procura, na conta Apple do lojista, o app com este
 * identificador, e guarda o número dele. É o que libera o envio à App Store.
 */
export async function conferirAppNaApple(): Promise<EstadoDoIdentificador> {
  const base = await appParaIdentidade();
  if (!base.ok) return { mensagem: base.motivo };
  const identificador = base.app.bundle_id_ios;
  if (identificador === null) return { mensagem: 'Defina o identificador do app primeiro.' };
  if (base.app.ios_asc_app_id !== null) {
    return { ok: true, mensagem: 'O app já está ligado ao App Store Connect.' };
  }

  const servico = criarClientServiceRole();
  const chave = await chaveDaAppleDaOrganizacao(servico, base.orgId);
  if (!chave.ok) return { mensagem: chave.motivo };

  const busca = await procurarAppNaApple(chave.chave, identificador);
  if (!busca.ok) return { mensagem: busca.motivo };
  if (busca.app === null) {
    return {
      mensagem: `Ainda não encontramos, na sua conta Apple, um app com o identificador ${identificador}. Confira se ele foi escolhido em "ID do pacote" ao criar o app — e se o app foi criado na mesma conta que está conectada.`,
    };
  }

  const { error } = await servico.rpc('registrar_app_na_apple', {
    p_app_id: base.app.id,
    p_ator: base.usuarioId,
    p_asc_app_id: busca.app.id,
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'publicacao',
        error,
        'Achamos o app, mas não conseguimos guardar. Tente de novo.',
      ),
    };
  }

  revalidatePath('/publicacao');
  return { ok: true, mensagem: `Encontramos o app na sua conta Apple (número ${busca.app.id}).` };
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

  const servico = criarClientServiceRole({ ator: permissao.usuarioId });

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

  /*
   * Com o identificador já definido e o app ainda não criado na Apple, ele
   * segue para a conta recém-conectada — é o que o faz aparecer na lista ao
   * criar o app no App Store Connect. Falhar aqui não desfaz a conexão: a
   * Publicação mostra o passo e o botão para tentar de novo.
   */
  const { lojaAtiva } = await exigirContextoCliente();
  if (lojaAtiva != null) {
    const { data: app, error } = await servico
      .from('apps')
      .select('display_name, bundle_id_ios, ios_asc_app_id')
      .eq('store_id', lojaAtiva.id)
      .maybeSingle();
    // A conexão já deu certo; sem conseguir ler o app, o registro fica para o botão da Publicação.
    if (error != null) log.erro('publicacao.ler-app-ao-conectar', { texto: error.message });
    if (error == null && app?.bundle_id_ios != null && app.ios_asc_app_id == null) {
      const registro = await registrarIdentificadorNaApple(
        { p8: entrada.ascP8, keyId: entrada.ascKeyId.trim(), issuerId: entrada.ascIssuerId.trim() },
        app.bundle_id_ios,
        app.display_name,
      );
      revalidatePath('/publicacao');
      return {
        ok: true,
        mensagem: registro.ok
          ? 'Conta Apple conectada, e o identificador do app já foi registrado nela.'
          : `Conta Apple conectada. O identificador do app ainda não foi registrado nela: ${registro.motivo}`,
      };
    }
  }
  return { ok: true, mensagem: 'Conta Apple conectada.' };
}

export async function conectarGoogle(entrada: { arquivo: string }): Promise<EstadoDaConta> {
  const permissao = await exigirPermissao();
  if (!permissao.ok) return { mensagem: permissao.motivo };

  const servico = criarClientServiceRole({ ator: permissao.usuarioId });
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

  const resultado = await desconectar(
    criarClientServiceRole({ ator: permissao.usuarioId }),
    permissao.orgId,
    plataforma,
  );
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

// ------------------------------------------ links da loja no app (C12)

export interface EstadoDosLinks {
  ok?: boolean;
  mensagem?: string;
}

/** Tentativas de vincular por loja, por hora: cada uma fala com a Shopify. */
const VINCULOS_POR_HORA = 10;

const SO_QUEM_EDITA = 'Apenas proprietários e administradores mudam os links do app.';

async function quemEditaOsLinks() {
  const contexto = await exigirContextoCliente();
  if (contexto.visita != null) {
    return { ok: false as const, mensagem: 'Durante a visita ao painel de um cliente, nada muda.' };
  }
  if (contexto.lojaAtiva == null) {
    return { ok: false as const, mensagem: 'Cadastre uma loja primeiro.' };
  }
  if (contexto.papel !== 'owner' && contexto.papel !== 'admin') {
    return { ok: false as const, mensagem: SO_QUEM_EDITA };
  }
  return { ok: true as const, ...contexto, lojaAtiva: contexto.lojaAtiva };
}

/**
 * A impressão digital do certificado do Android, colada do Play Console.
 *
 * Uma por linha, até cinco (a da chave de assinatura do app e a da chave de
 * upload, para os testes internos). Em branco, remove. Trocar desfaz o vínculo
 * do Android no banco — o que está publicado é a impressão antiga.
 */
export async function salvarImpressoesDoAndroid(texto: string): Promise<EstadoDosLinks> {
  const quem = await quemEditaOsLinks();
  if (!quem.ok) return { mensagem: quem.mensagem };

  const linhas = texto
    .split(/[\n,;]+/)
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '');
  if (linhas.length > 5) return { mensagem: 'Cole no máximo 5 impressões digitais.' };

  const lidas: string[] = [];
  for (const linha of linhas) {
    const impressao = lerImpressaoDigital(linha);
    if (impressao === null) {
      return {
        mensagem:
          'Isso não parece a impressão digital SHA-256 do Play Console: são 32 pares de letras e números, separados por dois-pontos.',
      };
    }
    if (!lidas.includes(impressao)) lidas.push(impressao);
  }

  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('apps')
    .update({ android_cert_fingerprints: lidas })
    .eq('store_id', quem.lojaAtiva.id)
    .select('id');

  if (error != null) {
    return {
      mensagem: mensagemDaFalha('publicacao', error, 'Não conseguimos salvar. Tente de novo.'),
    };
  }
  if (data.length === 0) return { mensagem: 'Não encontramos o app desta loja.' };

  revalidatePath('/publicacao');
  return {
    ok: true,
    mensagem: lidas.length === 0 ? 'Impressão digital removida.' : 'Impressão digital salva.',
  };
}

/**
 * Pede à Shopify para publicar, no domínio da loja, que o app abre os links
 * dela (Universal Links e App Links).
 *
 * A situação é REFEITA aqui, com o banco de agora: o que a tela sabia pode
 * estar velho. O resultado é gravado pelo servidor, com quem pediu na trilha.
 */
export async function vincularLinksDaLoja(): Promise<EstadoDosLinks> {
  const quem = await quemEditaOsLinks();
  if (!quem.ok) return { mensagem: quem.mensagem };

  const supabase = await criarClientServidor();
  const dados = await dadosDaPublicacao(supabase, quem.lojaAtiva.id, quem.organizacao.id);
  if (dados == null) return { mensagem: 'Não encontramos o app desta loja.' };

  const situacao = situacaoDosLinks(dados.links);
  if (situacao.bloqueio !== null) return { mensagem: situacao.bloqueio.motivo };
  if (!situacao.podeVincular) {
    return { mensagem: 'Ainda falta o que publicar. Veja o que falta em cada plataforma.' };
  }

  const servico = criarClientServiceRole();
  const { data: dentro, error: erroDoLimite } = await servico.rpc('consumir_limite', {
    p_chave: `links:${quem.lojaAtiva.id}`,
    p_maximo: VINCULOS_POR_HORA,
    p_janela_segundos: 3600,
  });
  if (erroDoLimite != null)
    return { mensagem: mensagemDaFalha('publicacao', erroDoLimite, FALHA_GENERICA) };
  if (!dentro) {
    return { mensagem: 'Foram muitas tentativas seguidas. Espere alguns minutos e tente de novo.' };
  }

  const token = await tokenDaLoja(servico, quem.lojaAtiva.id);
  if (!token.ok) return { mensagem: token.motivo };

  const appId = appIdDaApple(dados.links.appleTeamId, dados.links.bundleIdIos);
  const pacote = dados.links.packageAndroid;
  const resultado = await vincularAppNoDominio(token.dominio, token.token, {
    apple: situacao.ios.estado === 'falta' || appId === null ? null : { appId },
    android:
      situacao.android.estado === 'falta' || pacote === null
        ? null
        : { applicationId: pacote, impressoes: dados.links.impressoesAndroid },
  });

  const { error } = await servico.rpc('registrar_links_do_app', {
    p_app_id: dados.appId,
    p_ator: quem.usuario.id,
    ...(resultado.ios === null ? {} : { p_ios: resultado.ios }),
    ...(resultado.android === null ? {} : { p_android: resultado.android }),
    ...(resultado.erro === null ? {} : { p_erro: resultado.erro }),
  });

  revalidatePath('/publicacao');
  if (error != null) {
    return {
      mensagem: mensagemDaFalha(
        'publicacao',
        error,
        'A Shopify respondeu, mas não conseguimos guardar o resultado. Tente de novo.',
      ),
    };
  }
  if (resultado.erro !== null) return { mensagem: resultado.erro };

  return {
    ok: true,
    mensagem:
      'Pronto. A Shopify publica os links no domínio da loja, e em alguns minutos eles passam a abrir no app.',
  };
}
