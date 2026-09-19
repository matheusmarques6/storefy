-- O envio do binário para a loja de aplicativos (passo 5 da seção 7 do plano).
--
-- Gerar o binário e ENTREGÁ-LO à Apple ou ao Google são duas etapas separadas,
-- com falhas diferentes: a geração falha por código ou credencial, o envio
-- falha por metadados, por registro de app inexistente ou por uma regra da
-- loja. Guardá-las na mesma linha, com colunas próprias, é o que permite dizer
-- ao lojista em qual das duas ele está parado.

alter table public.builds
  -- Link do .ipa/.aab que o EAS gerou. É por ele que o lojista baixa o arquivo
  -- quando o envio automático não é possível — no Google, o PRIMEIRO envio é
  -- sempre manual, e sem este link ele não teria o que subir.
  add column artifact_url text,
  -- Id da submissão no EAS, para achar o log dela quando algo der errado.
  add column submission_id text,
  /*
   * O que o lojista precisa fazer À MÃO para destravar este build.
   *
   * Texto com lista fechada em vez de mensagem livre: a tela decide o passo a
   * passo que mostra a partir DESTE valor, e não lendo a mensagem de erro. Erro
   * é texto do EAS, muda sem aviso, e uma tela que procura palavra dentro dele
   * quebra em silêncio na primeira mudança deles.
   */
  add column manual_action text
    check (manual_action is null or manual_action in ('play_primeiro_envio', 'envio_manual'));

comment on column public.builds.artifact_url is
  'Link do binário gerado pelo EAS. Serve para o envio manual quando o automático não dá.';
comment on column public.builds.submission_id is
  'Id da submissão no EAS. Nulo enquanto o envio não começou.';
comment on column public.builds.manual_action is
  'Passo manual que destrava este build: play_primeiro_envio ou envio_manual.';
