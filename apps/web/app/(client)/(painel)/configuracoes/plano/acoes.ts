'use server';

/**
 * C15 — assinar, trocar de plano, cancelar e mudar quem paga.
 *
 * A ORDEM É SEMPRE A MESMA: a Asaas primeiro, o banco depois. A assinatura só
 * existe aqui quando existe lá — o banco é escrito pela service role, que o
 * lojista não alcança, porque uma assinatura gravada pela API com a sessão
 * dele seria uma assinatura sem cobrança. Se o banco falhar depois de a Asaas
 * aceitar, desfazemos lá.
 *
 * Só o PROPRIETÁRIO mexe na cobrança: é ele quem responde pelo contrato.
 */
import { revalidatePath } from 'next/cache';
import { exigirContextoCliente } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { criarClientServiceRole } from '@/lib/supabase/admin';
import {
  atualizarCliente,
  cancelarAssinatura as cancelarNaAsaas,
  cobrancaConfigurada,
  criarAssinatura,
  criarCliente,
  faturasDaAssinatura,
  mudarValorDaAssinatura,
} from '@/lib/asaas';
import {
  assinaturaSchema,
  centavosDaAsaas,
  finalDoDocumento,
  formatarDia,
  normalizarDocumento,
  primeiroVencimento,
  quemPagaSchema,
  situacaoDaFatura,
  tipoDoDocumento,
} from '@/lib/cobranca';
import { cancelarAssinaturaDaEmpresa, lerSituacaoDaCobranca } from '@/lib/cobranca-servidor';
import { mensagemDaFalha } from '@/lib/erros';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';
import { log } from '@/lib/log';

export interface EstadoDaCobranca {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** A página da primeira fatura, para pagar na hora. */
  linkDaFatura?: string;
}

/** Tentativas de assinar por empresa, por hora: cada uma fala com a Asaas. */
const TENTATIVAS_POR_HORA = 10;

const SO_O_DONO = 'Só o proprietário da empresa assina, troca de plano ou cancela.';
const NA_VISITA = 'Durante a visita ao painel de um cliente, nada muda.';

async function doDono() {
  const contexto = await exigirContextoCliente();
  if (contexto.visita != null) return { ok: false as const, mensagem: NA_VISITA };
  if (contexto.papel !== 'owner') return { ok: false as const, mensagem: SO_O_DONO };
  return { ok: true as const, ...contexto };
}

async function dentroDoLimite(orgId: string): Promise<boolean> {
  // Tabela de sistema, sem policy: o contador vai pela service role, DEPOIS
  // de conferido que quem pede é o proprietário.
  const { data } = await criarClientServiceRole().rpc('consumir_limite', {
    p_chave: `cobranca:${orgId}`,
    p_maximo: TENTATIVAS_POR_HORA,
    p_janela_segundos: 3600,
  });
  return data !== false;
}

/**
 * Grava as faturas que a Asaas já gerou, sem esperar o aviso: quem acabou de
 * assinar quer o link para pagar agora. O aviso, quando chegar, só confirma.
 */
async function gravarFaturasDaAssinatura(assinatura: string): Promise<string | undefined> {
  const faturas = await faturasDaAssinatura(assinatura);
  if (!faturas.ok) return undefined;

  const servico = criarClientServiceRole();
  let link: string | undefined;
  for (const fatura of faturas.dados) {
    const situacao = situacaoDaFatura(fatura.status);
    if (situacao === null) continue;
    const { error } = await servico.rpc('registrar_fatura', {
      p_provider: 'asaas',
      p_fatura: fatura.id,
      p_assinatura: assinatura,
      p_valor_centavos: centavosDaAsaas(fatura.value),
      p_status: situacao,
      p_vencimento: fatura.dueDate,
      ...(fatura.invoiceUrl === null ? {} : { p_link: fatura.invoiceUrl }),
    });
    if (error != null) {
      log.erro('cobranca.fatura-nao-gravada', { fatura: fatura.id, falha: error });
    }
    if (situacao === 'pending' && fatura.invoiceUrl !== null) link ??= fatura.invoiceUrl;
  }
  return link;
}

export async function assinarPlano(
  _anterior: EstadoDaCobranca,
  dados: FormData,
): Promise<EstadoDaCobranca> {
  const valores = valoresDigitados(dados, ['plano', 'nome', 'documento', 'email']);
  const dono = await doDono();
  if (!dono.ok) return { mensagem: dono.mensagem, valores };
  const { organizacao, usuario } = dono;

  const analise = assinaturaSchema.safeParse({
    plano: dados.get('plano'),
    nome: dados.get('nome'),
    documento: dados.get('documento'),
    email: dados.get('email'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  if (!cobrancaConfigurada()) {
    return {
      mensagem: 'A assinatura pelo painel ainda não está ligada. Fale com a equipe pela Ajuda.',
      valores,
    };
  }

  const supabase = await criarClientServidor();
  const { data: plano } = await supabase
    .from('plans')
    .select('id, nome, preco_centavos, disponivel')
    .eq('id', analise.data.plano)
    .maybeSingle();
  if (plano?.disponivel !== true) {
    return { erros: { plano: 'Este plano não está mais disponível. Escolha outro.' }, valores };
  }

  const situacao = await lerSituacaoDaCobranca(supabase, organizacao.id);
  if (situacao.assinatura !== null && situacao.canceladaEm === null) {
    return {
      mensagem: 'A empresa já tem uma assinatura. Para mudar, use "Mudar para este plano".',
      valores,
    };
  }

  if (!(await dentroDoLimite(organizacao.id))) {
    return { mensagem: 'Muitas tentativas em pouco tempo. Espere alguns minutos.', valores };
  }

  const documento = normalizarDocumento(analise.data.documento);
  const tipo = tipoDoDocumento(documento) ?? 'cpf';
  const dadosDoCliente = {
    nome: analise.data.nome,
    documento,
    email: analise.data.email,
    orgId: organizacao.id,
  };

  // Quem paga: reaproveita o cliente da Asaas de uma assinatura anterior.
  const servico = criarClientServiceRole();
  const { data: clienteAtual } = await servico
    .from('billing_customers')
    .select('external_id')
    .eq('org_id', organizacao.id)
    .maybeSingle();

  let cliente: string;
  if (clienteAtual == null) {
    const criado = await criarCliente(dadosDoCliente);
    if (!criado.ok) return { mensagem: criado.motivo, valores };
    cliente = criado.dados.id;
  } else {
    const atualizado = await atualizarCliente(clienteAtual.external_id, dadosDoCliente);
    if (!atualizado.ok) return { mensagem: atualizado.motivo, valores };
    cliente = clienteAtual.external_id;
  }

  const { error: erroCliente } = await servico.rpc('salvar_quem_paga', {
    p_org_id: organizacao.id,
    p_provider: 'asaas',
    p_cliente: cliente,
    p_nome: analise.data.nome,
    p_documento_tipo: tipo,
    p_documento_final: finalDoDocumento(documento),
    p_email: analise.data.email,
    p_ator: usuario.id,
  });
  if (erroCliente != null) {
    return {
      mensagem: mensagemDaFalha('cobranca', erroCliente, 'Não conseguimos salvar. Tente de novo.'),
      valores,
    };
  }

  const vencimento = primeiroVencimento(situacao.hoje, situacao.testeAte);
  const criada = await criarAssinatura({
    cliente,
    valorCentavos: plano.preco_centavos,
    primeiroVencimento: vencimento,
    descricao: `Storefy — plano ${plano.nome}`,
    orgId: organizacao.id,
  });
  if (!criada.ok) return { mensagem: criada.motivo, valores };

  const { error: erroAssinatura } = await servico.rpc('registrar_assinatura', {
    p_org_id: organizacao.id,
    p_provider: 'asaas',
    p_assinatura: criada.dados.id,
    p_plan_id: plano.id,
    p_valor_centavos: plano.preco_centavos,
    p_ator: usuario.id,
  });
  if (erroAssinatura != null) {
    // Existe lá e não aqui: desfaz lá, para ninguém ser cobrado por uma
    // assinatura que o painel não mostra.
    const desfeita = await cancelarNaAsaas(criada.dados.id);
    if (!desfeita.ok) {
      log.erro('cobranca.assinatura-orfa-na-asaas', {
        assinatura: criada.dados.id,
        org: organizacao.id,
      });
    }
    return {
      mensagem: mensagemDaFalha(
        'cobranca',
        erroAssinatura,
        'Não conseguimos concluir a assinatura. Nada foi cobrado; tente de novo.',
      ),
      valores,
    };
  }

  const link = await gravarFaturasDaAssinatura(criada.dados.id);

  revalidatePath('/configuracoes/plano');
  revalidatePath('/', 'layout');
  return {
    ok: true,
    mensagem:
      vencimento > situacao.hoje
        ? `A primeira fatura vence em ${formatarDia(vencimento)}, no fim do teste.`
        : 'Pague a primeira fatura para liberar tudo. Ela vence hoje.',
    ...(link === undefined ? {} : { linkDaFatura: link }),
    valores: {},
  };
}

export async function trocarDePlano(planoId: string): Promise<EstadoDaCobranca> {
  const dono = await doDono();
  if (!dono.ok) return { mensagem: dono.mensagem };
  const { organizacao, usuario } = dono;

  const supabase = await criarClientServidor();
  const [{ data: plano }, { data: assinatura }] = await Promise.all([
    supabase
      .from('plans')
      .select('id, nome, preco_centavos, disponivel')
      .eq('id', planoId)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('external_id, plan_id, valor_centavos, cancelada_em, plans(nome)')
      .eq('org_id', organizacao.id)
      .maybeSingle(),
  ]);
  if (plano?.disponivel !== true) return { mensagem: 'Este plano não está mais disponível.' };
  if (assinatura == null || assinatura.cancelada_em != null) {
    return { mensagem: 'A empresa não tem assinatura ativa. Assine um plano primeiro.' };
  }
  if (assinatura.plan_id === plano.id) return { mensagem: 'A empresa já está neste plano.' };
  if (!(await dentroDoLimite(organizacao.id))) {
    return { mensagem: 'Muitas tentativas em pouco tempo. Espere alguns minutos.' };
  }

  const naAsaas = await mudarValorDaAssinatura(
    assinatura.external_id,
    plano.preco_centavos,
    `Storefy — plano ${plano.nome}`,
  );
  if (!naAsaas.ok) return { mensagem: naAsaas.motivo };

  const { error } = await criarClientServiceRole().rpc('trocar_plano_da_assinatura', {
    p_org_id: organizacao.id,
    p_plan_id: plano.id,
    p_valor_centavos: plano.preco_centavos,
    p_ator: usuario.id,
  });
  if (error != null) {
    // Volta o valor antigo lá: a próxima fatura não pode cobrar um plano que o
    // painel não mostra.
    await mudarValorDaAssinatura(
      assinatura.external_id,
      assinatura.valor_centavos,
      `Storefy — plano ${assinatura.plans.nome}`,
    );
    return {
      mensagem: mensagemDaFalha(
        'cobranca',
        error,
        'Não conseguimos trocar o plano. Tente de novo.',
      ),
    };
  }

  revalidatePath('/configuracoes/plano');
  revalidatePath('/', 'layout');
  return {
    ok: true,
    mensagem: `Plano trocado para ${plano.nome}. O novo valor vale a partir da fatura em aberto.`,
  };
}

export async function cancelarAssinatura(): Promise<EstadoDaCobranca> {
  const dono = await doDono();
  if (!dono.ok) return { mensagem: dono.mensagem };

  const resultado = await cancelarAssinaturaDaEmpresa(dono.organizacao.id, dono.usuario.id);
  if (!resultado.ok) return { mensagem: resultado.motivo };
  if (!resultado.cancelou) return { mensagem: 'Não há assinatura ativa para cancelar.' };

  revalidatePath('/configuracoes/plano');
  revalidatePath('/', 'layout');
  return { ok: true, mensagem: 'Assinatura cancelada. Nenhuma fatura nova será gerada.' };
}

export async function atualizarQuemPaga(
  _anterior: EstadoDaCobranca,
  dados: FormData,
): Promise<EstadoDaCobranca> {
  const valores = valoresDigitados(dados, ['nome', 'documento', 'email']);
  const dono = await doDono();
  if (!dono.ok) return { mensagem: dono.mensagem, valores };
  const { organizacao, usuario } = dono;

  const analise = quemPagaSchema.safeParse({
    nome: dados.get('nome'),
    documento: dados.get('documento'),
    email: dados.get('email'),
  });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const servico = criarClientServiceRole();
  const { data: cliente } = await servico
    .from('billing_customers')
    .select('external_id')
    .eq('org_id', organizacao.id)
    .maybeSingle();
  if (cliente == null) {
    return {
      mensagem: 'Os dados de cobrança são pedidos quando a empresa assina um plano.',
      valores,
    };
  }
  if (!(await dentroDoLimite(organizacao.id))) {
    return { mensagem: 'Muitas tentativas em pouco tempo. Espere alguns minutos.', valores };
  }

  const documento = normalizarDocumento(analise.data.documento);
  const naAsaas = await atualizarCliente(cliente.external_id, {
    nome: analise.data.nome,
    documento,
    email: analise.data.email,
    orgId: organizacao.id,
  });
  if (!naAsaas.ok) return { mensagem: naAsaas.motivo, valores };

  const { error } = await servico.rpc('salvar_quem_paga', {
    p_org_id: organizacao.id,
    p_provider: 'asaas',
    p_cliente: cliente.external_id,
    p_nome: analise.data.nome,
    p_documento_tipo: tipoDoDocumento(documento) ?? 'cpf',
    p_documento_final: finalDoDocumento(documento),
    p_email: analise.data.email,
    p_ator: usuario.id,
  });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('cobranca', error, 'Não conseguimos salvar. Tente de novo.'),
      valores,
    };
  }

  revalidatePath('/configuracoes/plano');
  return { ok: true, mensagem: 'Dados de cobrança atualizados.', valores: {} };
}
