const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    // Same minimal base schema used by the existing session/spending harness.
    const base = fs.readFileSync('tests/deposit-policy-sql.test.js', 'utf8');
    await db.exec(base.slice(base.indexOf('await db.exec(`') + 15, base.indexOf('`);')));
    await db.exec(`
      alter table storage.objects enable row level security;
      grant all on storage.objects to anon,authenticated;
      create function auth.jwt() returns jsonb language sql stable as $$
        select jsonb_build_object('session_id',current_setting('test.session',true))$$;
      create table auth.sessions(id uuid,user_id uuid,created_at timestamptz);
      create function create_public_reservation() returns uuid language plpgsql security definer as $$
        declare result uuid; begin
        insert into reservations(reservation_date,reservation_time,pax,status)
        values(current_date,'12:00',2,'Incoming') returning id into result; return result; end$$;
      create function invoice_by_token(p_token uuid) returns jsonb language sql security definer as $$
        select jsonb_build_object('id',id) from invoices where id=p_token$$;
      create function waive_deposit(p_reservation_id uuid,p_reason text,p_staff_id uuid default null)
        returns jsonb language sql security definer as $$select '{"ok":true}'::jsonb$$;
      create view reservation_summary as select id,pax from reservations;
    `);
    for (const [i, role] of ['owner', 'manager', 'finance'].entries()) {
      await db.query('insert into staff_users(id,auth_user_id,username,role) values($1,$1,$2,$2)',
        [`10000000-0000-0000-0000-00000000000${i + 3}`, role]);
    }
    await db.exec(`insert into auth.sessions select id,id,now()-interval '1 day' from staff_users`);
    for (const name of ['20260911_roles_enforce', '20260912_staff_deposit_waiver',
      '20260916_finance_role', '20260917_session_notifications']) {
      await db.exec(fs.readFileSync(`migrations/${name}.sql`, 'utf8'));
    }
    const migration = fs.readFileSync('migrations/20261005_client_suspension.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const actor = async (n) => {
      await db.exec('reset role');
      const id = n ? `10000000-0000-0000-0000-00000000000${n}` : '';
      await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false),set_config('test.session',$2,false)",
        [n ? 'authenticated' : 'anon', id]);
      await db.exec(`set role ${n ? 'authenticated' : 'anon'}`);
    };
    const operator = async () => {
      await db.exec("reset role;select set_config('request.jwt.claim.role','',false)");
    };
    const suspend = async (value) => {
      await operator();
      await db.query('select app_private.set_client_suspended($1,$2)', [value, 'Local test']);
    };
    const scalar = async sql => (await db.query(sql)).rows[0].value;
    const blocked = async sql => assert.rejects(() => db.exec(sql));

    await actor(2);
    assert.equal(await scalar('select app_session_valid() as value'), true);
    await db.exec("insert into reservations(reservation_date,reservation_time,pax,status) values(current_date,'12:00',3,'Reserved')");
    await actor(0);
    await db.exec('select create_public_reservation()');
    assert.ok((await db.query('select * from app_settings')).rows.length);
    await operator();
    const invoice = (await db.query("insert into invoices(kind,status) values('deposit','issued') returning id")).rows[0].id;
    const before = await scalar('select count(*)::int as value from reservations');
    await actor(0);
    assert.ok((await db.query('select invoice_by_token($1) as value', [invoice])).rows[0].value);

    await suspend(true);
    await db.exec(migration); // Reapplying must never reactivate a suspended client.
    for (const n of [1, 2, 3, 4, 5, 0]) {
      await actor(n);
      assert.equal(await scalar('select app_client_access_allowed() as value'), false);
      if (n) {
        assert.equal(await scalar('select app_session_valid() as value'), false);
        assert.equal(await scalar('select app_staff_role() as value'), null);
        assert.equal(await scalar('select app_can_waive_deposit() as value'), false);
        await blocked("select waive_deposit(gen_random_uuid(),'test',null)");
        assert.equal((await db.query('select * from reservations')).rows.length, 0);
        assert.equal((await db.query('select * from reservation_summary')).rows.length, 0);
        assert.equal((await db.query('select id from staff_users')).rows.length, 0);
        await blocked("insert into reservations(reservation_date,reservation_time,pax) values(current_date,'12:00',4)");
        assert.equal((await db.query('update reservations set pax=99 returning id')).rows.length, 0);
        assert.equal((await db.query('delete from reservations returning id')).rows.length, 0);
      }
      assert.equal((await db.query('select * from app_settings')).rows.length, 0);
      await assert.rejects(() => db.query('select invoice_by_token($1)', [invoice]), /Access expired/);
      await assert.rejects(() => db.exec('select create_public_reservation()'), /Access expired/);
      await blocked("insert into storage.objects(name) values('new-logo.png')");
      await blocked("select app_private.set_client_suspended(false,'bypass')");
      await blocked('update app_private.client_access set suspended=false');
      await blocked('select * from app_private.client_access_history');
    }
    await operator();
    assert.equal(await scalar('select count(*)::int as value from reservations'), before);
    assert.equal(await scalar('select max(pax) as value from reservations'), 3);
    await db.exec("select set_config('request.jwt.claim.role','service_role',false);select app_private.require_access('admin')");
    await db.exec('set role service_role');
    await blocked("select app_private.set_client_suspended(false,'service bypass')");

    await suspend(false);
    for (const n of [1, 2, 3, 4, 5]) {
      await actor(n);
      assert.equal(await scalar('select app_session_valid() as value'), true);
      assert.equal((await db.query('select * from reservations')).rows.length, before);
    }
    await actor(3); // Owner remains read-only after restoration.
    await blocked("insert into reservations(reservation_date,reservation_time,pax) values(current_date,'12:00',4)");
    await actor(2);
    assert.equal((await db.query("update staff_users set role='admin' where username='staff' returning id")).rows.length, 0);
    await actor(0);
    await db.exec('select create_public_reservation()');
    assert.ok((await db.query('select invoice_by_token($1) as value', [invoice])).rows[0].value);
    await operator();
    assert.equal(await scalar('select count(*)::int as value from app_private.client_access_history'), 2);
    // Suspension restoration must not reactivate inactive staff or reset-invalidated sessions.
    await db.exec("update staff_users set is_active=false where username='staff'");
    await actor(2);
    assert.equal(await scalar('select app_session_valid() as value'), false);
    await operator();
    await db.exec("update staff_users set is_active=true,sessions_valid_after=clock_timestamp() where username='staff'");
    await actor(2);
    assert.equal(await scalar('select app_session_valid() as value'), false);
    await operator();
    await blocked("select app_private.set_client_suspended(null,'bad')");
    await blocked("select app_private.set_client_suspended(true,'')");

    // A later unguarded privileged RPC must prevent a silent upgrade.
    await db.exec('create function public.unreviewed_read() returns int language sql security definer as $$select count(*)::int from reservations$$');
    await assert.rejects(() => db.exec(migration), /Unreviewed callable function/);
    await db.exec('rollback');
    assert.equal(await scalar('select app_client_access_allowed() as value'), true);
    await db.exec('drop function public.unreviewed_read()');
    await db.exec('alter view reservation_summary reset (security_invoker)');
    await assert.rejects(() => db.exec(migration), /Exposed view/);
    await db.exec('rollback;alter view reservation_summary set (security_invoker=true)');
    await db.exec('alter table reservations disable row level security');
    await assert.rejects(() => db.exec(migration), /RLS must already be enabled/);
    await db.exec('rollback;alter table reservations enable row level security');
    await db.exec('create function public.app_staff_role(p_extra text) returns text language sql security definer as $$select username from staff_users limit 1$$');
    await assert.rejects(() => db.exec(migration), /Unreviewed callable function/);
    await db.exec('rollback');
    console.log('Client suspension: five roles, anonymous RPCs, table/view/storage guards, operator-only toggle, restoration and migration drift checks passed');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
