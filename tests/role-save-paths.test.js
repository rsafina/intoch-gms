const fs = require('fs'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create schema auth; create schema storage;
   grant usage on schema public,auth,storage to anon,authenticated;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
   create table staff_users(id uuid primary key,username text,display_name text,pin text,role text,is_active boolean default true,created_at timestamptz,auth_user_id uuid);
   create table app_settings(key text primary key,value jsonb);
   create table storage.objects(id uuid,name text,bucket_id text);
   create table tables(id uuid primary key,area_id uuid,is_active boolean default true);
   create table guests(id uuid primary key, recalculations int default 0);
   create function default_reservation_duration() returns int language sql as $$select 180$$;
   create table reservations(id uuid primary key default gen_random_uuid(),guest_id uuid,status text,deposit_required boolean,table_id uuid,table_ids uuid[] default '{}',assigned_area uuid,booking_duration_minutes int default default_reservation_duration());
   create table visits(id uuid primary key default gen_random_uuid(),guest_id uuid,reservation_id uuid,status text,voided_at timestamptz,table_id uuid,table_ids uuid[] default '{}',assigned_area uuid);
   create function recalculate_guest_spending_tier(p_guest_id uuid) returns void language sql as $$update guests set recalculations=recalculations+1 where id=p_guest_id$$;
   insert into staff_users(id,auth_user_id,role,username) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','admin','admin'),('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','staff','staff');
   insert into tables(id,area_id) values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020');
   insert into guests(id) values('00000000-0000-0000-0000-000000000030');`);
  const schema = fs.readFileSync('migrations/ALL_IN_ONE.sql','utf8');
  await db.exec(`create table invoices(id uuid primary key default gen_random_uuid(),kind text,status text,note text,doc jsonb,total numeric,amount_due numeric,deposit_applied numeric)`);
  const invoiceSql=fs.readFileSync('migrations/20260912_invoice_requested_deposit.sql','utf8');
  await db.exec(invoiceSql.slice(invoiceSql.indexOf('create or replace function public.invoice_document_rupiah'),invoiceSql.indexOf('create or replace function public.sync_invoice_deposit_requirement')));
  for(const name of ['normalize_table_assignment','trigger_recalculate_guest_spending_tier']) {
   const match=schema.match(new RegExp('create or replace function (?:public\\.)?'+name+'\\(\\)[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$[^;]*;', 'i'));
   assert.ok(match,name); await db.exec(match[0]);
  }
  for(const table of ['reservations','visits']) await db.exec(`create trigger normalize before insert or update on ${table} for each row execute function normalize_table_assignment(); create trigger tier after insert or update on ${table} for each row execute function trigger_recalculate_guest_spending_tier();`);
  await db.exec(fs.readFileSync('migrations/20260911_roles_enforce.sql','utf8'));
  const staff=async()=>db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false),set_config('request.jwt.claim.role','authenticated',false);set role authenticated;`);
  await staff();
  const reservation=`insert into reservations(guest_id,table_ids,booking_duration_minutes) values('00000000-0000-0000-0000-000000000030',array['00000000-0000-0000-0000-000000000010'::uuid],180)`;
  const visit=`insert into visits(guest_id) values('00000000-0000-0000-0000-000000000030')`;
  await assert.rejects(()=>db.exec(reservation),/One or more selected tables no longer exist/);
  await assert.rejects(()=>db.exec(visit),/permission denied for function recalculate_guest_spending_tier/);
  const invoice=`insert into invoices(kind,status,total,doc) values('deposit','issued',5000000,'{"dpOn":true,"dp":"2.500.000"}')`;
  await assert.rejects(()=>db.exec(invoice),/permission denied for function invoice_document_rupiah/);
  await db.exec('reset role');
  const fix=fs.readFileSync('migrations/20260912_roles_save_paths.sql','utf8'); await db.exec(fix);await db.exec(fix);
  const invoiceFix=fs.readFileSync('migrations/20260912_roles_invoice_amount.sql','utf8');await db.exec(invoiceFix);await db.exec(invoiceFix);
  await staff();await db.exec(reservation);await db.exec(visit);
  await db.exec(invoice);
  assert.equal(Number((await db.query('select amount_due from invoices')).rows[0].amount_due),2500000);
  await db.exec(`update invoices set doc='{"dpOn":true,"settleOn":true,"dp":"2.500.000","settle":"1.000.000"}'`);
  assert.equal(Number((await db.query('select amount_due from invoices')).rows[0].amount_due),1000000);
  await db.exec('insert into reservations default values');
  assert.equal((await db.query('select recalculations from guests')).rows[0].recalculations,2);
  await assert.rejects(()=>db.exec('select recalculate_guest_spending_tier(null)'),/permission denied/);
  await db.exec('update tables set is_active=false');assert.equal((await db.query('select is_active from tables')).rows[0].is_active,true);
  await assert.rejects(()=>db.exec(reservation.replace('000000000010','000000000099')),/One or more selected tables no longer exist/);
  console.log('Reproduced both save failures; targeted fix restores saves/defaults and preserves table/helper restrictions; rerun passed.');
 } finally { await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
