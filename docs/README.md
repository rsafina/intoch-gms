# Documentation index

Start with [current state](CURRENT_STATE.md) for completed work, known failures and
outstanding rollout. Repository changes do not establish what is deployed for a client.

| Purpose | Read |
|---|---|
| Find files and understand cleanup decisions | [Repository guide](REPOSITORY_GUIDE.md) |
| Understand implemented behavior | [Architecture](ARCHITECTURE.md) |
| Preserve business and security decisions | [Decisions](DECISIONS.md) |
| Avoid known implementation mistakes | [Development rules](DEVELOPMENT_RULES.md) |
| Understand Supabase | [Plain-language introduction](SUPABASE_EXPLAINED_SIMPLY.md), [developer guide](SUPABASE_GUIDE.md) |
| Understand migration files | [Introduction](MIGRATIONS_EXPLAINED_SIMPLY.md), [canonical sequence](../migrations/README.md) |
| Deploy a client | [Client deployment](deployment/CLIENT_DEPLOY.md), [role rollout](deployment/ROLE_ROLLOUT.md) |
| Review session/spending rollout | [Session and spending handoff](SESSION_SPENDING_ROLLOUT.md) |
| Review dashboard behavior and screenshots | [Management dashboard](MANAGEMENT_DASHBOARD.md) |
| Run repository utilities | [Tooling guide](../scripts/README.md) |
| Run opt-in demo API checks | [Demo regression setup and limits](DEMO_REGRESSION.md) |
| Work with demo data | [Demo guide](../demo/README.md) |

`history/` contains superseded design proposals, not deployment instructions.
`manual/` contains staff-manual generators; `screens/` contains their screenshots and
management UI reference images. These are documentation assets, not automated proof of
current UI behavior. All of `docs/` is excluded by `.assetsignore`.
