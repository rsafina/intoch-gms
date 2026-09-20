#!/usr/bin/env node
// Runs every test harness. No framework: each file is a plain node script
// that exits non-zero on failure.
//
// TZ is forced to Asia/Jakarta because date logic reads the browser's local
// clock, and several suites only hold at UTC+7. Under UTC they fail, which is
// correct behaviour, not a broken test. See docs/DEVELOPMENT_RULES.md, "Dates".
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = [];
for (const dir of ["js", "tests"]) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort()) {
    if (f.endsWith(".test.js")) files.push(path.join(dir, f));
  }
}

let failed = 0;
for (const f of files) {
  process.stdout.write(f.padEnd(38));
  try {
    execFileSync(process.execPath, [f], {
      cwd: root,
      stdio: "pipe",
      timeout: 120000,
      env: { ...process.env, TZ: "Asia/Jakarta" },
    });
    console.log("PASS");
  } catch (e) {
    const out = (e.stdout || "").toString() + (e.stderr || "").toString();
    console.log("FAIL");
    if (e.code === "ETIMEDOUT") console.log("  Suite exceeded the 120-second timeout");
    console.log(out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 6).join("\n"));
    failed++;
  }
}

console.log("\n" + files.length + " suites, " + failed + " failing");
process.exit(failed ? 1 : 0);
