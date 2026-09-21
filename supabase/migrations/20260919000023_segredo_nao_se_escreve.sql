-- Segredo não se lê — e também não se escreve pelo painel.
--
-- `20260919000005_rls_push.sql` tirou o SELECT das colunas `_enc` e deixou o
-- INSERT/UPDATE aberto, com a ideia de que "quem escreve o segredo é a Server
-- Action que acabou de criptografá-lo". Só que nenhuma delas escreve com o
-- client da sessão: as seis colunas são gravadas pela service role
-- (`lib/contas-de-desenvolvedor.ts`, `lib/ativar-push.ts`,
-- `lib/segredo-do-app.ts` e a rota de retorno do OAuth da Shopify).
--
-- Enquanto o grant existir, o dono da organização pode SOBRESCREVER pelo
-- PostgREST o token da Shopify, o segredo do app e as chaves Apple/Google. Ler
-- ele não consegue, nem forjar um valor que descriptografe — mas consegue
-- quebrar a própria integração por um caminho que não passa por lugar nenhum
-- do nosso código, e portanto não aparece em `audit_logs` nem em log de erro.
-- Um segredo que o navegador pode escrever não é um segredo guardado pelo
-- servidor.
--
-- O Postgres não subtrai privilégio de coluna de um grant de tabela: o único
-- caminho é revogar a tabela inteira e conceder coluna a coluna. É a MESMA
-- armadilha do SELECT, com a mesma consequência: COLUNA NOVA NASCE SEM GRANT.
-- Toda migration que acrescentar coluna a estas três tabelas precisa conceder
-- insert e update nela, como `20260919000018_contato_da_loja.sql` já faz.
--
-- `anon` perde os dois de vez: as policies destas tabelas são todas
-- `to authenticated`, então nenhuma escrita anônima passaria de qualquer
-- forma, e um grant que só existe por inércia é superfície de graça.

revoke insert, update on public.stores from authenticated, anon;
grant insert (
  id, org_id, name, shop_domain, primary_url, platform, shopify_scopes,
  status, timezone, support_email, created_at, updated_at
) on public.stores to authenticated;
grant update (
  id, org_id, name, shop_domain, primary_url, platform, shopify_scopes,
  status, timezone, support_email, created_at, updated_at
) on public.stores to authenticated;

revoke insert, update on public.apps from authenticated, anon;
grant insert (
  id, store_id, display_name, bundle_id_ios, package_android, expo_project_id,
  onesignal_app_id, ios_asc_app_id, apple_team_id, current_config_version,
  icon_path, splash_path, created_at, updated_at
) on public.apps to authenticated;
grant update (
  id, store_id, display_name, bundle_id_ios, package_android, expo_project_id,
  onesignal_app_id, ios_asc_app_id, apple_team_id, current_config_version,
  icon_path, splash_path, created_at, updated_at
) on public.apps to authenticated;

revoke insert, update on public.developer_accounts from authenticated, anon;
grant insert (
  id, org_id, platform, status, apple_team_id, asc_key_id, asc_issuer_id,
  apns_key_id, verified_at, notes, created_at, updated_at
) on public.developer_accounts to authenticated;
grant update (
  id, org_id, platform, status, apple_team_id, asc_key_id, asc_issuer_id,
  apns_key_id, verified_at, notes, created_at, updated_at
) on public.developer_accounts to authenticated;
