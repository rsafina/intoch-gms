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

// Historical-only seed: every reservation comes from a historical visit,
// with a transaction guard rejecting today or any future date.
assert.equal([...seed.matchAll(/insert\s+into\s+reservations\s*\(/gi)].length, 1);
const reservationInsert = seed.match(/insert into reservations[\s\S]*?;/i)[0];
assert.match(reservationInsert, /v\.guest_id, v\.visit_date/);
assert.match(reservationInsert, /from _visit_rows v/);
assert.match(reservationInsert, /'Completed'/);
assert.match(seed, /reservation_date < start_date or reservation_date >= today/);
assert.ok(!seed.includes('_demo_upcoming'));
assert.ok(!/insert\s+into\s+(invoices|invoice_payments)\b/i.test(seed));
console.log('Historical-only seed: completed bookings from visits, no upcoming/payment examples, date guard passed');
