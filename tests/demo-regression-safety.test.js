const assert = require("node:assert/strict");
const { assertBranch, assertProject, assertPublicKey, assertRequest, publishedConfig, SUPABASE_URL, PROJECT, PAGES, CONFIG_URL } = require("../scripts/demo-regression/safety");

for (const branch of ["main", "test/demo-api-regression", "test/demo-api-regression-fixtures"]) assert.doesNotThrow(() => assertBranch(branch));
for (const branch of ["release", "Release", "refs/heads/release", "", "feature/random"]) assert.throws(() => assertBranch(branch));
for (const name of ["GITHUB_REF_NAME", "GITHUB_HEAD_REF", "GITHUB_BASE_REF", "CF_PAGES_BRANCH"]) {
  assert.throws(() => assertBranch("main", { [name]: "release" }));
}
assert.doesNotThrow(() => assertProject(SUPABASE_URL));
for (const target of ["https://production.supabase.co", SUPABASE_URL + "/", SUPABASE_URL + ".evil.test", undefined]) assert.throws(() => assertProject(target));
for (const url of [...PAGES, CONFIG_URL, SUPABASE_URL + "/rest/v1/guests?select=id", SUPABASE_URL + "/auth/v1/user"]) assert.doesNotThrow(() => assertRequest(url));
for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.throws(() => assertRequest(SUPABASE_URL + "/rest/v1/guests", method));
for (const url of [
  "https://production.supabase.co/rest/v1/guests",
  SUPABASE_URL + ".evil.test/rest/v1/guests",
  "https://user:password@hkrhsubhfqrgqkuhpvql.supabase.co/rest/v1/guests",
  SUPABASE_URL + "/rest/v1/../../auth/v1/admin/users",
  "https://dashboard.intoch.app/unknown", SUPABASE_URL + "/functions/v1/staff-account",
]) assert.throws(() => assertRequest(url));
assert.doesNotThrow(() => assertRequest(SUPABASE_URL + "/auth/v1/token?grant_type=password", "POST"));
assert.doesNotThrow(() => assertRequest(SUPABASE_URL + "/auth/v1/logout?scope=local", "POST"));
assert.throws(() => assertRequest(SUPABASE_URL + "/auth/v1/logout?scope=global", "POST"));
assert.throws(() => assertRequest(SUPABASE_URL + "/auth/v1/signup", "POST"));

const jwt = payload => "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".test";
assert.doesNotThrow(() => assertPublicKey(jwt({role:"anon",ref:PROJECT})));
assert.doesNotThrow(() => assertPublicKey("sb_publishable_test"));
for (const key of [undefined, "", "sb_secret_test", jwt({role:"service_role",ref:PROJECT}), jwt({role:"authenticated",ref:PROJECT}), jwt({role:"anon",ref:"other-project"})]) assert.throws(() => assertPublicKey(key));
const config = `const SUPABASE_URL = "${SUPABASE_URL}"; const SUPABASE_ANON_KEY = "sb_publishable_test"; throw new Error('must not execute');`;
assert.equal(publishedConfig(config), "sb_publishable_test");
assert.throws(() => publishedConfig(config.replace(SUPABASE_URL, "https://production.supabase.co")));
assert.throws(() => publishedConfig(config.replace("sb_publishable_test", "sb_secret_test")));
assert.throws(() => publishedConfig("<html>Unavailable</html>"));
console.log("Demo guards: branch, CI release refs, exact project, network destinations, read-only methods and credential validation passed");
