const PROJECT = "hkrhsubhfqrgqkuhpvql";
const SUPABASE_URL = `https://${PROJECT}.supabase.co`;
const PAGES = Object.freeze([
  "https://dashboard.intoch.app/",
  "https://reserve.intoch.app/reserve",
  "https://dashboard.intoch.app/spin",
  "https://reserve.intoch.app/reservation-created",
]);
const CONFIG_URL = "https://dashboard.intoch.app/js/config.js";
const ROLES = Object.freeze(["admin", "manager", "staff", "finance", "owner"]);

function assertBranch(branch, env = {}) {
  const refs = [branch, env.GITHUB_REF_NAME, env.GITHUB_HEAD_REF, env.GITHUB_BASE_REF, env.CF_PAGES_BRANCH];
  if (refs.some(ref => /(^|\/)release($|\/)/i.test(ref || ""))) {
    throw new Error("Demo tests refuse release branches and release pull requests.");
  }
  if (branch !== "main" && !/^test\/demo-api-regression(?:-[a-z0-9-]+)?$/.test(branch)) {
    throw new Error("Demo tests require main or a test/demo-api-regression branch; detached HEAD is refused.");
  }
}

function assertProject(value) {
  if (value !== SUPABASE_URL) throw new Error("Supabase target does not match the approved demo project.");
}

function assertPublicKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || "")) return;
  try {
    const parts = key.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (parts.length === 3 && payload.role === "anon" && payload.ref === PROJECT) return;
  } catch { /* Fail without echoing credentials. */ }
  throw new Error("Expected this demo project's public anon/publishable key; privileged keys are refused.");
}

function assertRequest(value, method = "GET") {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error("Unsafe test URL.");
  if (method === "GET" && (PAGES.includes(url.href) || url.href === CONFIG_URL)) return;
  if (url.origin !== SUPABASE_URL) throw new Error("Request outside approved demo targets refused.");
  if (method === "GET" && url.pathname.startsWith("/rest/v1/")) return;
  if (method === "GET" && url.pathname === "/auth/v1/user") return;
  if (method === "POST" && url.pathname === "/auth/v1/token" && url.search === "?grant_type=password") return;
  if (method === "POST" && url.pathname === "/auth/v1/logout" && url.search === "?scope=local") return;
  throw new Error("This first-stage runner permits reads and its own Auth login/logout only.");
}

function publishedConfig(source) {
  // Parse literals only. Never evaluate downloaded JavaScript.
  const project = source.match(/const\s+SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  const key = source.match(/const\s+SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
  assertProject(project);
  assertPublicKey(key);
  return key;
}

module.exports = { PROJECT, SUPABASE_URL, PAGES, CONFIG_URL, ROLES, assertBranch, assertProject, assertPublicKey, assertRequest, publishedConfig };
