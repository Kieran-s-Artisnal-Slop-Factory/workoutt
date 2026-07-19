# Workoutt backend

Go sync backend for the Workoutt PWA. The client (frontend/) is local-first
and fully functional without this server — syncing is optional and adds
cross-device sharing plus a server-side copy of the data.

## Endpoints

- `GET  /healthz` — liveness probe
- `POST /sync/push` — accept client rows (`{"rows": {"<table>": [row…]}}`);
  conflicts resolve last-write-wins on `updated_at`; each accepted row is
  stamped with the next value of the single global `server_seq` counter and
  the assignments are returned
- `GET  /sync/pull?since=<server_seq>` — all rows (tombstones included) with
  `server_seq` greater than the cursor, plus `latestSeq`
- `GET  /backup` — download the sqlite file (WAL-checkpointed first)
- Static frontend serving from `STATIC_DIR` when set (single origin, no CORS
  needed in production; permissive CORS is enabled for separately-hosted
  frontends)

## Configuration (env vars)

| Var          | Default       | Purpose                                  |
| ------------ | ------------- | ---------------------------------------- |
| `PORT`       | `8080`        | listen port                              |
| `DB_PATH`    | `workoutt.db` | sqlite file (put on a volume in Docker!) |
| `STATIC_DIR` | *(unset)*     | serve the built frontend from this dir   |
| `SEED`       | *(unset)*     | `true` seeds sample exercises when empty |

No auth: single-user, self-hosted. Put it behind a reverse proxy with basic
auth if it's ever exposed publicly.

## Design notes

- `sql/schema.sql` is the canonical shared schema; the frontend's IndexedDB
  stores (`frontend/src/lib/db/types.ts`) mirror it 1:1. The server adds only
  the `sync_state` bookkeeping table (see `db.go`).
- sqlite driver is modernc.org/sqlite (pure Go, no cgo) so the binary
  cross-compiles and runs on Alpine.
- The sync engine (`sync.go`) is generic over table metadata rather than
  sqlc-generated typed queries: sync rows are schemaless JSON whose booleans
  and arrays don't map onto sqlc's `sql.Null*` types without per-table
  marshal glue. If the server ever grows real typed queries, adopt sqlc for
  those. **When the schema changes, update `tables` in sync.go alongside
  schema.sql and types.ts.**

## Run

```sh
go run .                          # dev, db in ./workoutt.db

# From the repo root — prebuilt image (frontend+backend on :8080, db
# bind-mounted to ./data on the host):
docker compose up -d
# …or build the image from this checkout:
docker compose -f docker-compose.build.yml up --build
```

Images are published to `ghcr.io/descent098/workoutt` (linux/amd64 +
linux/arm64) by `.github/workflows/docker.yaml` on pushes to master and
`v*` tags.
