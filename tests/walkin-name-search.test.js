// Walk-In Log name search: staff type part of a name, not the whole thing.
//
// Runs the REAL walkInMatchesName()/renderWalkIns() out of js/app.js (sliced,
// not retyped) against a jsdom table, so the filter, both empty states and the
// "no refetch" contract are checked exactly as shipped.
//
//   node tests/walkin-name-search.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").replace(/\r\n/g, "\n");
const START = "// Partial, case-insensitive match on the guest's name";
const END = "// ── Void Walk-In";
const a = src.indexOf(START), b = src.indexOf(END, a);
assert.ok(a >= 0 && b > a, "walk-in search functions found in app.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.match(html, /id="wi-search"[\s\S]*?oninput="renderWalkIns\(\)"/, "Walk-In Log has a name search box");

const dom = new JSDOM(`<input id="wi-search"><table><tbody id="walkins-tbody"></tbody></table>`, { runScripts: "outside-only" });
const win = dom.window;
win.eval(`
  var wiRows = [];
  const fmt = { time: v => v, pax: v => v, currency: v => v ?? "—" };
  const escapeHtml = v => String(v);
  const formatGuestName = g => g.name;
  const formatSpendingTierBadge = () => "";
  const memberBadge = () => "";
  const truncateNotes = v => v;
  const assignedTableNames = () => "";
  const waThankYouVisitBtn = () => "";
  const applyManagerOnlyUI = () => {};
  ${src.slice(a, b)}
  this.renderWalkIns = renderWalkIns;
  this.walkInMatchesName = walkInMatchesName;
`);

const visit = (id, name, alias) => ({ id, visit_time: "19:00", pax: 2, guests: { name, booking_alias: alias || null } });
const names = () => [...win.document.querySelectorAll("#walkins-tbody tr p.font-medium")].map(p => p.textContent);
const empty = () => win.document.querySelector("#walkins-tbody td[colspan]")?.textContent;
const search = value => { win.document.getElementById("wi-search").value = value; win.renderWalkIns(); };

search("");
assert.equal(empty(), "No walk-ins for this day", "An empty day keeps its message");

win.eval("wiRows = " + JSON.stringify([visit("1", "Budi Santoso"), visit("2", "Siti Rahma", "Bu Siti"), visit("3", "Andi Wijaya"), { id: "4", visit_time: "20:00", pax: 1, guests: null }]));
search("");
assert.equal(names().length, 4, "No query shows every walk-in of the day");
search("san");
assert.deepEqual(names(), ["Budi Santoso"], "Part of a name is enough");
search("  BUDI ");
assert.deepEqual(names(), ["Budi Santoso"], "Case and surrounding spaces are ignored");
search("bu siti");
assert.deepEqual(names(), ["Siti Rahma"], "Online booking alias also matches");
search("a");
assert.deepEqual(names(), ["Budi Santoso", "Siti Rahma", "Andi Wijaya"], "A guest-less row never matches a name search");
search("zzz");
assert.equal(empty(), "No walk-ins match this name", "No match says so instead of looking like an empty day");

console.log("Walk-in name search: partial, case-insensitive, alias and empty states passed.");
