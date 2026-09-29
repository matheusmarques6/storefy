'use server';

/**
 * Conta sem empresa: aceitar um convite em aberto (sem o link — a conta é
 * dona do e-mail) ou criar a própria empresa.
 */
import { criarClientServidor } from '@/lib/supabase/server';
import { definirEmpresaAtiva } from '@/lib/contexto';
import { mensagemDaFalha } from '@/lib/erros';
import { aceiteDeuCerto, mensagemDoAceite, resultadoDoAceite } from '@/lib/convites';
import {
  organizacaoSchema,
  extrairErros,
  valoresDigitados,
  type ErrosDeCampo,
  type ValoresDigitados,
} from '@/lib/validacao';

export interface EstadoSemEmpresa {
  ok?: boolean;
  mensagem?: string;
  erros?: ErrosDeCampo;
  valores?: ValoresDigitados;
  destino?: string;
}

export async function aceitarConviteDaLista(id: string): Promise<EstadoSemEmpresa> {
  const supabase = await criarClientServidor();
  const { data, error } = await supabase.rpc('aceitar_convite_por_id', { p_id: id });
  if (error != null) {
    return {
      mensagem: mensagemDaFalha('convite', error, 'Não conseguimos aceitar. Tente de novo.'),
    };
  }
  const linha = data[0];
  const resultado = resultadoDoAceite(linha?.resultado);
  if (!aceiteDeuCerto(resultado)) return { mensagem: mensagemDoAceite(resultado) };

  if (linha?.organizacao != null) await definirEmpresaAtiva(linha.organizacao);
  return { ok: true, mensagem: mensagemDoAceite(resultado), destino: '/' };
}

export async function criarMinhaEmpresa(
  _anterior: EstadoSemEmpresa,
  dados: FormData,
): Promise<EstadoSemEmpresa> {
  const valores = valoresDigitados(dados, ['nome']);
  const analise = organizacaoSchema.safeParse({ nome: dados.get('nome') });
  if (!analise.success) return { erros: extrairErros(analise.error), valores };

  const supabase = await criarClientServidor();
  const { data, error } = await supabase.rpc('criar_minha_organizacao', {
    p_nome: analise.data.nome,
  });
  if (error != null) {
    // As recusas da função (cadastro fechado, já tem empresa) chegam em
    // português, escritas por nós; o resto vira frase genérica.
    return {
      mensagem: mensagemDaFalha(
        'sem-empresa',
        error,
        'Não conseguimos criar a empresa. Tente de novo.',
      ),
      valores,
    };
  }

  await definirEmpresaAtiva(data);
  return { ok: true, mensagem: 'Empresa criada.', destino: '/' };
}
