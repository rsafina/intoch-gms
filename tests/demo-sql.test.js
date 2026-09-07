const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8').replace(/--[^\n]*/g, '');
const schema = read('migrations/ALL_IN_ONE.sql');
const wipe = read('demo/00_wipe_except_staff.sql');
const seed = read('demo/01_seed_3_months.sql');
const kept = ['staff_users', 'areas', 'tables', 'app_settings', 'wa_templates',
  'prizes', 'featured_dishes', 'saved_segments', 'reservation_exceptions'];
const wiped = [...wipe.match(/truncate table([\s\S]*?)restart identity;/i)[1]
  .matchAll(/public\.(\w+)/g)].map(m => m[1]);
const tables = [...new Set([...schema.matchAll(/create table if not exists (?:public\.)?(\w+)/gi)].map(m => m[1]))];
assert.deepEqual([...kept, ...wiped].sort(), tables.sort(), 'every schema table must be explicitly classified');
assert.equal(new Set([...kept, ...wiped]).size, kept.length + wiped.length);
assert.ok(!/\bcascade\b/i.test(wipe), 'reset cannot expand its deletion scope');
for (const sql of [wipe, seed]) {
  assert.match(sql.trim(), /^begin;/i);
  assert.match(sql.trim(), /commit;$/i);
  for (const table of kept) {
    assert.ok(!new RegExp('(?:insert\\s+into|update|delete\\s+from|truncate\\s+table)\\s+(?:public\\.)?' + table + '\\b', 'i').test(sql), table + ' must be preserved');
  }
}
assert.ok(!/^\s*set local demo.confirm\s*=/mi.test(wipe), 'destructive reset requires enabling');
for (const table of wiped) assert.ok(seed.includes("'" + table + "'"), table + ' must be checked empty before seeding');
assert.match(seed, /interval '3 months'/);
assert.match(seed, /v\.id\s*\)/, 'membership transactions receive a visit ID');
console.log('Demo SQL: schema coverage, preserved configuration, reset guard and transactions passed (static checks only)');
