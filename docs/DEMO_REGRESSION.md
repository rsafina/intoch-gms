# Demo API regression: first stage

Approved demo targets supplied by the user on 2026-09-20:

| Purpose | Target |
|---|---|
| Dashboard | https://dashboard.intoch.app/ |
| Reservation form | https://reserve.intoch.app/reserve |
| Spin | https://dashboard.intoch.app/spin |
| Reservation created | https://reserve.intoch.app/reservation-created |
| Supabase | https://hkrhsubhfqrgqkuhpvql.supabase.co |

These are the explicit test allowlist, not a verified mapping of hosting branches.
Live clients on release must never be a regression-test target.

## Commands

Use Node 22 or newer and installed repository dependencies. On PowerShell, `npm.cmd`
avoids the execution-policy restriction on npm.ps1.

```text
npm run test:demo:check
npm run test:demo:public
npm run test:demo:access -- --roles=admin,manager,staff
npm run test:demo:access
```

- `check`: local branch/project guard only; no network requests.
- `public`: deployed page HTTP checks, published configuration target, public config
  reads, anonymous private-table access and invalid invoice/ticket token lookups.
- `access -- --roles=...`: the public checks plus actual Auth sessions, linked active
  roles, session-validity RPC, representative table reads and staff directory isolation.
- `access` without a subset requires all five roles. Missing credentials fail before
  network access, rather than silently skipping a role. A subset is explicitly partial.

Copy root `.env.example` to `.env.demo` and enter PINs locally. Both Git and asset upload
rules exclude `.env.demo`. Never paste PINs, Auth tokens or server keys into chat/logs.
Admin `rere`, Manager `sitops` and Staff `resa` were supplied by the user. Finance and
Owner usernames are still needed. Use separate accounts per role; do not change an
existing account's role or reset its PIN to make a test pass.

The public anon/publishable key is read from the dashboard's published config after
verifying its Supabase URL; an optional local public-key override is supported. Downloaded
JavaScript is parsed for constants, never executed. Privileged keys are refused. Only user
session JWTs go in the bearer header for publishable-key projects, following
[Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

## Boundaries and evidence

The runner permits only `main` and `test/demo-api-regression` branches (with optional
hyphenated suffixes), refuses release refs including CI PR base refs, and fails on detached
HEAD. Every request is checked against exact demo targets. Redirects are refused, requests
time out after 15 seconds, and raw response bodies/credentials are not logged.

This first stage allows only reads and its own Auth password login/local logout. It cannot
insert, update or delete business records, invoke write RPCs, create accounts or apply SQL.
Auth tests create real temporary login sessions and revoke only those sessions afterward.
The public command needs no accounts. `npm test` stays offline and never invokes this runner.

A passing empty anonymous query proves no rows were returned for that query; on an empty
table it does not establish RLS correctness. Authenticated table reads may also legitimately
return no rows. Positive seeded fixtures and denied-write tests are the next stage.
Page HTML/HTTP checks do not execute JavaScript or prove guest workflows work. No claim is
made yet about successful public booking/spin, valid document tokens, financial writes,
session invalidation, Storage, Realtime or browser journeys. Passing against the demo does
not prove client migration/deployment state or that deployed demo code matches this checkout.

## Next stage

1. Finish all five account credentials and run the role baseline.
2. Add uniquely identified synthetic fixtures, successful and forbidden operations, and
   cleanup restricted to exact IDs created by each run. Never wipe the whole demo.
3. Exercise public booking, arrival/completion, deposits and valid guest tokens through APIs.
4. Add Playwright against the same approved targets and report unexpected network/JS errors.
5. Configure CI explicitly: candidate-branch testing must finish before promotion to release.
   Do not add a release-triggered job or bypass the guard for convenience.
