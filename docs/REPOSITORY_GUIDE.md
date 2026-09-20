# Folder guide and housekeeping inventory

Inventory: 2026-09-20. The tracked repository had 259 files at the start of this pass.
No live project, saved client configuration or external asset consumers were inspected.

| Location | Classification | Housekeeping decision |
|---|---|---|
| Root HTML, `js/`, `css/`, `assets/` | Website and source templates | Keep paths stable; HTML, scripts and saved settings can depend on them. |
| `build-config.js`, `package.json`, dotfiles | Build, dependencies and upload rules | Keep at root. Git exclusions and upload exclusions have different jobs. |
| Generated HTML and `js/config.js` | Ignored per-client build output | Preserve the local build; edit templates instead. |
| `node_modules/` | Ignored installed dependencies | Keep for local tooling; not source clutter to commit or publish. |
| `tests/`, `js/*.test.js` | Existing test suites | Keep both locations until a dedicated test refactor; runner discovers both. |
| `migrations/` | Database history and forward upgrades | Preserve every migration and the documented sequence. Old does not mean disposable. |
| `supabase/functions/` | Server-only account-management source | Keep separate from published assets. |
| `scripts/` | Development and authorized operational utilities | Indexed in scripts/README.md; no automatic execution. |
| `demo/` | Seed/reset tools | Keep separate; destructive reset tools are not release tests. |
| `docs/` | Current guides, manual tooling and screenshots | Indexed in docs/README.md. |
| `docs/history/` | Superseded specifications | Already archived; retain their historical warnings. |
| `reference/` | Unwired promo implementation for future porting | Retain as reference, excluded from publication. |
| Root `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md` | Compatibility links and agent entry points | Keep; the first two direct readers to canonical documents. |

## Artwork requiring a separate usage check

A literal filename search across repository text outside assets found no references to:

- `dashboard-nosidebar.png`
- `dashboard-walkin-blur.png`
- `dashboard-walkin-crop.png`
- `hero-new.png`
- `hero.png`
- `intoch-logo-white.png`
- `membership-nosidebar.png`
- `membership.png`
- `sirkel-new-icon.png`
- `sirkel-new-logo.png`
- `sirkel-oval.png`
- `sirkel.png`

These remain in `assets/`. A source search cannot rule out a saved branding URL, an
external link or a dynamically composed path. Check client settings and external use
before moving them out of the website or deleting them. The landing page still uses
other artwork, including hero-new-group.png, ramai.png and the holographic background.

## Next maintenance work

1. Preserve the repaired baseline: the follow-up investigation resolved all eleven
   failures and all 88 suites passed. See CURRENT_STATE for causes and local-only limits.
2. Add bounded suite execution and explicit missing-dependency reporting to the runner.
   It currently has no timeout and can skip missing jsdom without failing the run.
3. Introduce a separate browser/API regression setup with synthetic test data and an
   identified test Supabase project. The manual screenshot utility is not that suite.
4. Verify client environment inventory and migration state before release promotion.

No files were deleted or moved during this pass. Runtime paths, SQL, generated client
configuration and deployment behavior were preserved. The cleanup focuses on accurate
entry points, tool descriptions and a reviewable inventory of possible future removals.
