const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM}=require('jsdom');
(async()=>{
 const db=new PGlite();
 try {
  // Reuse the Phase 1 fixture, then apply the actual security migrations.
  const base=fs.readFileSync('tests/role-enforcement.test.js','utf8');
  const fixture=base.slice(base.indexOf('await db.exec(`')+15,base.indexOf('`);'));
  await db.exec(fixture);
  await db.exec(`alter table invoices add column status text;
   create table visits(id uuid primary key default gen_random_uuid(),visit_type text,status text,voided_at timestamptz);
   create table members(id uuid primary key default gen_random_uuid());
   create table standalone_vouchers(id uuid primary key default gen_random_uuid(),issued_by uuid,redeemed boolean default false,voided boolean default false,redeemed_at timestamptz,voided_at timestamptz);
   create function waive_deposit(p_reservation_id uuid,p_reason text,p_staff_id uuid default null) returns jsonb language plpgsql security definer as $$begin update reservations set deposit_required=false where id=p_reservation_id;return jsonb_build_object('ok',true);end$$;
   insert into staff_users(id,auth_user_id,role,username,display_name) values
    ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','admin','admin','Admin'),
    ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','staff','finance','Finance');`);
  for(const name of ['20260911_roles_enforce','20260912_staff_deposit_waiver','20260916_finance_role','20260916_finance_role']) await db.exec(fs.readFileSync('migrations/'+name+'.sql','utf8'));
  await db.exec(`update staff_users set role='finance' where username='finance';
   select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false),set_config('request.jwt.claim.role','authenticated',false);set role authenticated;`);
  assert.equal((await db.query('select app_staff_role() as role')).rows[0].role,'finance');
  await db.exec(`insert into reservations(status,deposit_required) values('Incoming',true);
   insert into invoices(kind,status,note,doc) values('settlement','issued','BANK A','{"note":"BANK A"}');
   insert into standalone_vouchers(issued_by) values(app_staff_id());
   insert into members default values; select record_deposit_payment(100);`);
  await assert.rejects(()=>db.exec(`insert into visits(visit_type) values('Walk-In')`));
  await assert.rejects(()=>db.exec(`update invoices set status='void'`),/Only managers/);
  await assert.rejects(()=>db.exec(`update invoices set note='BAD',doc='{"note":"BAD"}'`),/Only admin/);
  await assert.rejects(()=>db.exec(`update reservations set status='Deleted'`));
  await assert.rejects(()=>db.exec(`update reservations set deposit_required=false`),/cannot waive/);
  await assert.rejects(()=>db.exec(`select waive_deposit((select id from reservations limit 1),'test')`),/cannot waive/);
  await assert.rejects(()=>db.exec(`insert into standalone_vouchers(issued_by,voided) values(app_staff_id(),true)`));
  await assert.rejects(()=>db.exec(`insert into storage.objects(name) values('deposit-qris-finance.png')`));
  await db.exec(`update staff_users set role='admin'; update app_settings set value='{}'; delete from invoices; update standalone_vouchers set voided=true;`);
  assert.equal((await db.query('select app_staff_role() as role')).rows[0].role,'finance');
  assert.equal((await db.query('select count(*) as n from invoices')).rows[0].n,1);
  assert.equal((await db.query('select voided from standalone_vouchers')).rows[0].voided,false);
  assert.equal((await db.query('select value from app_settings')).rows[0].value.bank_details,'BANK A');
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated;
   update staff_users set can_waive_deposit=true where username='finance';
   select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
   select waive_deposit((select id from reservations limit 1),'approved');`);
  assert.equal((await db.query('select deposit_required from reservations')).rows[0].deposit_required,false);
  await db.exec(`reset role;select set_config('request.jwt.claim.role','anon',false),set_config('request.jwt.claim.sub','',false);set role anon;select create_public_reservation();`);
 } finally { await db.close(); }
 const w=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://example.com'}).window;
 w.t=s=>s;w.STAFF_SESSION_KEY='test';
 const config=fs.readFileSync('js/config.template.js','utf8');
 w.eval(config.slice(config.indexOf('function getStaffSession()'),config.indexOf('// RESERVATION PAGE APPEARANCE')));
 w.setStaffSession({id:'finance',role:'finance'});
 for(const p of ['dashboard','reservations','guests','membership','invoice','vouchers']) assert.equal(w.hasAccess(p),true,p);
 for(const p of ['walkins','reports','broadcast','settings-staff','settings-thresholds']) assert.equal(w.hasAccess(p),false,p);
 assert.equal(w.canManageInvoices(),true);assert.equal(w.canWaiveDeposit(),false);
 w.setStaffSession({id:'finance',role:'finance',can_waive_deposit:true});assert.equal(w.canWaiveDeposit(),true);
 w.applyRoleToNav();assert.equal(w.document.querySelector('.non-finance-ui').style.display,'none');
 const app=fs.readFileSync('js/app.js','utf8');
 const start=app.indexOf('async function initializeApplication() {');
 w.eval(app.slice(start,app.indexOf('  showAppShell();',start))+'}');
 await w.initializeApplication();
 assert.equal(w.dashboardResFilter,'deposits');assert.equal(w.resStatusFilter,'deposits');
 assert.ok(w.document.querySelector('[data-status="deposits"]').classList.contains('btn-primary'));
 w.setStaffSession({id:'staff',role:'staff'});await w.initializeApplication();
 assert.equal(w.dashboardResFilter,'all');assert.equal(w.resStatusFilter,'all');
 console.log('Finance SQL permissions, optional waiver, protected actions, public booking, navigation and rerun passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
