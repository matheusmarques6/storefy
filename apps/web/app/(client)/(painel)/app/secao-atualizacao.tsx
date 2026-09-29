'use client';

/**
 * Atualização obrigatória (C06d): obrigar quem está com um app antigo a
 * atualizar antes de usar.
 *
 * Só oferece o número que JÁ ESTÁ aprovado nas duas lojas — o banco recusa
 * publicar qualquer outro. Exigir uma versão que ainda não existe na loja
 * travaria o app de todo cliente numa tela de "Atualize" sem atualização para
 * baixar. Ver `lib/atualizacao-obrigatoria.ts`.
 */
import type { AppConfig } from '@storefy/config-schema';
import {
  SEM_EXIGENCIA,
  comAtualizacaoObrigatoria,
  versaoDoNumero,
} from '@/lib/atualizacao-obrigatoria';

export function SecaoAtualizacao({
  config,
  aoMudar,
  somenteLeitura,
  numeroExigivel,
}: {
  config: AppConfig;
  aoMudar: (config: AppConfig) => void;
  somenteLeitura: boolean;
  /** O último número aprovado nas duas lojas, ou `null` sem nada aprovado. */
  numeroExigivel: number | null;
}) {
  const atual = config.minSupportedBuild;
  // Um número gravado antes que não é o de hoje continua na lista, marcado —
  // sumir com ele trocaria a escolha do lojista sem ele pedir.
  const outroGravado = atual > SEM_EXIGENCIA && atual !== numeroExigivel ? atual : null;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Atualização obrigatória</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Obriga quem está com uma versão antiga do app a atualizar antes de usar. Use só quando a
          versão antiga tiver um problema sério: quem não puder atualizar fica sem o app.
        </p>
      </div>

      {numeroExigivel === null && outroGravado === null ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
          O app ainda não tem uma versão aprovada nas lojas de aplicativos. Quando tiver, dá para
          exigir que todos estejam nela.
        </p>
      ) : (
        <fieldset className="space-y-2" disabled={somenteLeitura}>
          <legend className="sr-only">Atualização obrigatória</legend>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="atualizacao-obrigatoria"
              className="mt-0.5 size-4"
              checked={atual <= SEM_EXIGENCIA}
              onChange={() => {
                aoMudar(comAtualizacaoObrigatoria(config, null));
              }}
            />
            <span>Não exigir. Cada cliente atualiza quando quiser.</span>
          </label>

          {numeroExigivel === null ? null : (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="atualizacao-obrigatoria"
                className="mt-0.5 size-4"
                checked={atual === numeroExigivel}
                onChange={() => {
                  aoMudar(comAtualizacaoObrigatoria(config, numeroExigivel));
                }}
              />
              <span>
                Exigir a versão <strong>{versaoDoNumero(numeroExigivel)}</strong> — a que está nas
                lojas hoje, no iPhone e no Android.
              </span>
            </label>
          )}

          {outroGravado === null ? null : (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="atualizacao-obrigatoria"
                className="mt-0.5 size-4"
                checked
                readOnly
              />
              <span>
                Exigir a versão <strong>{versaoDoNumero(outroGravado)}</strong>
                {numeroExigivel !== null && outroGravado < numeroExigivel
                  ? ' — uma versão anterior à que está nas lojas.'
                  : '. Esta versão não está aprovada nas duas lojas, e a publicação será recusada até você escolher outra opção.'}
              </span>
            </label>
          )}
        </fieldset>
      )}

      <p className="text-muted-foreground text-xs">
        Vale para todos os clientes depois que você publicar as mudanças.
      </p>
    </section>
  );
}
