-- Optional scheduler installation, after lifecycle functions and Edge deployment.
-- Requires pg_cron, pg_net and an already-created Vault secret named below.
-- Never paste the cleanup secret into this migration or browser configuration.
begin;
do $$ begin
 if current_setting('intoch.demo_project_ref',true) is distinct from 'hkrhsubhfqrgqkuhpvql' then
  raise exception 'Verify the playground project before scheduling cleanup';
 end if;
 if not exists(select 1 from pg_extension where extname='pg_cron') or
    not exists(select 1 from pg_extension where extname='pg_net') then
  raise exception 'Enable playground pg_cron and pg_net before scheduling cleanup';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='intoch_demo_cleanup_token') then
  raise exception 'Create the cleanup token in Vault first';
 end if;
end $$;
select cron.schedule('intoch-demo-cleanup','* * * * *',$job$
 select net.http_post(
  url:='https://hkrhsubhfqrgqkuhpvql.supabase.co/functions/v1/demo-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
   (select decrypted_secret from vault.decrypted_secrets where name='intoch_demo_cleanup_token')),
  body:='{}'::jsonb,timeout_milliseconds:=30000
 );
$job$);
commit;
