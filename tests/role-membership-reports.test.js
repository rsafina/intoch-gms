const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const schema=fs.readFileSync('migrations/ALL_IN_ONE.sql','utf8');
function fn(name){
 const re=new RegExp('create or replace function (?:public\\.)?'+name+'\\([\\s\\S]*?(\\$[a-z_]*\\$)[\\s\\S]*?\\1[^;]*;','gi');
 const matches=[...schema.matchAll(re)];assert.ok(matches.length,name);return matches.at(-1)[0];
}
(async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 grant usage on schema public,auth,storage to anon,authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table staff_users(id uuid primary key,auth_user_id uuid,username text,display_name text,role text,pin text,is_active boolean default true,created_at timestamptz);
 create table storage.objects(id uuid,name text,bucket_id text);
 create table app_settings(key text primary key,value jsonb);
 create table guests(id uuid primary key,name text,phone text,booking_alias text);
 create table reservations(id uuid primary key,guest_id uuid,reservation_date date,reservation_time time,pax int,status text,booking_name text,created_at timestamptz,reservation_source text,deleted_at timestamptz);
 create table visits(id uuid primary key,guest_id uuid,reservation_id uuid,visit_date date,pax int,spend_amount numeric,voided_at timestamptz);
 create table members(id bigint generated always as identity primary key,member_number text,member_type text,is_active boolean default true,total_stickers int default 0,available_vouchers int default 0);
 create table member_transactions(id bigint generated always as identity primary key,member_id bigint,visit_id uuid,transaction_date timestamptz,cashier_name varchar,created_by uuid,transaction_amount numeric,qualified_sticker boolean,sticker_round int,notes text);
 create table member_vouchers(id bigint generated always as identity primary key,member_id bigint,voucher_type text,voucher_amount numeric,issued_at timestamptz default now(),voucher_code text,expires_at timestamptz,redeemed boolean default false,redeemed_at timestamptz,redeemed_by uuid);
 insert into app_settings values('membership','{"stickers_per_voucher":3,"voucher_validity_days":90,"Family":{"min_spend":150000,"voucher_amount":50000,"cap":15}}'),('vouchers','{"standalone_validity_days":60}');
 insert into members(member_number,member_type) values('DFC-S01','Family');`);
 const ids={};for(const [i,role] of ['admin','manager','staff','owner'].entries()){
  ids[role]='00000000-0000-0000-0000-00000000000'+(i+1);
  await db.query('insert into staff_users(id,auth_user_id,username,role) values($1,$1,$2,$2)',[ids[role],role]);
 }
 await db.exec(schema.match(/create table if not exists public\.standalone_vouchers \([\s\S]*?\n\);/i)[0]);
 for(const name of ['get_setting','voucher_validity_days','build_voucher_code','set_member_voucher_defaults','standalone_voucher_validity_days','set_standalone_voucher_defaults','add_member_transaction','redeem_member_voucher','redeem_standalone_voucher','void_standalone_voucher','get_guest_visit_summary'])await db.exec(fn(name));
 await db.exec(`create trigger defaults before insert on member_vouchers for each row execute function set_member_voucher_defaults();create trigger defaults before insert on standalone_vouchers for each row execute function set_standalone_voucher_defaults();`);
 for(const view of ['guest_visit_stats','online_reservation_performance','standalone_voucher_batches'])await db.exec(schema.match(new RegExp('create or replace view public\\.'+view+'[\\s\\S]*?;','i'))[0]);
 const guest='00000000-0000-0000-0000-000000000010',booking='00000000-0000-0000-0000-000000000011';
 await db.query("insert into guests(id,name) values($1,'Test guest');",[guest]);
 await db.query("insert into reservations(id,guest_id,reservation_source,reservation_date,status,pax) values($1,$2,'Online Form',current_date,'Completed',4)",[booking,guest]);
 await db.query('insert into visits(id,guest_id,reservation_id,visit_date,pax,spend_amount) values(gen_random_uuid(),$1,$2,current_date,4,450000)',[guest,booking]);
 await db.query('insert into visits(id,guest_id,visit_date,pax,spend_amount,voided_at) values(gen_random_uuid(),$1,current_date,99,999999,now())',[guest]);
 await db.exec(fs.readFileSync('migrations/20260911_roles_enforce.sql','utf8'));
 const as=async role=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[ids[role]||'',role==='anon'?'anon':'authenticated']);await db.exec('set role '+(role==='anon'?'anon':'authenticated'));};
 await as('staff');
 await db.exec('select add_member_transaction(1,10000)');
 assert.equal((await db.query('select total_stickers from members')).rows[0].total_stickers,0,'below-minimum spending earns no sticker');
 for(let i=0;i<3;i++)await db.query('select add_member_transaction(1,150000,now(),null,$1)',[ids.admin]);
 const member=(await db.query('select * from members')).rows[0];assert.equal(member.total_stickers,3);assert.equal(member.available_vouchers,1);
 const voucher=(await db.query('select * from member_vouchers')).rows[0];assert.ok(voucher.voucher_code);assert.ok(voucher.expires_at);
 assert.equal((await db.query('select created_by from member_transactions limit 1')).rows[0].created_by,ids.staff);
 await db.query('select redeem_member_voucher($1,$2)',[voucher.id,ids.admin]);
 assert.equal((await db.query('select redeemed_by from member_vouchers')).rows[0].redeemed_by,ids.staff);
 assert.equal((await db.query('select available_vouchers from members')).rows[0].available_vouchers,0);
 await assert.rejects(()=>db.query('select redeem_member_voucher($1)',[voucher.id]),/ALREADY_REDEEMED/);
 await as('manager');
 const issue=`insert into standalone_vouchers(recipient_name,value_type,value_idr) values('Test','amount',50000)`;
 await assert.rejects(()=>db.exec(issue),/permission denied for function standalone_voucher_validity_days/);
 await assert.rejects(()=>db.exec("insert into member_vouchers(member_id,voucher_type,voucher_amount) values(1,'Family',50000)"),/permission denied for function voucher_validity_days/);
 await db.exec('reset role');const fix=fs.readFileSync('migrations/20260912_roles_voucher_defaults.sql','utf8');await db.exec(fix);await db.exec(fix);
 await as('manager');await db.exec(issue);await db.exec(issue);
 const standalone=(await db.query('select * from standalone_vouchers order by id')).rows;
 assert.ok(standalone[0].expires_at);assert.ok(standalone[0].voucher_code);
 await db.query('select redeem_standalone_voucher($1,$2)',[standalone[0].voucher_code,ids.admin]);
 await db.query('select void_standalone_voucher($1,$2)',[standalone[1].voucher_code,ids.admin]);
 assert.equal((await db.query('select redeemed_by from standalone_vouchers where redeemed')).rows[0].redeemed_by,ids.manager);
 await assert.rejects(()=>db.query('select redeem_standalone_voucher($1)',[standalone[0].voucher_code]),/ALREADY_REDEEMED/);
 await assert.rejects(()=>db.query('select redeem_standalone_voucher($1)',[standalone[1].voucher_code]),/VOIDED/);
 await db.exec("insert into member_vouchers(member_id,voucher_type,voucher_amount) values(1,'Family',50000)");
 const expired=(await db.query("insert into member_vouchers(member_id,voucher_type,voucher_amount,expires_at) values(1,'Family',50000,now()-interval '1 day') returning id")).rows[0];
 await as('staff');await assert.rejects(()=>db.query('select redeem_member_voucher($1)',[expired.id]),/EXPIRED/);
 for(const role of ['owner','manager','admin']){
  await as(role);const stats=(await db.query('select * from guest_visit_stats')).rows[0];assert.equal(stats.total_pax,4);assert.equal(Number(stats.total_spend),450000);
  assert.equal(Number((await db.query('select * from get_guest_visit_summary()')).rows[0].visit_count),1);
  assert.equal((await db.query('select * from online_reservation_performance')).rows.length,1);
  const batches=(await db.query('select * from standalone_voucher_batches')).rows;
  assert.equal(batches.reduce((n,r)=>n+Number(r.redeemed_count),0),1);assert.equal(batches.reduce((n,r)=>n+Number(r.voided_count),0),1);
 }
 await as('owner');await assert.rejects(()=>db.exec(issue));await assert.rejects(()=>db.exec('select add_member_transaction(1,150000)'));
 await as('staff');await assert.rejects(()=>db.exec(issue));await assert.rejects(()=>db.query('select redeem_standalone_voucher($1)',[standalone[0].voucher_code]));
 await as('anon');await assert.rejects(()=>db.exec('select * from guest_visit_stats'));await assert.rejects(()=>db.exec('select * from get_guest_visit_summary()'));
 console.log('Actual Phase 1 functions: staff stickers/voucher generation/redemption, trusted actors, standalone defaults/redemption/voids, owner/manager/admin report views and excluded void visits passed.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});


