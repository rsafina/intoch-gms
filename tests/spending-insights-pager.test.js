// The Spending Insights cards must not keep a pager from the previous result
// set. On 2026-09-02 the "High Average Spend Per Person" card read
// "No guests matched this spending criteria" and "6-10 of 30" at the same
// time, with page 2 highlighted, because the empty branch hid the table and
// returned without ever re-rendering the pager.
//
// Worse than cosmetic: _spendData still held the OLD guests, so clicking a
// page number would have paged through results from a different date range.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const src = fs
  .readFileSync(path.join(__dirname, "..", "js/app.js"), "utf8")
  .replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

console.log("\nAn empty result clears the pager instead of leaving it stale");

check("both cards render the empty result rather than only hiding the table", () => {
  const i = src.indexOf("async function loadWalkInSpendingInsights");
  const body = src.slice(i);
  for (const [name, call] of [
    ["average", 'renderSpendPage("average", [], 1)'],
    ["total", 'renderSpendPage("total", [], 1)'],
  ]) {
    assert.ok(body.includes(call), `the ${name} card's empty branch does not clear its pager`);
  }
});

check("the empty call sits in the empty branch, before the else", () => {
  // Anchored INSIDE loadWalkInSpendingInsights. `if (highAverageBody) {`
  // also appears in the older Ops spending report several hundred lines
  // earlier, which has no pager; searching from the top of the file tests
  // the wrong function and can never fail.
  const fnStart = src.indexOf("async function loadWalkInSpendingInsights");
  assert.ok(fnStart > -1, "loadWalkInSpendingInsights is gone or renamed");
  const i = src.indexOf("if (highAverageBody) {", fnStart);
  assert.ok(i > -1, "the average card block is gone");
  const block = src.slice(i, src.indexOf("} else {", i));
  assert.ok(block.includes('renderSpendPage("average", [], 1)'), "clear happens outside the !length branch");
});

console.log("\nrenderSpendPage treats an empty array as a real result");

check("an empty array replaces the stored data, it is not skipped", () => {
  const i = src.indexOf("function renderSpendPage");
  const body = src.slice(i, i + 400);
  assert.ok(
    /if \(data != null\) _spendData\[type\] = data;/.test(body),
    "guarded with `if (data)`, so an empty array leaves the previous result set in place",
  );
});

check("running it for real clears both the rows and the pager", () => {
  // Exercise the function rather than trust the source read.
  const m = src.match(/^function renderSpendPage\([\s\S]*?^}/m);
  assert.ok(m, "could not slice renderSpendPage out of app.js");
  const els = {
    "wi-spend-a-body": { innerHTML: "<tr>stale row</tr>" },
    "wi-spend-a-pager": { innerHTML: "6–10 of 30" },
    "wi-spend-a-table-wrapper": { insertAdjacentElement() {} },
  };
  const ctx = {
    console,
    document: { getElementById: (id) => els[id] || null, createElement: () => ({}) },
    SPEND_PAGE_SIZE: 5,
    _spendData: { average: [{ name: "Old Guest" }], total: [] },
    _spendPage: { average: 2, total: 1 },
    renderWiGuestRow: () => "<tr></tr>",
    escapeHtml: (s) => s,
    fmt: { currency: (n) => String(n) },
  };
  vm.createContext(ctx);
  vm.runInContext(m[0], ctx);
  ctx.renderSpendPage("average", [], 1);
  assert.strictEqual(els["wi-spend-a-body"].innerHTML, "", "stale rows survived");
  assert.strictEqual(els["wi-spend-a-pager"].innerHTML, "", "stale pager survived");
  assert.strictEqual(ctx._spendData.average.length, 0, "stale data survived, so paging would show old guests");
  assert.strictEqual(ctx._spendPage.average, 1, "page number not reset");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
