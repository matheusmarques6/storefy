-- O andamento do build ao vivo na tela (passo 4 da seção 7 do plano).
--
-- Um build leva de 15 a 30 minutos. Sem isto, o lojista precisa recarregar a
-- página para saber se o app ficou pronto — e ou recarrega dezenas de vezes,
-- ou sai e não volta. Com a tabela na publicação, o webhook do EAS grava uma
-- vez e a tela de quem estiver com ela aberta muda sozinha.
--
-- A RLS CONTINUA VALENDO, e é por isso que isto é seguro: o Realtime avalia a
-- policy de SELECT do assinante antes de entregar cada linha, e a de `builds`
-- exige ser membro da loja dona do app. Entrar na publicação não abre a tabela
-- para ninguém que já não pudesse ler a linha por uma consulta comum.
--
-- Só `builds` entra. `app_configs` e `push_campaigns` mudam por ação de quem
-- está na tela, e essas telas já sabem do resultado pela própria ação; `builds`
-- é a única tabela do produto que muda sozinha, por um evento que vem de fora,
-- minutos depois.

do $$
begin
  /*
   * O `if` existe porque `alter publication ... add table` estoura quando a
   * tabela já está lá, e uma migration precisa poder rodar de novo — o
   * `supabase db reset` de um colega reaplica tudo.
   */
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'builds'
  ) then
    alter publication supabase_realtime add table public.builds;
  end if;
end
$$;
