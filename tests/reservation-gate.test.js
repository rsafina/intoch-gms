// The New Reservation modal opens with the whole form visible but disabled,
// and unlocks once a guest is chosen.
//
// Asserted on real DOM behaviour rather than on class names, because the
// mechanism is a <fieldset disabled>.
//
// The assertions use `matches(":disabled")`, NOT `el.disabled`. The `disabled`
// IDL property reflects an element's OWN disabled attribute and is false for a
// control that is disabled only by an ancestor fieldset — verified in Chromium,
// not assumed. The spec concept is "actually disabled", and `:disabled` is what
// exposes it. Getting this wrong makes the test fail against a feature that
// works perfectly, which is exactly what happened while writing it.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
const w = dom.window;

function lift(name) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = appSrc.match(re);
  if (!m) throw new Error(`could not find function ${name}() in app.js`);
  return m[0];
}

w.eval(`${lift("setResDetailsEnabled")}`);

let pass = 0,
  fail = 0;
function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  → " + detail : ""}`);
  }
}

const doc = w.document;
const fieldset = doc.getElementById("res-details-fields");
const search = doc.getElementById("res-guest-search");
const hint = doc.getElementById("res-gate-hint");

console.log("\nShape of the modal");
ok("the details block is a fieldset", fieldset && fieldset.tagName === "FIELDSET");
// If it were still hidden, the whole point of the change would be lost.
ok(
  "it is NOT hidden — the form is visible from the start",
  fieldset && !fieldset.classList.contains("hidden"),
);
ok("it ships disabled in the markup", fieldset && fieldset.hasAttribute("disabled"));
ok("the guest search sits OUTSIDE the gate", search && !fieldset.contains(search));
ok("there is a hint explaining why it is greyed out", !!hint);

// The Save button being inside the gate is deliberate: a disabled fieldset
// disables submission too, so an incomplete booking cannot be saved at all
// rather than failing at validation.
const saveBtn = [...fieldset.querySelectorAll("button")].find((b) =>
  (b.getAttribute("onclick") || "").includes("saveReservation"),
);
ok("Save Reservation is inside the gate", !!saveBtn);

console.log("\nGated state");
w.eval("setResDetailsEnabled(false)");
ok("fieldset is disabled", fieldset.disabled === true);
// This is the browser-derived property, and the reason a fieldset was used
// instead of setting .disabled on each input by hand.
const controls = () => [
  ...fieldset.querySelectorAll("input, select, textarea, button"),
];
ok(
  "every control inside is actually disabled",
  controls().every((el) => el.matches(":disabled")),
  controls().filter((el) => !el.matches(":disabled")).map((el) => el.id || el.tagName).join(", "),
);
ok("the guest search stays usable", !search.matches(":disabled"));
ok("the hint is showing", !hint.classList.contains("hidden"));

console.log("\nUnlocked state");
w.eval("setResDetailsEnabled(true)");
ok("fieldset is enabled", fieldset.disabled === false);
ok(
  "every control inside is usable",
  controls().every((el) => !el.matches(":disabled")),
);
ok("the hint is hidden", hint.classList.contains("hidden"));

console.log("\nControls rendered AFTER gating are gated too");
// The failure this guards against: #res-table-picker is rebuilt whenever the
// date changes or occupancy refreshes. Buttons disabled one by one would come
// back enabled on the next repaint; a fieldset covers them for free.
w.eval("setResDetailsEnabled(false)");
const picker = doc.getElementById("res-table-picker");
ok("the table picker is inside the gate", fieldset.contains(picker));
picker.innerHTML = '<button id="probe-table-btn" type="button">T9</button>';
ok(
  "a button added while gated is disabled without re-applying anything",
  doc.getElementById("probe-table-btn").matches(":disabled"),
);
w.eval("setResDetailsEnabled(true)");
ok(
  "and it frees up when the gate opens",
  !doc.getElementById("probe-table-btn").matches(":disabled"),
);

console.log("\nEvery path that changes the guest also moves the gate");
// Source assertions: these four call sites are the whole contract. Miss one
// and the form is either stuck shut or open with no guest attached.
ok(
  "picking an existing guest enables it",
  /if \(prefix === "res"\) \{\s*setResDetailsEnabled\(true\);/.test(appSrc),
);
ok(
  "creating a new guest enables it",
  /createNewGuestFromSearch[\s\S]*?setResDetailsEnabled\(true\)/.test(appSrc),
);
ok(
  "opening the modal gates it",
  /res-new-guest"\)\.classList\.add\("hidden"\);[\s\S]{0,200}?setResDetailsEnabled\(false\)/.test(appSrc),
);
ok(
  "editing an existing reservation opens it",
  /setResDetailsEnabled\(true\);\s*\}\s*\n\s*showModal\("modal-reservation"\)/.test(appSrc),
);
ok(
  "clearing the guest re-gates it",
  /clearGuestSelection[\s\S]*?currentResGuestId = null;[\s\S]{0,300}?setResDetailsEnabled\(false\)/.test(appSrc),
);
// The old hide/show must be gone, or the two mechanisms fight each other.
ok(
  "no leftover classList toggles on the details block",
  !/res-details-fields"\)[\s\S]{0,40}classList\.(add|remove)\("hidden"\)/.test(appSrc),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
