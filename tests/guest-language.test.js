// The guest pages in two languages (2026-09-06).
//
// The failure this file exists to catch is the quiet one: a label with no
// dictionary entry does not break, it just stays in English on an Indonesian
// page, and nobody notices until a guest mentions it. So the two halves are
// checked against each other — every string the pages ask to translate must
// exist in the dictionary, in both directions.
//
// The other half is the resolution order. A guest who taps EN and comes back
// to Indonesian would reasonably decide the switch is broken.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const dictSrc = rd("js/guest-i18n.js");
const app = rd("js/app.js");
const index = rd("index.html");

const PAGES = [
  "reserve.template.html",
  "reservation-created.template.html",
  "reservation-confirmation.template.html",
  "spin.template.html",
];
const SRC = Object.fromEntries(PAGES.map((f) => [f, rd(f)]));

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

// The real module, run as the pages run it.
const ctx = { console, navigator: { language: "id-ID" } };
vm.createContext(ctx);
vm.runInContext(
  dictSrc + "\nglobalThis.T = { gt, gtf, resolveGuestLang, GUEST_DICT, GUEST_LANGS, GUEST_KEEP_ENGLISH, oneLine };",
  ctx,
);
const T = ctx.T;
// Covered = translated, or on the deliberate keep-English list. Both are an
// answer to "what does an Indonesian guest read here". A string on neither
// list is nobody having decided.
const covered = (str) =>
  Object.prototype.hasOwnProperty.call(T.GUEST_DICT, str) ||
  T.GUEST_KEEP_ENGLISH.has(str);
const setLang = (l) => vm.runInContext(`GUEST_LANG = ${JSON.stringify(l)};`, ctx);

console.log("The dictionary itself");

check("translating is a no-op in English and a lookup in Indonesian", () => {
  setLang("en");
  assert.strictEqual(T.gt("Book a Table"), "Book a Table");
  setLang("id");
  assert.strictEqual(T.gt("Book a Table"), "Reservasi Meja");
});

check("an unknown sentence falls back to English, never to blank", () => {
  setLang("id");
  assert.strictEqual(T.gt("Something nobody translated"), "Something nobody translated");
  assert.strictEqual(T.gt(""), "");
});

check("numbers go in AFTER the translation", () => {
  setLang("id");
  assert.strictEqual(T.gtf("+{n} more hours", { n: 6 }), "+6 jam lainnya");
  setLang("en");
  assert.strictEqual(T.gtf("+{n} more hours", { n: 6 }), "+6 more hours");
});

check("no key is defined twice", () => {
  // A duplicate key in an object literal is legal JavaScript and the last one
  // silently wins, so the count has to come from the source, not the object.
  const keys = [...dictSrc.matchAll(/^  ("(?:[^"\\]|\\.)*"|[A-Za-z]\w*):/gm)].map((m) =>
    m[1].startsWith('"') ? JSON.parse(m[1]) : m[1],
  );
  const seen = new Set();
  const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepStrictEqual(dupes, [], "duplicated: " + dupes.join(", "));
});

check("every entry actually changes the sentence", () => {
  // An identity mapping is a translation nobody did. It reads as done and is
  // not, which is worse than a missing key: the missing one shows up here.
  const same = Object.keys(T.GUEST_DICT).filter((k) => T.GUEST_DICT[k] === k);
  assert.deepStrictEqual(same, [], "untranslated: " + same.join(" | "));
});

console.log("\nWhich language a guest gets");

check("a stored choice beats everything", () => {
  assert.strictEqual(T.resolveGuestLang("id", "en", "id-ID"), "en");
  assert.strictEqual(T.resolveGuestLang("en", "id", "en-GB"), "id");
});

check('"auto" follows the phone', () => {
  assert.strictEqual(T.resolveGuestLang("auto", null, "id-ID"), "id");
  assert.strictEqual(T.resolveGuestLang("auto", null, "en-GB"), "en");
  assert.strictEqual(T.resolveGuestLang("auto", null, "de-DE"), "en");
  assert.strictEqual(T.resolveGuestLang("auto", null, undefined), "en");
});

check("otherwise the restaurant decides", () => {
  assert.strictEqual(T.resolveGuestLang("en", null, "id-ID"), "en");
  assert.strictEqual(T.resolveGuestLang("id", null, "en-GB"), "id");
});

check("a missing or nonsense setting is Indonesian, as it always was", () => {
  for (const v of [undefined, null, "", "klingon", 7, {}])
    assert.strictEqual(T.resolveGuestLang(v, null, "en-GB"), "id", String(v));
});

check("a stored value that is not a language is ignored", () => {
  assert.strictEqual(T.resolveGuestLang("id", "xx", "en-GB"), "id");
});

console.log("\nEvery page is wired up");

for (const f of PAGES) {
  check(f + " loads the shared dictionary", () => {
    assert.ok(
      SRC[f].includes('<script src="js/guest-i18n.js"></script>'),
      "the page has no dictionary, so gt() is not defined",
    );
  });
  check(f + " carries the switch", () => {
    assert.ok(/id="lang-switch"/.test(SRC[f]), "no switch markup");
    assert.ok(
      /data-lang-btn="id"/.test(SRC[f]) && /data-lang-btn="en"/.test(SRC[f]),
      "the switch has no buttons the walker can find",
    );
    assert.ok(/setGuestLanguage\('en'\)/.test(SRC[f]), "the switch is not wired");
  });
}

check("reserve.html still does NOT load config.js", () => {
  // Both declare `const SUPABASE_URL`, and the redeclaration kills the page.
  // The dictionary is a separate file precisely so this rule can hold.
  assert.ok(
    !/src="js\/config\.js/.test(SRC["reserve.template.html"]),
    "reserve.html loads config.js, which white-screens the booking form",
  );
});

check("nobody copied the dictionary into a page", () => {
  for (const f of PAGES)
    assert.ok(
      !SRC[f].includes("GUEST_DICT = {"),
      f + " has its own copy of the dictionary; it will drift",
    );
});

console.log("\nEvery string the pages ask for exists in both languages");

// Static labels: whatever the walker will read out of the DOM.
for (const f of PAGES) {
  check(f + ": every data-i18n label is translated", () => {
    const dom = new JSDOM(SRC[f]);
    const missing = [];
    dom.window.document.querySelectorAll("[data-i18n]").forEach((el) => {
      const en = T.oneLine(el.textContent);
      if (en && !covered(en)) missing.push(en);
    });
    dom.window.document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const en = el.getAttribute("placeholder") || "";
      if (en && !covered(en)) missing.push(en);
    });
    dom.window.document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const en = el.getAttribute("aria-label") || "";
      if (en && !covered(en)) missing.push(en);
    });
    assert.deepStrictEqual(missing, [], "no Indonesian for: " + missing.join(" | "));
  });
}

// Sentences the pages translate in JavaScript.
for (const f of PAGES) {
  check(f + ": every gt() sentence is translated", () => {
    const asked = new Set();
    for (const m of SRC[f].matchAll(/\bgtf?\(\s*"((?:[^"\\]|\\.)*)"/g))
      asked.add(JSON.parse('"' + m[1] + '"'));
    // Ternaries inside a gt() call, e.g. gt(isToday ? "a" : "b").
    for (const m of SRC[f].matchAll(/\bgtf?\(\s*[^)"]*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      asked.add(JSON.parse('"' + m[1] + '"'));
      asked.add(JSON.parse('"' + m[2] + '"'));
    }
    const missing = [...asked].filter((str) => str && !covered(str));
    assert.deepStrictEqual(missing, [], "no Indonesian for: " + missing.join(" | "));
  });
}

console.log("\nWhat must NOT be translated");

check("the restaurant's welcome line drops its data-i18n", () => {
  const src = SRC["reserve.template.html"];
  const i = src.indexOf("welcome_text");
  assert.ok(
    /removeAttribute\("data-i18n"\)/.test(src.slice(i, i + 900)),
    "a client's own sentence would be walked over and replaced by ours",
  );
});

check("a staff-written closure reason is dropped in as typed", () => {
  const src = SRC["reserve.template.html"];
  assert.ok(
    /gtf\("Closed on this date: \{reason\}", \{ reason: window\.reason \}\)/.test(src),
    "the reason is being looked up in a dictionary it will never be in",
  );
});

check("product terms stay English in both languages", () => {
  setLang("id");
  assert.strictEqual(T.gt("Best Seller"), "Best Seller");
  assert.strictEqual(T.gt("WhatsApp"), "WhatsApp");
});

console.log("\nThe setting behind it");

check("the defaults are what the pages did before the setting existed", () => {
  const i = app.indexOf("const RESERVATION_FORM_DEFAULTS");
  const body = app.slice(i, app.indexOf("};", i));
  assert.ok(/guest_language: "id"/.test(body), "the default language is not Indonesian");
  assert.ok(/show_lang_switch: true/.test(body), "the switch is not on by default");
});

check("the stored value is English, whatever language staff are in", () => {
  const i = app.indexOf("async function saveReservationFormFields");
  const body = app.slice(i, i + 2200);
  assert.ok(/guest_language:/.test(body), "the language is never saved");
  assert.ok(
    /\["id", "en", "auto"\]\.includes\(/.test(body),
    "an unexpected value is not forced back to a known one",
  );
  assert.ok(/show_lang_switch: on\("rff-lang-switch"\)/.test(body), "the switch flag is never saved");
});

check("the settings screen has both controls", () => {
  assert.ok(index.includes('id="rff-language"'), "no language control");
  assert.ok(index.includes('id="rff-lang-switch"'), "no switch toggle");
  const i = index.indexOf('id="rff-language"');
  const block = index.slice(i, i + 700);
  for (const v of ['value="id"', 'value="en"', 'value="auto"'])
    assert.ok(block.includes(v), "missing option " + v);
});

check("the guest pages read the setting", () => {
  for (const f of PAGES)
    assert.ok(
      /applyGuestLanguageSetting\(/.test(SRC[f]),
      f + " never applies what the restaurant chose",
    );
});

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
