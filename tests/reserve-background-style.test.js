// Background style: photo behind glass, or a flat colour.
//
// Three things here fail silently if they break, which is why they are pinned:
//
// 1. An unknown or missing value must land on "photo". Every client saved
//    before this setting existed has no bg_style at all, and their booking
//    page must not change the day this ships.
// 2. The attribute goes on <html> only when applyReserveAppearance() is
//    styling the real document. The settings screen calls it with its own
//    target to draw a preview, and painting the staff app in a client's
//    booking-page colours would be a hard bug to explain.
// 3. reserve.html carries its OWN copy of applyReserveAppearance (it cannot
//    load config.js — both declare SUPABASE_URL). The copy has to switch the
//    attribute too, or the whole feature works everywhere except the one page
//    that matters.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const cfgSrc = rd("js/config.template.js");
const app = rd("js/app.js");
const index = rd("index.html");
const reserve = rd("reserve.template.html");
const created = rd("reservation-created.template.html");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + " :: " + e.message); }
};

function lift(src, name) {
  const m = src.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  if (!m) throw new Error("could not slice " + name + " out of config.template.js");
  return m[0];
}
function grab(src, decl) {
  const m = src.match(new RegExp(`^const ${decl}[\\s\\S]*?^};`, "m"));
  if (!m) throw new Error("could not slice const " + decl);
  return m[0];
}

// A document just real enough: a root whose attributes and custom properties
// we can read back afterwards.
function apply(cfg, withTarget) {
  const root = { attrs: {}, props: {} };
  const styleOf = (bag) => ({ setProperty: (k, v) => (bag[k] = v) });
  const target = withTarget ? { style: styleOf({}) } : null;
  const ctx = {
    console,
    document: {
      documentElement: {
        style: styleOf(root.props),
        setAttribute: (k, v) => (root.attrs[k] = v),
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(
    [
      lift(cfgSrc, "isHexColor"),
      lift(cfgSrc, "shadeHex"),
      lift(cfgSrc, "hexToRgba"),
      lift(cfgSrc, "clampGlassOpacity"),
      grab(cfgSrc, "RESERVE_APPEARANCE_DEFAULTS"),
      "const RESERVE_GLASS_MIN_OPACITY = 0.25;",
      "const RESERVE_GLASS_MAX_OPACITY = 0.95;",
      "const RESERVE_LOGO_MIN_H = 32;",
      "const RESERVE_LOGO_MAX_H = 200;",
      "let RESERVE_APPEARANCE = null;",
      lift(cfgSrc, "applyReserveAppearance"),
      "globalThis.T = { applyReserveAppearance, RESERVE_APPEARANCE_DEFAULTS };",
    ].join("\n\n"),
    ctx,
  );
  ctx.T.applyReserveAppearance(cfg, target);
  return { root, defaults: ctx.T.RESERVE_APPEARANCE_DEFAULTS };
}

console.log("reservation page background style");

check("the bundled default is the photo", () => {
  assert.strictEqual(apply({}).defaults.bg_style, "photo");
});

check("no bg_style at all keeps the photo", () => {
  // Every client saved before this setting existed looks exactly like this.
  assert.strictEqual(apply({ glass_color: "#173B64" }).root.attrs["data-rf-bg"], "photo");
});

check('"solid" switches the page over', () => {
  assert.strictEqual(apply({ bg_style: "solid" }).root.attrs["data-rf-bg"], "solid");
});

check("a value nobody expects falls back to the photo, not to nothing", () => {
  for (const v of ["SOLIDS", "polos", 7, null, {}])
    assert.strictEqual(
      apply({ bg_style: v }).root.attrs["data-rf-bg"],
      "photo",
      "bg_style " + JSON.stringify(v) + " should have degraded to photo",
    );
});

check("the panel colour is also published as the solid page colour", () => {
  assert.strictEqual(apply({ glass_color: "#123456" }).root.props["--rf-solid"], "#123456");
});

check("a preview target never restyles the page it is previewing inside", () => {
  const r = apply({ bg_style: "solid", glass_color: "#123456" }, true);
  assert.strictEqual(
    r.root.attrs["data-rf-bg"],
    undefined,
    "the staff app's own <html> was given a booking-page background",
  );
});

check("both guest pages carry the solid rules and the fallback colour", () => {
  for (const [name, src] of [
    ["reserve.template.html", reserve],
    ["reservation-created.template.html", created],
  ]) {
    assert.ok(/--rf-solid:/.test(src), name + " has no --rf-solid default");
    assert.ok(
      /:root\[data-rf-bg="solid"\] \.bg-photo/.test(src),
      name + " never hides the photo layer",
    );
    assert.ok(
      /:root\[data-rf-bg="solid"\] \.bg-tint/.test(src),
      name + " never fills the page with the solid colour",
    );
    assert.ok(
      /:root\[data-rf-bg="solid"\] \.card[\s\S]*?rgba\(255, 255, 255, 0\.94\)/.test(src),
      name + " does not turn the glass card into a solid light panel",
    );
  }
});

check("solid mode has squared-off primary actions", () => {
  assert.ok(
    /:root\[data-rf-bg="solid"\] \.btn-submit[\s\S]*?border-radius: 12px/.test(reserve),
    "the booking form button stays pill-shaped in solid mode",
  );
  assert.ok(
    /:root\[data-rf-bg="solid"\] \.btn-wa[\s\S]*?border-radius: 12px/.test(created),
    "the thank-you WhatsApp button stays pill-shaped in solid mode",
  );
});

check("reserve.html's own copy of the helper sets the attribute too", () => {
  const i = reserve.indexOf("function applyReserveAppearance(cfg)");
  assert.ok(i > 0, "the inline copy is gone; is the page loading config.js now?");
  const body = reserve.slice(i, reserve.indexOf("\n      }", i + 100));
  assert.ok(/data-rf-bg/.test(body), "the inline copy never switches background style");
  assert.ok(/--rf-solid/.test(body), "the inline copy never sets the solid page colour");
});

check("the settings screen has the control, with English values", () => {
  const i = index.indexOf('id="rf-bg-style"');
  assert.ok(i > 0, "#rf-bg-style is missing from Settings > Reservation Form");
  const block = index.slice(i, i + 600);
  assert.ok(/value="photo"/.test(block) && /value="solid"/.test(block),
    "the option values are not the English photo/solid");
  assert.ok(/Solid background, no glass/.test(block),
    "the solid option does not name the no-glass look");
  assert.ok(index.includes('id="rf-preview-tint"'),
    "the preview tint has no handle, so the preview cannot go solid");
});

check("the form reads it and saving keeps it out of a colour reset", () => {
  assert.ok(/bg_style: bgStyle\(\)/.test(app), "reserveAppearanceForm() never reads the control");
  const i = app.indexOf("async function resetReserveAppearanceDefaults");
  const body = app.slice(i, i + 1400);
  assert.ok(
    /bg_style:/.test(body),
    '"Back to defaults" would put a solid client back on the photo',
  );
});

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
