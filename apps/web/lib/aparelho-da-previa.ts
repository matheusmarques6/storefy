/**
 * Qual aparelho a moldura da prévia mostra (C03 e C06): iPhone ou Android.
 *
 * É preferência de quem olha, e não da loja — por isso fica no navegador, e
 * não no banco: duas pessoas da mesma equipe conferem cada uma no seu. Não é
 * dado sensível, que o painel nunca guarda no navegador.
 *
 * Lido por `useSyncExternalStore`: o servidor desenha o iPhone, e o navegador
 * troca logo depois de hidratar. Ler o armazenamento no primeiro desenho daria
 * HTML diferente do servidor, e o React reclamaria da hidratação.
 */
import { useSyncExternalStore } from 'react';

export type Aparelho = 'iphone' | 'android';

export const CHAVE_DO_APARELHO = 'storefy.previa.aparelho';

/**
 * A escolha feita nesta visita. Vale mesmo quando o navegador não deixa gravar
 * — sem ela, o botão não trocaria nada numa aba anônima.
 */
let escolhido: Aparelho | null = null;
const ouvintes = new Set<() => void>();

export function aparelhoGuardado(): Aparelho {
  if (escolhido !== null) return escolhido;
  try {
    return window.localStorage.getItem(CHAVE_DO_APARELHO) === 'android' ? 'android' : 'iphone';
  } catch {
    // Armazenamento bloqueado (cookies desligados, algumas abas anônimas): a
    // prévia abre no iPhone, que é o padrão de qualquer forma.
    return 'iphone';
  }
}

export function guardarAparelho(aparelho: Aparelho): void {
  escolhido = aparelho;
  try {
    window.localStorage.setItem(CHAVE_DO_APARELHO, aparelho);
  } catch {
    // Sem gravar, a escolha dura até fechar a página (está em `escolhido`), e
    // a moldura troca do mesmo jeito. Não há o que avisar a quem está editando.
  }
  for (const ouvinte of ouvintes) ouvinte();
}

export function assinarAparelho(aoMudar: () => void): () => void {
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

function noServidor(): Aparelho {
  return 'iphone';
}

export function useAparelhoDaPrevia(): [Aparelho, (aparelho: Aparelho) => void] {
  const aparelho = useSyncExternalStore(assinarAparelho, aparelhoGuardado, noServidor);
  return [aparelho, guardarAparelho];
}
