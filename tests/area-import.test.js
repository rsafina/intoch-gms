// The import parsers, which are the part of area management that can quietly
// do the wrong thing.
//
// Everything here runs on a spreadsheet a restaurant owner typed, so the
// interesting cases are all messy input: commas inside names, headers in two
// languages, no header at all, leading zeros, and the range typo that would
// otherwise try to create a thousand tables.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "app.js"),
  "utf8",
);

function lift(name) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in app.js`);
  return m[0];
}

function grab(decl) {
  const re = new RegExp(`^const ${decl}[\\s\\S]*?^};`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find const ${decl} in app.js`);
  return m[0];
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  `${grab("IMPORT_HEADERS")}
   ${lift("parseCsvLine")}
   ${lift("detectImportColumns")}
   ${lift("parseImportText")}
   ${lift("expandTableRange")}
   ${lift("classifyImportRows")}
   let importRows = [];
   let allAreas = [];
   let allTables = [];
   globalThis.T = {
     parseCsvLine, parseImportText, expandTableRange, classifyImportRows,
     setState: (rows, areas, tables) => {
       importRows = rows; allAreas = areas; allTables = tables;
     },
   };`,
  ctx,
);
const T = ctx.T;

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  → got ${g}, want ${w}`);
  }
}

console.log("\nCSV lines: quotes and separators");
eq("plain commas", T.parseCsvLine("Indoor, A1, 4"), ["Indoor", "A1", "4"]);
eq("tabs (a paste straight out of Excel)", T.parseCsvLine("Indoor\tA1\t4"), ["Indoor", "A1", "4"]);
eq("semicolons (European Excel)", T.parseCsvLine("Indoor;A1;4"), ["Indoor", "A1", "4"]);
// The case a naive split() gets wrong, and restaurants really do name rooms
// like this.
eq(
  "a comma INSIDE a quoted name",
  T.parseCsvLine('"Terrace, upper",T1,2'),
  ["Terrace, upper", "T1", "2"],
);
eq('escaped "" inside quotes', T.parseCsvLine('"The ""Nook""",N1,2'), ['The "Nook"', "N1", "2"]);
eq("empty trailing cell", T.parseCsvLine("Indoor,A1,"), ["Indoor", "A1", ""]);

console.log("\nHeaders: detected, in either language, or absent");
eq(
  "English header is consumed",
  T.parseImportText("Area,Table,Seats\nIndoor,A1,4"),
  [{ area: "Indoor", table: "A1", seats: 4 }],
);
eq(
  "Indonesian header is consumed",
  T.parseImportText("Ruangan,Meja,Kursi\nTeras,T1,2"),
  [{ area: "Teras", table: "T1", seats: 2 }],
);
// A file with no header must NOT lose its first row.
eq(
  "no header: row one is data",
  T.parseImportText("Indoor,A1,4\nIndoor,A2,4"),
  [
    { area: "Indoor", table: "A1", seats: 4 },
    { area: "Indoor", table: "A2", seats: 4 },
  ],
);
eq(
  "missing seats become null, not zero",
  T.parseImportText("Indoor,A1"),
  [{ area: "Indoor", table: "A1", seats: null }],
);
eq(
  "a non-numeric seats cell is ignored rather than becoming NaN",
  T.parseImportText("Indoor,A1,four"),
  [{ area: "Indoor", table: "A1", seats: null }],
);
eq("blank lines are dropped", T.parseImportText("Indoor,A1,4\n\n\nIndoor,A2,4").length, 2);
eq("empty input", T.parseImportText(""), []);
eq("whitespace only", T.parseImportText("   \n  \n"), []);

console.log("\nRanges");
eq("A1-A4", T.expandTableRange("A1-A4"), ["A1", "A2", "A3", "A4"]);
eq("single name passes through", T.expandTableRange("VIP1"), ["VIP1"]);
eq("comma list", T.expandTableRange("A1, B2, C3"), ["A1", "B2", "C3"]);
eq("range inside a list", T.expandTableRange("A1-A3, VIP1"), ["A1", "A2", "A3", "VIP1"]);
eq("bare numbers", T.expandTableRange("1-3"), ["1", "2", "3"]);
// Leading zeros are how a lot of restaurants number tables, and dropping them
// would give T1 where the physical sign says T01.
eq("leading zeros are kept", T.expandTableRange("T01-T04"), ["T01", "T02", "T03", "T04"]);
eq("descending still works", T.expandTableRange("A3-A1"), ["A3", "A2", "A1"]);
eq("en dash, which is what Word autocorrects a hyphen into", T.expandTableRange("A1–A3"), ["A1", "A2", "A3"]);
// Mismatched prefixes are not a range anybody means. Silently producing
// hundreds of tables from it would be far worse than leaving it alone.
eq("A1-B5 is not a range", T.expandTableRange("A1-B5"), ["A1-B5"]);
// A typo must not try to create a thousand rows and hang the browser.
eq("A1-A1000 is refused as a range", T.expandTableRange("A1-A1000"), ["A1-A1000"]);
eq("exactly at the 200 ceiling still expands", T.expandTableRange("A1-A200").length, 200);
eq("one over the ceiling does not", T.expandTableRange("A1-A201"), ["A1-A201"]);
eq("empty", T.expandTableRange(""), []);

console.log("\nAdd-only: what the preview promises");
const AREAS = [{ id: "a1", name: "Indoor Dining", capacity: 40 }];
const TABLES = [{ id: "t1", name: "A1", area_id: "a1" }];

T.setState(
  [
    { area: "Indoor Dining", table: "A1", seats: 4 }, // already exists
    { area: "Indoor Dining", table: "A2", seats: 4 }, // new table, known area
    { area: "Terrace", table: "T1", seats: 2 }, // new table, NEW area
    { area: "", table: "X", seats: 2 }, // unusable
  ],
  AREAS,
  TABLES,
);
let rows = T.classifyImportRows();
eq("existing table is skipped", rows[0].status, "skip");
eq("new table in a known area is added", rows[1].status, "add");
eq("new table in a new area is added", rows[2].status, "add");
eq("and the new area is flagged", rows[2].newArea, true);
eq("a row with no area is unusable", rows[3].status, "invalid");
eq("a known area is not flagged as new", rows[1].newArea, false);

// Case and padding differences are the same table to a human, and creating
// "a1" alongside "A1" would be a mess nobody could untangle from the UI.
T.setState([{ area: "indoor dining", table: "a1", seats: 4 }], AREAS, TABLES);
eq("matching ignores case", T.classifyImportRows()[0].status, "skip");
T.setState([{ area: " Indoor Dining ", table: " A1 ", seats: 4 }], AREAS, TABLES);
eq("matching ignores surrounding spaces", T.classifyImportRows()[0].status, "skip");

// Same table twice inside one pasted file: the second must be skipped, or the
// import inserts a duplicate that no existing-row check would have caught.
T.setState(
  [
    { area: "Terrace", table: "T1", seats: 2 },
    { area: "Terrace", table: "T1", seats: 2 },
  ],
  AREAS,
  TABLES,
);
rows = T.classifyImportRows();
eq("first of a duplicated pair is added", rows[0].status, "add");
eq("second is skipped", rows[1].status, "skip");

// The same table name in two DIFFERENT areas is legitimate: most restaurants
// have a table 1 indoors and a table 1 on the terrace.
T.setState(
  [
    { area: "Terrace", table: "1", seats: 2 },
    { area: "Garden", table: "1", seats: 2 },
  ],
  AREAS,
  TABLES,
);
rows = T.classifyImportRows();
eq("same name in two areas is fine", [rows[0].status, rows[1].status], ["add", "add"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
