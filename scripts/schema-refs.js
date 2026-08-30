// Every Postgres object the application code expects a client database to have.
//
// WHY THIS EXISTS
// The live Blue Heron database was patched by hand for a year, so
// migrations/ALL_IN_ONE.sql was never the thing being exercised. Eight
// separate defects have now been found the same way: a table, column,
// function or bucket that exists in production, is used by the app, and is
// created by no migration. Each one presents to a client as a screen that
// 400s on load, and only that screen, so it survives a casual walkthrough.
//
// Reading the SQL cannot find these. Comparing what the CODE asks for
// against what a database BUILT FROM THE FILE actually contains can.
//
// This module does the first half: a static scan of the source for
// .from(), .rpc(), .select(), the filter methods, insert/update keys and
// storage buckets. scripts/schema-check.js does the comparison.
//
// LIMITS, stated plainly so nobody trusts this further than it goes:
//   - Static. A table name assembled at runtime is invisible to it.
//     There are none today; scripts/schema-check.js fails loudly if one
//     appears.
//   - Column-level only. It proves a column EXISTS, never that the type,
//     nullability, default or foreign key is right.
//   - RLS, grants, triggers and function BODIES are out of scope.
// A green run means "no missing object of the kind that has bitten us
// eight times", not "this database is correct".

const fs = require("fs");
const path = require("path");

// "scripts" is excluded because these files are build and QA tooling, not
// app code that talks to a client database from a browser. They also discuss
// .from() in their own comments, which the scan would otherwise read as real
// references to a table called "x".
const SKIP_DIRS = new Set([
  "node_modules", ".git", "_to_delete", "demo", "backups", "scripts",
]);

// Owners of a .from() that is not a database table.
const NOT_A_TABLE = new Set(["Array", "Object", "Buffer", "storage"]);

// Supabase filter methods whose FIRST argument is a column name.
const COLUMN_FIRST_ARG =
  "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|order|not|filter|textSearch";

function sourceFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      // Tests are excluded: they name columns that only ever exist in a
      // fixture, which would report gaps that are not gaps.
      else if (/\.(js|html)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
    }
  })(root);
  return out.sort();
}


// Remove comments while leaving string and template literals intact.
//
// Needed because a sentence in a comment is prose, not a query: a line
// reading "a .from() whose argument is not a literal" would otherwise be
// collected as a dynamic table reference and fail the check. String contents
// must survive, because .select("a, b, c") is where the column names live.
//
// Regex literals are handled well enough for this codebase: the scanner only
// treats "/" as a comment when followed by "/" or "*", and no regex here
// begins with either.
function stripComments(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += quote;
      i++;
      let depth = 0;
      while (i < s.length) {
        if (s[i] === "\\") { out += s.slice(i, i + 2); i += 2; continue; }
        if (quote === "`" && s[i] === "$" && s[i + 1] === "{") { depth++; out += "${"; i += 2; continue; }
        if (depth > 0) {
          if (s[i] === "{") depth++;
          else if (s[i] === "}") depth--;
          out += s[i];
          i++;
          continue;
        }
        if (s[i] === quote) break;
        out += s[i];
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Replace the CONTENTS of every string and template literal with nothing,
// keeping the delimiters so the surrounding structure still parses.
//
// This is not tidiness. Object keys are read as `name:` and a template
// literal like `Reservation deleted: ${reason}` reads as a column named
// "deleted" — a gap that does not exist, in a file that must be trusted or
// it is worthless. Interpolations are tracked by brace depth because a
// non-greedy {...} match stops at the } of ${...} and leaves the literal
// unterminated, which is exactly how that false positive first appeared.
function blankLiterals(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '"' && ch !== "'" && ch !== "`") {
      out += ch;
      i++;
      continue;
    }
    const quote = ch;
    out += quote;
    i++;
    let depth = 0;
    while (i < s.length) {
      if (s[i] === "\\") { i += 2; continue; }
      if (quote === "`" && s[i] === "$" && s[i + 1] === "{") { depth++; i += 2; continue; }
      if (depth > 0) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
        continue;
      }
      if (s[i] === quote) break;
      i++;
    }
    out += quote;
    i++;
  }
  return out;
}

// The method chain that follows a .from("x"), so its columns are attributed
// to the right table. Starts inside the from(...) parens, hence depth 1.
function chainAfter(src, i) {
  let depth = 1;
  let out = "";
  for (let k = i; k < src.length && out.length < 4000; k++) {
    const ch = src[k];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      depth--;
      if (depth < 0) break;
    } else if (depth === 0) {
      if (ch === ";") break;
      // A chain may wrap lines. Only a newline that is NOT followed by a
      // continuing "." ends it.
      if (ch === "\n" && !/^\s*\./.test(src.slice(k + 1, k + 200))) break;
    }
    out += ch;
  }
  return out;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function collect(root) {
  const tables = new Map();
  const rpcs = new Map();
  const buckets = new Set();
  const dynamic = [];

  const add = (t, c) => {
    if (!IDENT.test(c)) return;
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t).add(c);
  };

  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    // Normalise line endings on read. The repo is all-LF today, but a
    // checkout with core.autocrlf=true is CRLF and every anchored regex
    // here would quietly stop matching. See CLAUDE.md.
    const src = stripComments(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));

    for (const m of src.matchAll(/storage\s*\.\s*from\(\s*["'`]([A-Za-z0-9_.\-]+)["'`]/g))
      buckets.add(m[1]);

    // The trailing window is a LOOKAHEAD, not a capture. A consuming match
    // advances lastIndex past the next 800 characters, which silently skips
    // any .rpc() call that follows closely — the scanner would then report a
    // clean run while never having looked at that function at all.
    for (const m of src.matchAll(/\.rpc\(\s*["'`]([A-Za-z0-9_]+)["'`](?=([\s\S]{0,800}))/g)) {
      const name = m[1];
      if (!rpcs.has(name)) rpcs.set(name, new Set());
      const obj = m[2].match(/^\s*,\s*(\{[\s\S]*?\n\s*\}|\{[^{}]*\})/);
      if (obj)
        for (const k of blankLiterals(obj[1]).matchAll(/([a-z_][A-Za-z0-9_]*)\s*:/g))
          rpcs.get(name).add(k[1]);
    }

    for (const m of src.matchAll(/(\w+)?\s*\.\s*from\(\s*(["'`])?([A-Za-z0-9_.\-]*)/g)) {
      if (NOT_A_TABLE.has(m[1] || "")) continue;
      if (!m[2]) {
        // A .from() whose argument is not a literal. Today the only ones
        // are storage bucket constants, resolved below by name.
        const around = src.slice(m.index, m.index + 120).split("\n")[0].trim();
        if (!/storage/.test(src.slice(Math.max(0, m.index - 120), m.index)))
          dynamic.push(`${rel}: ${around}`);
        continue;
      }
      const t = m[3];
      if (!IDENT.test(t)) continue;
      if (!tables.has(t)) tables.set(t, new Set());

      const chain = chainAfter(src, m.index + m[0].length + 1);
      const chainNoStr = blankLiterals(chain);

      for (const s of chain.matchAll(/\.select\(\s*["'`]([\s\S]*?)["'`]/g)) {
        // Drop embedded relations entirely: guests(name, phone) describes
        // the guests table, not this one. Repeat until stable so nested
        // relations go too.
        let flat = s[1];
        let prev;
        do {
          prev = flat;
          flat = flat.replace(/[A-Za-z0-9_]+\s*\([^()]*\)/g, "");
        } while (flat !== prev);
        for (let piece of flat.split(",")) {
          piece = piece.trim();
          if (!piece || piece === "*") continue;
          if (piece.includes(":")) piece = piece.split(":").pop().trim(); // alias:column
          add(t, piece);
        }
      }

      for (const s of chain.matchAll(
        new RegExp(`\\.(${COLUMN_FIRST_ARG})\\(\\s*["'\`]([A-Za-z0-9_]+)["'\`]`, "g"),
      ))
        add(t, s[2]);

      for (const s of chainNoStr.matchAll(
        /\.(insert|update|upsert)\(\s*(\[?\s*\{[\s\S]*?\}\s*\]?)/g,
      ))
        for (const k of s[2].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) add(t, k[1]);
    }
  }

  // Bucket names held in a constant rather than written inline.
  for (const file of sourceFiles(root)) {
    const src = stripComments(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    for (const m of src.matchAll(
      /const\s+[A-Z0-9_]*BUCKET[A-Z0-9_]*\s*=\s*["'`]([A-Za-z0-9_.\-]+)["'`]/g,
    ))
      buckets.add(m[1]);
  }

  return {
    tables: Object.fromEntries([...tables].map(([k, v]) => [k, [...v].sort()])),
    rpcs: Object.fromEntries([...rpcs].map(([k, v]) => [k, [...v].sort()])),
    buckets: [...buckets].sort(),
    dynamic,
  };
}

module.exports = { collect, blankLiterals, stripComments, chainAfter, sourceFiles };

if (require.main === module) {
  console.log(JSON.stringify(collect(path.join(__dirname, "..")), null, 2));
}
