# Workoutt backend

Go sync backend for the Workoutt PWA. **Most of this is Phase 3 work** — the
client (frontend/) is local-first and fully functional without this server.

## What lives here now (Phase 1)

- `sql/schema.sql` — the canonical schema DDL. This is the single source of
  truth for the data model; the frontend's IndexedDB stores
  (`frontend/src/lib/db/types.ts`) mirror it 1:1. It is written to be
  sqlc-ready for Phase 3.
- `main.go` — toolchain stub with a `/healthz` route (slog + net/http, no
  framework).

## Phase 3 scope (see ../plan.md)

- sqlite DB managed with sqlc
- `POST /sync/push` — accept client rows, last-write-wins on `updated_at`,
  stamp each accepted row with the next global `server_seq`, return assigned
  values
- `GET /sync/pull?since=<server_seq>` — return all rows (including
  tombstones) newer than the cursor
- Seeding system behind an env var flag
- Backup endpoint serving the sqlite file directly
- No auth: single-user, self-hosted
