const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table wa_campaigns(id serial primary key, status text default 'draft', ended_at timestamptz);
      create unique index idx_one_open_campaign on wa_campaigns ((ended_at is null)) where ended_at is null;
      insert into wa_campaigns(status) values ('active');`);
    const sql = fs.readFileSync('migrations/20260914_multiple_active_campaigns.sql', 'utf8');
    await db.exec(sql);
    await db.exec("insert into wa_campaigns(status) select 'draft' from generate_series(1,15)");
    await db.exec("update wa_campaigns set status='active' where id between 2 and 10");
    await assert.rejects(db.exec("update wa_campaigns set status='active' where id=11"), /Maksimal 10/);
    await assert.rejects(db.exec("insert into wa_campaigns(status,active_slot) values ('active',1)"), /Maksimal 10/);
    await db.exec(sql); // rerun with ten active campaigns and multiple drafts
    assert.equal((await db.query("select count(*)::int n from wa_campaigns where status='active'")).rows[0].n, 10);
    await db.exec("update wa_campaigns set status='done' where id=1; update wa_campaigns set status='active' where id=11");
    await assert.rejects(db.exec("update wa_campaigns set status='active' where id=1"), /Maksimal 10/);
    await db.exec("update wa_campaigns set status='done' where id=11; update wa_campaigns set status='active' where id=1");
    const reopened = (await db.query('select * from wa_campaigns where id=1')).rows[0];
    assert.equal(reopened.ended_at, null);
    assert.ok(reopened.active_slot);
    await db.exec("update wa_campaigns set active_slot=99 where id=1");
    assert.equal((await db.query('select active_slot from wa_campaigns where id=1')).rows[0].active_slot, reopened.active_slot);
  } finally { await db.close(); }

  const source = fs.readFileSync('js/campaign-editor.js', 'utf8');
  let active = [], writes = [], fail = false;
  const ctx = vm.createContext({ console, toast() {}, confirm: () => true,
    db: { from() { return {
      select() { return { eq: async () => ({ data: fail ? null : active, error: fail ? new Error('offline') : null }) }; },
      update(value) { return { eq: async (key, id) => { writes.push({key,id,value}); return {error:null}; } }; }
    }; } },
    supabaseQuery: async fn => fn(),
  });
  vm.runInContext(source, ctx);
  vm.runInContext('ceLinkGuard=()=>null; ceCardTextGuard=()=>null; ceSetSection=()=>{}; ceRenderWorkspace=()=>{}; ceCampaign={id:99,message_body:"Hello",status:"draft"};', ctx);
  active = Array.from({length:9}, (_,i) => ({id:i+1}));
  await ctx.ceActivate();
  assert.equal(writes.length,1);
  assert.equal(writes[0].id,99);
  assert.equal(writes[0].value.status,'active');
  active.push({id:10}); writes=[];
  await ctx.ceActivate(); await ctx.ceReopen();
  assert.equal(writes.length,0);
  active.pop(); await ctx.ceReopen();
  assert.equal(writes.length,1);
  fail=true; writes=[]; await ctx.ceActivate();
  assert.equal(writes.length,0);
  console.log('Campaign cap, drafts, migration rerun, reopen, and editor isolation passed');
})().catch(error => { console.error(error); process.exitCode=1; });
