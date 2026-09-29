'use server';

/**
 * A09 — criar, editar e excluir planos.
 *
 * Com a sessão de QUEM PEDE: as policies de `plans` só deixam o superadmin
 * escrever, e o gatilho de auditoria grava essa pessoa como autora, com o
 * antes e o depois. O servidor confere o papel antes, para a mensagem ser
 * clara — mas quem decide é o banco.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { exigirPlatformAdminComPapel } from '@/lib/contexto';
import { criarClientServidor } from '@/lib/supabase/server';
import { planoSchema } from '@/lib/cobranca';
import { mensagemDaFalha } from '@/lib/erros';
import {
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoDoPlano {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  /** O que foi ENVIADO nas caixas de marcar, para elas não voltarem atrás. */
  disponivel?: boolean;
  valeNoTeste?: boolean;
}

const CAMPOS = ['nome', 'descricao', 'preco', 'limiteLojas', 'limiteAparelhos', 'limiteCampanhas'];

const SO_SUPERADMIN = 'Só superadmin cria e muda planos.';

function lerFormulario(dados: FormData) {
  const disponivel = dados.get('disponivel') === 'on';
  const valeNoTeste = dados.get('valeNoTeste') === 'on';
  const texto = (campo: string) => {
    const valor = dados.get(campo);
    return typeof valor === 'string' ? valor : '';
  };
  return {
    caixas: { disponivel, valeNoTeste },
    analise: planoSchema.safeParse({
      nome: texto('nome'),
      descricao: texto('descricao'),
      preco: texto('preco'),
      limiteLojas: texto('limiteLojas'),
      limiteAparelhos: texto('limiteAparelhos'),
      limiteCampanhas: texto('limiteCampanhas'),
      disponivel,
      valeNoTeste,
    }),
  };
}

/** Nome repetido e "dois planos no teste" são regras do banco: a frase certa para cada uma. */
function mensagemDoBanco(codigo: string | undefined, detalhe: string): ErrosDeCampo | null {
  if (codigo !== '23505') return null;
  if (detalhe.includes('plans_um_so_no_teste')) {
    return { valeNoTeste: 'Outro plano já vale no teste. Desmarque lá antes de marcar aqui.' };
  }
  return { nome: 'Já existe um plano com esse nome.' };
}

export async function criarPlano(
  _anterior: EstadoDoPlano,
  dados: FormData,
): Promise<EstadoDoPlano> {
  const { papel } = await exigirPlatformAdminComPapel();
  const valores = valoresDigitados(dados, CAMPOS);
  const { caixas, analise } = lerFormulario(dados);
  if (papel !== 'superadmin') return { mensagem: SO_SUPERADMIN, valores, ...caixas };
  if (!analise.success) return { erros: extrairErros(analise.error), valores, ...caixas };

  const plano = analise.data;
  const supabase = await criarClientServidor();
  const { error } = await supabase.from('plans').insert({
    nome: plano.nome,
    descricao: plano.descricao,
    preco_centavos: plano.preco,
    limite_lojas: plano.limiteLojas,
    limite_aparelhos: plano.limiteAparelhos,
    limite_campanhas_mes: plano.limiteCampanhas,
    disponivel: plano.disponivel,
    vale_no_teste: plano.valeNoTeste,
  });
  if (error != null) {
    const erros = mensagemDoBanco(error.code, error.message);
    if (erros !== null) return { erros, valores, ...caixas };
    return {
      mensagem: mensagemDaFalha('planos', error, 'Não conseguimos criar o plano. Tente de novo.'),
      valores,
      ...caixas,
    };
  }

  revalidatePath('/admin/planos');
  return {
    ok: true,
    mensagem: `Plano ${plano.nome} criado.`,
    valores: {},
    disponivel: true,
    valeNoTeste: false,
  };
}

export async function salvarPlano(
  planoId: string,
  _anterior: EstadoDoPlano,
  dados: FormData,
): Promise<EstadoDoPlano> {
  const { papel } = await exigirPlatformAdminComPapel();
  const valores = valoresDigitados(dados, CAMPOS);
  const { caixas, analise } = lerFormulario(dados);
  if (papel !== 'superadmin') return { mensagem: SO_SUPERADMIN, valores, ...caixas };
  if (!analise.success) return { erros: extrairErros(analise.error), valores, ...caixas };

  const plano = analise.data;
  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('plans')
    .update({
      nome: plano.nome,
      descricao: plano.descricao,
      preco_centavos: plano.preco,
      limite_lojas: plano.limiteLojas,
      limite_aparelhos: plano.limiteAparelhos,
      limite_campanhas_mes: plano.limiteCampanhas,
      disponivel: plano.disponivel,
      vale_no_teste: plano.valeNoTeste,
    })
    .eq('id', planoId)
    .select('id')
    .maybeSingle();
  if (error != null) {
    const erros = mensagemDoBanco(error.code, error.message);
    if (erros !== null) return { erros, valores, ...caixas };
    return {
      mensagem: mensagemDaFalha('planos', error, 'Não conseguimos salvar o plano. Tente de novo.'),
      valores,
      ...caixas,
    };
  }
  if (data == null) return { mensagem: 'Este plano não existe mais.', valores, ...caixas };

  revalidatePath('/admin/planos');
  revalidatePath(`/admin/planos/${planoId}`);
  return { ok: true, mensagem: 'Plano salvo.', valores, ...caixas };
}

export async function excluirPlano(planoId: string): Promise<EstadoDoPlano> {
  const { papel } = await exigirPlatformAdminComPapel();
  if (papel !== 'superadmin') return { mensagem: SO_SUPERADMIN };

  const supabase = await criarClientServidor();
  const { data, error } = await supabase
    .from('plans')
    .delete()
    .eq('id', planoId)
    .select('id')
    .maybeSingle();
  if (error != null) {
    // A assinatura aponta para o plano: o banco não deixa apagar, e a saída é
    // tirar da vitrine.
    if (error.code === '23503') {
      return {
        mensagem:
          'Este plano já foi assinado e não pode ser excluído. Desmarque "Disponível para assinar" para tirá-lo da vitrine.',
      };
    }
    return {
      mensagem: mensagemDaFalha('planos', error, 'Não conseguimos excluir o plano. Tente de novo.'),
    };
  }
  if (data == null) return { mensagem: 'Este plano já não existia.' };

  revalidatePath('/admin/planos');
  redirect('/admin/planos');
}
