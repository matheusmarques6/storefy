/**
 * O celular de teste do lojista (C08).
 *
 * O envio de teste listava os aparelhos vistos por último — clientes
 * inclusive —, e "testar" podia mandar a notificação sem revisão para o
 * celular de um cliente. Agora o lojista PAREIA o próprio celular: o painel
 * mostra um QR code com o link `storefy-<loja>://celular-de-teste?codigo=...`,
 * a câmera abre o app, e o app se apresenta à Storefy com o código (de uso
 * único, que vale 10 minutos).
 *
 * Só a lógica: ler o link, orquestrar o registro e o pareamento e dizer o
 * resultado. A tela (`telas/celular-de-teste.tsx`) só desenha.
 */
import type { Credenciais, Resultado } from './api.ts';

/** Oito caracteres, sem os que se confundem (0 e O, 1 e I) — como o banco gera. */
const CODIGO = /^[A-HJ-NP-Z2-9]{8}$/;

/**
 * O código do link de pareamento, ou `null` quando o link é outro.
 *
 * Só o esquema do app: um link https da loja com `celular-de-teste` no
 * caminho é uma página da loja, e não um pareamento.
 */
export function codigoDoPareamento(url: string): string | null {
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return null;
  }
  if (alvo.protocol === 'http:' || alvo.protocol === 'https:') return null;

  // `esquema://celular-de-teste` põe o nome no host; `esquema:///celular-de-teste`, no caminho.
  const lugar = `${alvo.host}${alvo.pathname}`.replace(/^\/+|\/+$/g, '');
  if (lugar !== 'celular-de-teste') return null;

  const codigo = (alvo.searchParams.get('codigo') ?? '').trim().toUpperCase();
  return CODIGO.test(codigo) ? codigo : null;
}

export type ResultadoDoPareamento =
  | 'pareado'
  | 'codigo_invalido'
  | 'aparelho_desconhecido'
  | 'limitado'
  | 'sem_rede'
  | 'sem_credencial';

export interface DependenciasDoPareamento {
  credenciais: Credenciais | null;
  /** A instalação e a inscrição do push, quando há — é por elas que a Storefy acha o celular. */
  instalacao: () => Promise<string | null>;
  inscricao: () => Promise<string | null>;
  /**
   * Registra o aparelho antes de parear: o link pode ter aberto o app pela
   * primeira vez, antes de a abertura contar.
   */
  registrar: (dados: {
    installId?: string;
    subscriptionId?: string;
  }) => Promise<Resultado<unknown>>;
  parear: (dados: {
    codigo: string;
    installId?: string;
    subscriptionId?: string;
  }) => Promise<Resultado<{ resultado?: unknown }>>;
}

/**
 * A falha da chamada, no que o lojista entende. Recusado é a assinatura (ou o
 * corpo) que a Storefy não aceita: tentar de novo dá no mesmo, e o caminho é
 * instalar a versão nova do app — e não conferir a internet.
 */
function falha(motivo: 'rede' | 'recusado' | 'limite' | 'servidor'): ResultadoDoPareamento {
  if (motivo === 'limite') return 'limitado';
  if (motivo === 'recusado') return 'sem_credencial';
  return 'sem_rede';
}

async function semFalhar<T>(ler: () => Promise<T | null>): Promise<T | null> {
  try {
    return await ler();
  } catch {
    return null;
  }
}

/** Registra este celular e o pareia com o código. Nunca lança. */
export async function parearEsteCelular(
  codigo: string,
  dependencias: DependenciasDoPareamento,
): Promise<ResultadoDoPareamento> {
  if (dependencias.credenciais === null) return 'sem_credencial';

  const [instalacao, inscricao] = await Promise.all([
    semFalhar(dependencias.instalacao),
    semFalhar(dependencias.inscricao),
  ]);
  if (instalacao === null && inscricao === null) return 'aparelho_desconhecido';

  const identidade = {
    ...(instalacao === null ? {} : { installId: instalacao }),
    ...(inscricao === null ? {} : { subscriptionId: inscricao }),
  };

  // Registrar primeiro: sem o aparelho na Storefy, não há o que parear.
  const registro = await dependencias.registrar(identidade);
  if (!registro.ok) return falha(registro.motivo);

  const resposta = await dependencias.parear({ codigo, ...identidade });
  if (!resposta.ok) return falha(resposta.motivo);

  const resultado = resposta.dados.resultado;
  return resultado === 'pareado' ||
    resultado === 'codigo_invalido' ||
    resultado === 'aparelho_desconhecido' ||
    resultado === 'limitado'
    ? resultado
    : 'sem_rede';
}

export interface MensagemDoPareamento {
  titulo: string;
  texto: string;
  ok: boolean;
}

/** O que a tela diz de cada resultado — para o lojista, sem jargão. */
export function mensagemDoPareamento(resultado: ResultadoDoPareamento): MensagemDoPareamento {
  switch (resultado) {
    case 'pareado':
      return {
        titulo: 'Pronto!',
        texto:
          'Este celular vai receber os testes da loja. Mande um teste pelo painel, na tela da campanha.',
        ok: true,
      };
    case 'codigo_invalido':
      return {
        titulo: 'Esse código não vale mais',
        texto:
          'Ele já foi usado ou passou dos 10 minutos. Gere outro no painel e leia de novo com a câmera.',
        ok: false,
      };
    case 'aparelho_desconhecido':
      return {
        titulo: 'Não reconhecemos este celular',
        texto: 'Feche o app, abra de novo e leia o código mais uma vez.',
        ok: false,
      };
    case 'limitado':
      return {
        titulo: 'Muitas tentativas',
        texto: 'Espere um minuto e leia o código de novo.',
        ok: false,
      };
    case 'sem_credencial':
      return {
        titulo: 'Este app não consegue parear',
        texto:
          'Esta versão do app não fala com a Storefy. Instale a versão mais nova da loja de aplicativos.',
        ok: false,
      };
    case 'sem_rede':
      return {
        titulo: 'Sem conexão',
        texto:
          'Não conseguimos falar com a Storefy agora. Confira a internet e leia o código de novo.',
        ok: false,
      };
  }
}
