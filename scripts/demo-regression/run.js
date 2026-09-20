// Opt-in deployed-demo checks. Never discovered by the offline npm test runner.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const safety = require("./safety");
const root = path.resolve(__dirname, "../..");
let passed = 0;
function requireTrue(condition, message) { if (!condition) throw new Error(message); }
function pass(label) { passed++; console.log("PASS " + label); }

async function request(url, options = {}) {
  safety.assertRequest(url, options.method || "GET");
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Demo request failed (network, timeout or redirect); no response body or credentials logged.");
  }
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, ok: response.ok, text, data };
}

function successful(result, label) {
  requireTrue(result.ok, `${label}: unexpected HTTP ${result.status}`);
  return result.data;
}

function api(key, token) {
  const headers = { apikey: key };
  // Publishable keys belong in apikey, not the bearer header. User JWTs are separate.
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return (route, options = {}) => request(safety.SUPABASE_URL + route, {
    ...options, headers: { ...headers, ...(options.headers || {}) },
  });
}

async function publicChecks(key) {
  const anon = api(key);
  for (const table of ["app_settings", "areas", "tables", "prizes", "reservation_exceptions"]) {
    const rows = successful(await anon(`/rest/v1/${table}?select=*&limit=1`), `public ${table}`);
    requireTrue(Array.isArray(rows), `public ${table}: expected rows`);
    pass(`public configuration: ${table}`);
  }
  for (const table of ["staff_users", "guests", "reservations", "visits", "invoices", "invoice_payments", "members", "member_transactions", "member_vouchers", "standalone_vouchers"]) {
    const result = await anon(`/rest/v1/${table}?select=*&limit=1`);
    const denied = [401, 403].includes(result.status) && result.data?.code === "42501";
    const filtered = result.ok && Array.isArray(result.data) && result.data.length === 0;
    requireTrue(denied || filtered, `anonymous ${table}: expected permission refusal or zero visible rows (HTTP ${result.status})`);
    pass(`anonymous private-data check: ${table}${filtered ? " (empty result; seeded coverage still needed)" : " (permission denied)"}`);
  }
  for (const name of ["invoice_by_token", "deposit_invoice_by_token", "reservation_ticket_by_token"]) {
    for (const token of [null, randomUUID()]) {
      const route = `/rest/v1/rpc/${name}` + (token ? `?p_token=${token}` : "?p_token=null");
      // GET RPC parameters are textual; use a random valid UUID for the typed ticket RPC.
      if (token === null && name === "reservation_ticket_by_token") continue;
      const result = successful(await anon(route), `public ${name}`);
      requireTrue(result === null || (Array.isArray(result) && result.length === 0), `${name}: invalid token exposed data`);
    }
    pass(`invalid guest link: ${name}`);
  }
}

async function roleChecks(key, role, credentials, authHelpers) {
  const anon = api(key);
  let token;
  try {
    const login = successful(await anon("/auth/v1/token?grant_type=password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authHelpers.staffAuthEmail(credentials.username), password: authHelpers.staffAuthPassword(credentials.pin) }),
    }), `${role} login`);
    token = login?.access_token;
    requireTrue(typeof token === "string" && token.length > 0, `${role}: no Auth token`);
    const user = api(key, token);
    const identity = successful(await user("/auth/v1/user"), `${role} verified user`);
    requireTrue(identity?.id, `${role}: missing verified user`);
    requireTrue(successful(await user("/rest/v1/rpc/app_session_valid"), `${role} session`) === true, `${role}: inactive session`);
    requireTrue(successful(await user("/rest/v1/rpc/app_staff_role"), `${role} database role`) === role, `${role}: verified database role mismatch`);
    const profile = successful(await user(`/rest/v1/staff_users?select=id,username,role,is_active&auth_user_id=eq.${encodeURIComponent(identity.id)}`), `${role} profile`);
    requireTrue(Array.isArray(profile) && profile.length === 1 && profile[0].is_active === true && profile[0].role === role && profile[0].username.toLowerCase() === credentials.username.toLowerCase(), `${role}: active linked profile mismatch`);
    pass(`${role}: real Auth login, active session and database role`);
    for (const table of ["guests", "reservations", "visits", "invoices", "invoice_payments", "members"]) {
      const rows = successful(await user(`/rest/v1/${table}?select=id&limit=1`), `${role} ${table}`);
      requireTrue(Array.isArray(rows), `${role} ${table}: expected rows`);
      pass(`${role}: ${table} read endpoint`);
    }
    const peers = successful(await user(`/rest/v1/staff_users?select=id&auth_user_id=neq.${encodeURIComponent(identity.id)}&limit=1`), `${role} staff directory`);
    requireTrue(Array.isArray(peers) && (role === "admin" ? peers.length > 0 : peers.length === 0), `${role}: staff directory visibility mismatch`);
    pass(`${role}: staff directory isolation`);
  } finally {
    if (token) {
      const logout = await api(key, token)("/auth/v1/logout?scope=local", { method: "POST" });
      requireTrue(logout.ok, `${role}: test-session logout failed (HTTP ${logout.status})`);
    }
  }
}

async function main() {
  const branch = execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
  safety.assertBranch(branch, process.env);
  const envFile = path.join(root, ".env.demo");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  safety.assertBranch(branch, process.env);
  safety.assertProject(process.env.DEMO_SUPABASE_URL || safety.SUPABASE_URL);
  const args = process.argv.slice(2);
  requireTrue(args.every(arg => ["--check", "--public"].includes(arg) || arg.startsWith("--roles=")), "Unknown demo runner argument.");
  requireTrue(args.filter(arg => arg.startsWith("--roles=")).length <= 1, "Specify roles once.");
  if (args.includes("--check")) {
    console.log(`Demo guard passed on ${branch}; project ${safety.PROJECT}. No network requests made.`);
    return;
  }
  const roles = args.includes("--public") ? [] : (args.find(arg => arg.startsWith("--roles="))?.slice(8).split(",") || safety.ROLES);
  requireTrue(new Set(roles).size === roles.length && roles.every(role => safety.ROLES.includes(role)), "Unknown or duplicate demo role.");
  const accounts = {};
  for (const role of roles) {
    const prefix = "DEMO_" + role.toUpperCase();
    const username = process.env[prefix + "_USERNAME"]?.trim();
    const pin = process.env[prefix + "_PIN"];
    requireTrue(username && /^\d{4}$/.test(pin || ""), `Configure ${prefix}_USERNAME and a four-digit ${prefix}_PIN in ignored .env.demo; do not paste PINs into chat.`);
    accounts[role] = { username, pin };
  }
  requireTrue(new Set(Object.values(accounts).map(account => account.username.toLowerCase())).size === roles.length, "Each role needs its own account.");
  console.log(`Demo only: ${safety.PROJECT}; branch ${branch}; ${roles.length}/5 roles requested.`);
  for (const url of safety.PAGES) {
    const page = await request(url);
    successful(page, "demo page");
    requireTrue(/<html\b/i.test(page.text), "Demo route did not return HTML.");
    // Public pages declaring their own client must agree with the approved target.
    const target = page.text.match(/const\s+SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
    if (target) safety.assertProject(target);
    pass(`HTTP page: ${url}`);
  }
  const config = await request(safety.CONFIG_URL);
  successful(config, "published config");
  const publishedKey = safety.publishedConfig(config.text);
  const key = process.env.DEMO_SUPABASE_ANON_KEY || publishedKey;
  safety.assertPublicKey(key);
  pass("published dashboard config points to approved demo Supabase");
  await publicChecks(key);
  const authHelpers = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, "js/staff-auth.js"), "utf8"), authHelpers);
  for (const role of roles) await roleChecks(key, role, accounts[role], authHelpers);
  console.log(`\n${passed} checks passed; ${roles.length}/5 roles exercised. Read/access baseline only: business writes, positive guest tokens and browser journeys remain untested.`);
}

main().catch(error => { console.error("FAIL " + error.message); process.exitCode = 1; });
