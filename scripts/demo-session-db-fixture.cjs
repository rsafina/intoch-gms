// Full installed migration chain on a disposable local PGlite database only.
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create table auth.users(id uuid primary key,is_anonymous boolean default false,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz default now());
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),name text,bucket_id text);
      alter table storage.objects enable row level security;
      grant all on storage.objects to anon,authenticated;
      create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;
      create function public.gen_random_bytes(length int) returns bytea language sql as $$select decode(repeat(replace(gen_random_uuid()::text,'-',''),(length+15)/16),'hex')$$;
    `);
    // PGlite has built-in gen_random_uuid but no uuid-ossp/pgcrypto installation.
    const base = fs.readFileSync('migrations/ALL_IN_ONE.sql','utf8').replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/i,'');
    await db.exec(base);
    await db.exec(fs.readFileSync('migrations/20260911_roles_prepare.sql','utf8'));
    await db.exec(`insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
      insert into staff_users(id,auth_user_id,username,display_name,role,is_active)
      values('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','local-admin','Local Admin','admin',true);
      insert into auth.sessions(id,user_id) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');`);
    await db.exec(`insert into auth.users(id) select id from staff_users where auth_user_id is null;
      update staff_users set auth_user_id=id where auth_user_id is null;`);
    for (const name of ['20260911_roles_enforce','20260912_roles_save_paths','20260912_roles_invoice_amount',
      '20260912_roles_voucher_defaults','20260912_staff_deposit_waiver','20260913_deposit_policy',
      '20260916_finance_role','20260917_session_notifications','20260918_spending_deposit_choice',
      '20260919_financial_tracking','20260920_reservation_arrival']) {
      await db.exec(fs.readFileSync('migrations/'+name+'.sql','utf8'));
    }
    return db;
  } catch(error) { await db.close(); throw error; }
}
module.exports = { fixture };
