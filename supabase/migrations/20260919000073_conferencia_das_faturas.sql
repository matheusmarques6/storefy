-- C15 e A04: as faturas conferidas direto na Asaas, sem depender do aviso.
--
-- O caminho normal de uma fatura é o aviso (webhook) da Asaas. Ele falha em
-- silêncio: a Asaas PAUSA a fila de avisos depois de erros seguidos, e cada
-- aviso perdido deixa uma marca — a fatura paga continua "vencida" (e quem
-- pagou é travado depois da tolerância), a fatura nova nem aparece para ser
-- paga, a removida continua cobrando.
--
-- Um job de hora em hora confere as assinaturas, a que foi conferida há mais
-- tempo primeiro, e grava o que a Asaas diz pelo mesmo `registrar_fatura` do
-- aviso — que nunca desfaz uma fatura paga. O lojista e a equipe também podem
-- pedir a conferência na hora (C15, A04).

alter table public.subscriptions add column conferida_em timestamptz;

comment on column public.subscriptions.conferida_em is
  'Última vez que as faturas desta assinatura foram conferidas direto na Asaas, sem o aviso.';

alter table public.job_heartbeats drop constraint job_heartbeats_job_check;
alter table public.job_heartbeats add constraint job_heartbeats_job_check
  check (job in (
    'dispatch-push', 'push-stats', 'review-status', 'analytics', 'inactive-devices',
    'invoice-sync'
  ));
