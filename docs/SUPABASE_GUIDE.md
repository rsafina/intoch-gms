# How Intoch connects to Supabase

This guide explains the codebase from the browser to the database. It is written for
someone who can read JavaScript but does not need to already know Supabase.

> New to Supabase or not working as a developer? Start with
> [Supabase in Intoch, explained simply](SUPABASE_EXPLAINED_SIMPLY.md). It explains the same
> system without requiring you to read code. Return here only when you need implementation
> details.

## The short answer: do we use an API?

Yes. The staff app and public guest pages use the Supabase JavaScript SDK
(`@supabase/supabase-js` v2). The SDK is a convenient wrapper around several Supabase APIs:

| Code in this repository | Supabase service used | What it does |
|---|---|---|
| `db.from("guests")...` | PostgREST data API | Reads or changes tables and views |
| `db.rpc("function_name", {...})` | PostgREST RPC API | Calls a PostgreSQL function |
| `db.auth...` | Supabase Auth API | Signs staff in and manages their session |
| `db.storage.from("bucket")...` | Supabase Storage API | Uploads or removes images and returns URLs |
| `db.channel(...)` | Supabase Realtime | Listens for database changes |
| `db.functions.invoke(...)` | Supabase Edge Functions | Calls server-side Deno code |

There is no general Intoch application server sitting between the browser and Supabase.
Most requests go directly from the browser to the client's Supabase project. This is a
normal Supabase architecture. Safety comes from Supabase Auth, PostgreSQL Row Level Security
(RLS), grants, guarded database functions and Storage policies—not from hiding the browser
code or the publishable key.

The one checked-in server-side endpoint is the `staff-account` Edge Function. It is used for
account creation and PIN changes because those operations need the secret service-role key.

## System map

```text
Staff browser / public guest page
        |
        | supabase-js v2 + project URL + public anon/publishable key
        v
+--------------------------- Supabase project ----------------------------+
| Auth          PostgREST                Realtime       Storage            |
| staff login   tables/views + RPCs      DB events      image buckets      |
|    |               |                       |               |             |
|    +---------------+------- authenticated JWT -----------+             |
|                    v                                                   |
|              PostgreSQL                                                |
|              tables, views, functions, triggers, RLS and grants         |
|                                                                         |
| Edge Function: staff-account                                            |
| - verifies the caller's JWT and Admin role                              |
| - uses the service-role key only on the server for Auth administration  |
+-------------------------------------------------------------------------+
```

Each client deployment has its own Supabase project. The same frontend source is built with
that client's project URL and public key, so selecting the correct build configuration also
selects the database.

## Where the connection is created

`index.html` loads supabase-js from a CDN, then loads the generated configuration before the
main application scripts:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
...
<script src="js/config.js"></script>
```

The source of the connection setup is `js/config.template.js`:

```js
const SUPABASE_URL = "__SUPABASE_URL__";
const SUPABASE_ANON_KEY = "__SUPABASE_ANON_KEY__";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

`build-config.js` replaces the placeholders at build time and generates `js/config.js` plus
the generated guest pages. Never edit generated `js/config.js` as source. Never place a
service-role or `sb_secret_` key in browser files. The public anon/publishable key is expected
to be visible to users; RLS is the security boundary.

The required build variables are:

- `SUPABASE_URL`: `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY`: the anon or publishable key
- `SITE_URL`: the public site origin used by generated guest links and preview metadata
- `RESTAURANT_NAME`: optional display name

The repository may contain a locally generated `js/config.js`; do not treat its project as
proof of the project connected to a deployed website. Cloudflare settings live outside this
repository and must be checked before deployment.

## What happens when a staff member signs in

1. `loginStaff()` in `js/app.js` converts the username into an internal Auth email and the
   four-digit PIN into the Auth password format.
2. `db.auth.signInWithPassword(...)` asks Supabase Auth to sign in.
3. Supabase stores and refreshes the browser's Auth session. Its access token (JWT) is
   automatically attached to subsequent SDK requests.
4. `restoreVerifiedStaffSession()` in `js/staff-auth.js` calls `db.auth.getUser()`, then the
   `app_session_valid` RPC, then reads the active `staff_users` record linked by
   `auth_user_id`.
5. PostgreSQL helpers derive the staff ID and role from the authenticated user. The role
   cached in localStorage only controls presentation; it is not authorization.
6. A visible app revalidates the session every 15 seconds and on focus, reconnect and Auth
   events. The database still checks permissions independently on every request.

Login therefore establishes identity; it does not give unrestricted database access.

## How queries are written

### Reading a table or view

This code:

```js
const { data, error } = await db
  .from("guests")
  .select("id, name, phone")
  .eq("id", guestId)
  .single();
```

means: query the `guests` table through PostgREST, select only those columns, filter by ID,
and expect exactly one row. Supabase constructs the HTTP request and parses the JSON response.

Common query builders used here are:

| Builder | Meaning |
|---|---|
| `.select("...")` | choose returned columns; nested relations such as `guests(name)` use DB relationships |
| `.eq("column", value)` | column equals value |
| `.in("column", values)` | column is one of the supplied values |
| `.gte(...)`, `.lte(...)`, `.lt(...)`, `.gt(...)` | range filters |
| `.is("voided_at", null)` | SQL-style `IS NULL` |
| `.order("name")` | server-side ordering |
| `.range(from, to)` | pagination; both endpoints are inclusive |
| `.single()` | exactly one row is required |
| `.maybeSingle()` | zero or one row is valid |

Views are queried in exactly the same way as tables. Examples include
`reservation_deposit_balances`, `invoice_balances`, `guest_visit_stats` and
`online_reservation_performance`.

### Inserting, updating and deleting

```js
const { data, error } = await db
  .from("guests")
  .insert(payload)
  .select()
  .single();

const { data, error } = await db
  .from("app_settings")
  .update({ value })
  .eq("key", "financial_tracking")
  .select("value");
```

For important writes, ask for the changed row with `.select()` and verify that it exists.
An HTTP-level success can still affect zero rows when a filter matched nothing. The project
has historical write paths that do not yet all follow this rule, so copy a verified modern
write rather than assuming every older call is the ideal pattern.

Deletes such as `db.from("reservation_exceptions").delete()...` are also direct PostgREST
requests, but they only work when the caller's database role and RLS policy allow them.

### The shared error wrapper

`supabaseQuery()` in `js/config.template.js` runs a supplied SDK query, catches thrown network
errors, normalizes returned Supabase errors and logs a feature-specific message:

```js
const { data, error } = await supabaseQuery(
  () => db.from("areas").select("*").order("name"),
  "Failed to load areas",
);
```

It does not grant access, retry writes or turn an unsuccessful write into a success. The
calling function still decides what the UI should do with `error` or missing `data`. Its
optional development cache is only for fixed-shape read queries.

## Direct table query or RPC?

An RPC is a PostgreSQL function exposed through PostgREST:

```js
const { data, error } = await db.rpc("record_invoice_payment", {
  p_invoice_id: invoiceId,
  p_amount: amount,
  p_method: method,
});
```

Use a direct `.from(...)` query for a simple read or a simple write whose complete security
rule is correctly enforced by table policies/triggers. Use an RPC when an operation must be
atomic, validate business rules, coordinate several tables, lock against concurrent changes,
derive the verified actor, or expose a very narrow public action.

Important RPC examples in the current app include:

| RPC | Purpose |
|---|---|
| `record_reservation_arrival` | atomically records a real arrival without duplicate visits |
| `save_visit_spending` | saves final spending and completes the linked reservation atomically |
| `record_invoice_payment` / `record_deposit_payment` | records ledger entries under payment rules |
| `set_reservation_deposit_request` / `waive_deposit` | changes guarded deposit state |
| `reservation_table_availability` / `area_availability` | applies shared capacity logic |
| `add_member_transaction` / voucher RPCs | applies loyalty and redemption rules |
| `set_reservation_followup` | acknowledges notification work using the verified actor |
| `app_session_valid` | checks that the current staff session remains operational |
| token lookup RPCs | return a deliberately narrow field set to public guest pages |

The browser's parameter names must match the SQL function arguments. To understand an RPC,
search both its JavaScript call and its final SQL definition. Some functions are redefined by
later migrations, so the last applied definition in the actual client database is what runs.

## Where security is enforced

There are several layers, and they do different jobs:

1. **UI visibility** hides pages and buttons for convenience. It is not security.
2. **Supabase Auth** proves which Auth user owns the JWT.
3. **PostgreSQL grants** decide which operations/functions the API roles can attempt.
4. **RLS policies** filter or reject rows for direct table operations.
5. **Guarded functions and triggers** enforce cross-row, role, payment, capacity and state
   transition rules inside database transactions.
6. **Storage policies** control bucket/object access.
7. **The Edge Function** protects operations requiring server-only Auth administration.

After role enforcement, database helpers link `auth.uid()` to `staff_users.auth_user_id` and
derive the real role/staff ID. Never accept a role from localStorage, a form field or a caller
argument as proof of authority. Public guest pages run as the anonymous API role and receive
only selected configuration reads and narrow submission/token RPC access.

`app_private` contains protected implementations and helpers. Public wrapper functions expose
only the intended operation. `SECURITY DEFINER` functions must use pinned search paths and
strict execute grants; adding one casually can bypass otherwise-correct RLS.

## Storage, Realtime and the Edge Function

### Storage

Images are uploaded with calls such as:

```js
await db.storage.from(BRAND_BUCKET).upload(path, file, options);
const { data } = db.storage.from(BRAND_BUCKET).getPublicUrl(path);
```

The app uses buckets for branding, featured dishes and campaign images. A public URL means
the object can be read publicly; upload/delete permissions are still controlled separately by
Storage policies. QRIS/payment branding has stricter Admin rules.

### Realtime

`js/app.js` and `js/notify.js` create channels and listen to PostgreSQL change events. This is
how dashboard/notification data can refresh quickly, but timers, focus and reconnect refreshes
remain fallbacks. Realtime is an update signal, not the source of truth: handlers query the
database again.

Every channel must be removed on logout. Reusing an already-subscribed channel can throw and
prevent later initialization code from running.

### `staff-account` Edge Function

The browser calls:

```js
await db.functions.invoke("staff-account", { body: payload });
```

`supabase/functions/staff-account/index.ts` runs on Supabase's server. It verifies the bearer
token, requires an active Admin with a valid session, and uses the caller-scoped client for
ordinary database writes. Only its server-side admin client holds the service-role key, used
to create Auth users or update passwords. That key must never enter the browser, repository,
logs or static hosting variables.

This is the exception to the mostly browser-to-database architecture, not a general backend.

## How JavaScript, SQL migrations and deployment fit together

Changing JavaScript does not change the database. Changing a migration file does not change
any Supabase project until someone intentionally applies that SQL to that project. Deploying
the frontend does not automatically apply migrations or deploy the Edge Function.

```text
repository JavaScript --build/deploy--> Cloudflare static site
repository migration --review/apply--> one chosen Supabase PostgreSQL database
Edge Function source --function deploy--> one chosen Supabase Functions project
```

For a database change:

1. Identify whether the target is a fresh client or an already-secured client.
2. Read `migrations/README.md` and the migration's dependencies.
3. Add a targeted, rerunnable-forward migration where appropriate; do not edit history as if
   that updates deployed projects.
4. Preserve `app_private` implementations, public wrappers, RLS, grants and pinned search
   paths.
5. Test SQL/RLS as the real roles with the PGlite harnesses.
6. Apply only to the explicitly authorized Supabase project and verify the result there.
7. Deploy compatible frontend/Edge Function code only after required SQL is present.

Never rerun `ALL_IN_ONE.sql` or `20260911_roles_enforce.sql` on a secured database. Do not
apply migration filenames blindly in date order; later secured wrappers can be damaged by
replaying older feature SQL.

## Adding a new data operation safely

Before writing a query, answer these questions:

1. Who should be allowed: anonymous guest, Staff, Finance, Manager, Admin or Owner?
2. Is this a read, a simple single-table write, or a multi-step business transaction?
3. What RLS policy, grant, trigger or RPC proves that permission in PostgreSQL?
4. Could two tills perform it at once? If yes, concurrency belongs in PostgreSQL.
5. Does the write return and verify a changed row or an explicit RPC success result?
6. Does it need to exclude `voided_at` rows or require a real visit?
7. Could an old browser session finish after logout/account switching? Guard stale results.
8. What test exercises the operation as each relevant database role?

A safe read usually looks like:

```js
const { data, error } = await supabaseQuery(
  () => db.from("example_view").select("id, label").eq("active", true),
  "Failed to load examples",
);
if (error) {
  toast("Could not load examples", "error");
  return;
}
```

A safe direct write requests evidence:

```js
const { data, error } = await supabaseQuery(
  () => db.from("example_table")
    .update({ label })
    .eq("id", id)
    .select("id, label")
    .single(),
  "Failed to save example",
);
if (error || !data) {
  toast("Could not save example", "error");
  return;
}
```

For money, capacity, arrival/completion, membership, role changes or several dependent
writes, design a guarded RPC rather than coordinating the transaction in browser JavaScript.

## How to trace or debug an existing query

1. Start at the button, form handler or loader in `index.html`/`js/*.js`.
2. Search for `.from("object")`, `.rpc("function")`, `.storage` or `.functions.invoke`.
3. For an RPC/view/policy, search `migrations/` for every definition, then determine which
   targeted migrations are actually applied to the client. Repository code alone cannot
   prove live migration state.
4. In the browser Network panel, look for requests to the client's `supabase.co` domain:
   `/rest/v1/` for tables/views/RPCs, `/auth/v1/`, `/storage/v1/`, `/realtime/v1/` or
   `/functions/v1/`.
5. Inspect the returned HTTP status and JSON error. Common PostgreSQL codes include `42501`
   (permission/RLS) and `42703` (missing column/schema mismatch).
6. Confirm the page is connected to the intended project URL, but never paste tokens or secret
   keys into tickets, chat, screenshots or logs.
7. Reproduce using the affected role. An Admin success does not prove Staff or Finance access.
8. Check for a returned row/RPC result, not only the absence of a network error.

Do not fix a failed write by granting broad table access, disabling RLS or moving a secret key
into frontend code. First establish whether the failure is a missing migration, incorrect
role policy, wrong filter, protected trigger/helper permission, stale session or wrong client
project.

## Main files to read next

| File | Why it matters |
|---|---|
| `docs/ARCHITECTURE.md` | Full feature and security architecture |
| `docs/CURRENT_STATE.md` | What is implemented versus not verified/deployed |
| `docs/DEVELOPMENT_RULES.md` | Defect-derived coding and query rules |
| `migrations/README.md` | Canonical migration order and safety rules |
| `docs/deployment/ROLE_ROLLOUT.md` | Auth/RLS rollout and role verification |
| `js/config.template.js` | Client creation, shared query wrapper and configuration |
| `js/staff-auth.js` | Session restoration and continuous validation |
| `js/app.js` | Most table queries and core workflows |
| `supabase/functions/staff-account/index.ts` | The only checked-in server-side endpoint |
| `migrations/20260911_roles_enforce.sql` | Core secured-role/RLS boundary |

The most useful mental model is: **the frontend asks; PostgreSQL decides**. The SDK makes the
request pleasant to write, but database policies and guarded functions must remain correct
even if somebody calls the same API without using the Intoch interface.
