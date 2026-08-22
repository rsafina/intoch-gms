# Migrations

Apply in filename order. `00_schema_from_blueheron.sql` first, then the dated files.

These are Blue Heron's real migration history, carried over so no logic is lost. Project
identifiers and site URLs have been replaced with placeholders, so read before running.

**Decide before the first client** whether to keep this history or squash it into one
consolidated schema. Once a client is live on the incremental set, you are maintaining both.

Method that has worked for applying these safely: wrap the whole thing in a single
`DO $$` block with `GET DIAGNOSTICS ROW_COUNT` assertions per statement, run it once ending
in `RAISE EXCEPTION 'DRY RUN OK'` to rehearse and roll back, then re-run without the RAISE.
