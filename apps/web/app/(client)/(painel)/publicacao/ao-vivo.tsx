'use client';

/**
 * Mantém a tela de publicação (C12) em dia enquanto um build acontece.
 *
 * Um build leva de 15 a 30 minutos e termina por um evento que vem de fora — o
 * webhook do EAS. Sem isto, o lojista fica dando F5 para saber se o app ficou
 * pronto.
 *
 * DOIS CAMINHOS, e o segundo é o que faz este componente ser confiável:
 *
 *   1. Realtime do Supabase. É instantâneo e não custa consulta nenhuma
 *      enquanto nada muda.
 *   2. Uma recarga a cada 20 segundos, que COMEÇA LIGADA e só desliga quando o
 *      canal confirma que subiu.
 *
 * A ordem importa. Se a reserva só ligasse depois de o canal falhar, uma falha
 * que não avisa — WebSocket bloqueado por firewall de empresa, rede de celular
 * ruim — deixaria a tela congelada para sempre numa informação velha. Começando
 * ligada, o pior caso é uma consulta a cada 20 segundos enquanto há build; o
 * melhor caso desliga sozinho em menos de um segundo.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { RefreshCw } from 'lucide-react';
import { criarClientBrowser } from '@/lib/supabase/client';

/** De quanto em quanto tempo recarregar quando o Realtime não está de pé. */
const INTERVALO_DE_RESERVA = 20_000;

/**
 * Contador de canais desta aba.
 *
 * O `createBrowserClient` guarda UM client por aba, e o client guarda os canais
 * por nome: pedir um canal com nome repetido devolve o canal de antes, já
 * inscrito, e registrar um callback nele estoura — derrubando a tela inteira
 * para a fronteira de erro. Acontece toda vez que o componente remonta antes de
 * o `removeChannel` anterior terminar, que é o caso no modo estrito do React em
 * desenvolvimento e numa navegação de ida e volta rápida em produção.
 *
 * Um número por montagem resolve na origem: cada montagem pede um canal seu, e
 * o da montagem anterior sai na limpeza.
 */
let sequenciaDoCanal = 0;

export function BuildsAoVivo({
  appId,
  emAndamento,
}: {
  appId: string;
  /** Há build na fila ou gerando? Sem isso, não há o que acompanhar. */
  emAndamento: boolean;
}) {
  const router = useRouter();

  /*
   * `router.refresh` entra numa ref porque ele muda de identidade a cada
   * render. Usá-lo direto na lista de dependências faria o canal do Realtime
   * ser desfeito e refeito a cada atualização da tela — e um canal que se
   * reconecta em loop perde justamente os eventos que veio buscar.
   */
  const recarregar = useRef<() => void>(() => undefined);

  useEffect(() => {
    recarregar.current = () => {
      router.refresh();
    };
  }, [router]);

  useEffect(() => {
    let montado = true;
    let relogio: ReturnType<typeof setInterval> | null = null;

    const ligarReserva = (): void => {
      if (!montado || !emAndamento || relogio !== null) return;
      relogio = setInterval(() => {
        recarregar.current();
      }, INTERVALO_DE_RESERVA);
    };

    const desligarReserva = (): void => {
      if (relogio === null) return;
      clearInterval(relogio);
      relogio = null;
    };

    // Começa pela reserva; o Realtime a desliga quando confirmar que subiu.
    ligarReserva();

    sequenciaDoCanal += 1;
    const nome = `builds:${appId}:${String(sequenciaDoCanal)}`;

    /*
     * O try existe porque o Realtime é o caminho OPCIONAL. Se subir o canal
     * falhar por qualquer motivo, a tela continua funcionando pela reserva, que
     * já está ligada — o erro não é engolido, vai para o console com o motivo.
     */
    let desfazer = (): void => undefined;
    try {
      const supabase = criarClientBrowser();
      const canal = supabase
        .channel(nome)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'builds',
            // O filtro é do servidor: a aba não recebe evento de outra loja.
            filter: `app_id=eq.${appId}`,
          },
          () => {
            recarregar.current();
          },
        )
        .subscribe((status) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) desligarReserva();
          // Queda, timeout ou canal fechado: a reserva volta a valer.
          else ligarReserva();
        });

      desfazer = () => {
        void supabase.removeChannel(canal);
      };
    } catch (erro) {
      console.error(
        '[publicacao] o acompanhamento ao vivo não subiu; a tela vai recarregar sozinha de tempos em tempos:',
        erro instanceof Error ? erro.message : 'motivo desconhecido',
      );
    }

    return () => {
      montado = false;
      desligarReserva();
      desfazer();
    };
  }, [appId, emAndamento]);

  // O aviso só aparece quando há o que acompanhar; fora disso ele seria ruído.
  if (!emAndamento) return null;

  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs" role="status">
      <RefreshCw className="size-3 animate-spin" aria-hidden />
      Acompanhando o andamento. Pode deixar esta página aberta.
    </p>
  );
}
