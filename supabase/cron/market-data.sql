-- One-time setup only. Replace the placeholders in SQL editor; do not commit
-- the secret values below. The same random secret must be set as the
-- MARKET_CRON_SECRET Edge Function secret.
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'pios_project_url');
select vault.create_secret('<PUBLISHABLE_OR_ANON_KEY>', 'pios_publishable_key');
select vault.create_secret('<RANDOM_SECRET_AT_LEAST_32_CHARACTERS>', 'pios_market_cron_secret');

select cron.schedule(
  'pios-market-data-weekdays',
  '30 15 * * 1-5', -- 23:30 Asia/Shanghai, weekdays
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pios_project_url') || '/functions/v1/market-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'pios_publishable_key'),
      'x-market-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'pios_market_cron_secret')
    ),
    body := '{"action":"scheduled"}'::jsonb
  );
  $$
);
