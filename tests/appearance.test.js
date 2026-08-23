// Colour and size settings: the validation, not the pixels.
//
// Everything here is edited by a restaurant owner in a colour picker, and the
// values end up driving a guest-facing booking form and a voucher that stands
// in for money. The rule throughout is that a bad value degrades to the
// bundled look rather than to something broken, so that is what this asserts.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const JS = path.join(__dirname, "..", "js");
const cfgSrc = fs.readFileSync(path.join(JS, "config.template.js"), "utf8");
const vcSrc = fs.readFileSync(path.join(JS, "voucher.js"), "utf8");

function lift(src, name, where) {
  const re = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find function ${name}() in ${where}`);
  return m[0];
}

function grab(src, decl, where) {
  const re = new RegExp(`^const ${decl}[\\s\\S]*?^};`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find const ${decl} in ${where}`);
  return m[0];
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(
  `${lift(cfgSrc, "isHexColor", "config.template.js")}
   ${lift(cfgSrc, "shadeHex", "config.template.js")}
   ${lift(cfgSrc, "hexToRgba", "config.template.js")}
   ${lift(cfgSrc, "clampGlassOpacity", "config.template.js")}
   ${grab(cfgSrc, "RESERVE_APPEARANCE_DEFAULTS", "config.template.js")}
   const RESERVE_GLASS_MIN_OPACITY = 0.25;
   const RESERVE_GLASS_MAX_OPACITY = 0.95;
   ${grab(vcSrc, "VC_DEFAULTS", "voucher.js")}
   ${lift(vcSrc, "vcAlpha", "voucher.js")}
   ${lift(vcSrc, "vcLuminance", "voucher.js")}
   ${lift(vcSrc, "vcIsDarkBackground", "voucher.js")}
   ${lift(vcSrc, "vcStyle", "voucher.js")}
   let VOUCHER_STYLE = null;
   globalThis.T = {
     isHexColor, shadeHex, hexToRgba, clampGlassOpacity, vcAlpha,
     vcIsDarkBackground, vcStyle, RESERVE_APPEARANCE_DEFAULTS, VC_DEFAULTS,
     setStyle: (v) => { VOUCHER_STYLE = v; },
   };`,
  ctx,
);
const T = ctx.T;

let pass = 0,
  fail = 0;
function eq(label, got, want) {
  if (got === want) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  → ${JSON.stringify({ got, want })}`);
  }
}

console.log("\nColours: only a full six-digit hex is accepted");
eq("lowercase", T.isHexColor("#28547c"), true);
eq("uppercase", T.isHexColor("#28547C"), true);
eq("padded", T.isHexColor("  #28547C  "), true);
eq("three-digit shorthand rejected", T.isHexColor("#abc"), false);
// The colour <input> always emits six digits, but the hex TEXT box next to it
// is free typing, and a half-typed value must not be pushed to the page.
eq("half-typed rejected", T.isHexColor("#28"), false);
eq("missing hash rejected", T.isHexColor("28547C"), false);
eq("named colour rejected", T.isHexColor("navy"), false);
eq("empty rejected", T.isHexColor(""), false);
eq("null rejected", T.isHexColor(null), false);
eq("injection attempt rejected", T.isHexColor('#000"); alert(1); ("'), false);

console.log("\nThe button's darker end is computed, never asked for");
eq("navy darkens", T.shadeHex("#5596CE", -0.32).toLowerCase(), "#3a668c");
eq("black cannot go below black", T.shadeHex("#000000", -0.5), "#000000");
eq("white lightens no further than white", T.shadeHex("#FFFFFF", 0.5), "#ffffff");
// A bad input must come back untouched rather than as "#NaNNaNNaN".
eq("garbage passes through", T.shadeHex("nope", -0.3), "nope");

console.log("\nGlass panel: rgba built from hex plus opacity");
eq("mid opacity", T.hexToRgba("#28547C", 0.6), "rgba(40, 84, 124, 0.6)");
eq("bad hex gives null", T.hexToRgba("nope", 0.6), null);

console.log("\nOpacity is clamped, because both ends are unusable");
// 0 leaves the booking form invisible over the photo; 1 throws away the glass.
eq("zero clamps up", T.clampGlassOpacity(0), 0.25);
eq("one clamps down", T.clampGlassOpacity(1), 0.95);
eq("in range passes", T.clampGlassOpacity(0.6), 0.6);
eq("text passes through Number()", T.clampGlassOpacity("0.4"), 0.4);
eq("nonsense falls back to the default", T.clampGlassOpacity("abc"), 0.6);
eq("undefined falls back", T.clampGlassOpacity(undefined), 0.6);

console.log("\nVoucher style: bad values fall back per field, not wholesale");
T.setStyle(null);
eq("nothing saved gives the built-in card", T.vcStyle().bg_color, "#F9F5F2");
T.setStyle({ bg_color: "#1B2A3A" });
eq("one field set", T.vcStyle().bg_color, "#1B2A3A");
eq("the rest keep their defaults", T.vcStyle().text_color, "#28547C");
T.setStyle({ bg_color: "not a colour", accent_color: "#C8A96B" });
eq("a broken field falls back alone", T.vcStyle().bg_color, "#F9F5F2");
eq("the good field beside it survives", T.vcStyle().accent_color, "#C8A96B");
// Logo scale drives a multiplication against the card size; out of range
// would draw the logo off the card or invisibly small.
T.setStyle({ logo_scale: 500 });
eq("silly scale falls back", T.vcStyle().logo_scale, 100);
T.setStyle({ logo_scale: 0 });
eq("zero scale falls back", T.vcStyle().logo_scale, 100);
T.setStyle({ logo_scale: 140 });
eq("in-range scale kept", T.vcStyle().logo_scale, 140);

console.log("\nSecondary colours are derived, not configured");
eq("muted label", T.vcAlpha("#28547C", 0.58), "rgba(40, 84, 124, 0.58)");

console.log("\nDark background detection drives the readability warning");
eq("cream is light", T.vcIsDarkBackground("#F9F5F2"), false);
eq("navy is dark", T.vcIsDarkBackground("#1B2A3A"), true);
eq("black is dark", T.vcIsDarkBackground("#000000"), true);
eq("white is light", T.vcIsDarkBackground("#FFFFFF"), false);
// Mid-tones are the interesting case: this is what decides whether an owner
// gets told their card is unreadable.
eq("brand navy is dark", T.vcIsDarkBackground("#28547C"), true);
eq("sand is light", T.vcIsDarkBackground("#F4EDE3"), false);
// Pure green is far lighter than pure blue at the same nominal brightness,
// which is exactly why this uses luminance and not an average of the channels.
eq("saturated green counts as light", T.vcIsDarkBackground("#00FF00"), false);
eq("saturated blue counts as dark", T.vcIsDarkBackground("#0000FF"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
