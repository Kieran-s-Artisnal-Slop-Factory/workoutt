# Seeding

Every way data gets pre-populated, and how to modify each one. There are
four distinct seeding mechanisms — don't confuse them:

| Mechanism | Trigger | Source | Audience |
| --- | --- | --- | --- |
| Preset exercise library | Wizard checkbox, exercises-page empty state | `frontend/src/lib/planPresets.ts` | end users |
| Guided plan generation | Setup-program wizard | `frontend/src/lib/planPresets.ts` | end users |
| Dev sample data (simple/heavy) | Settings → developer options | `frontend/src/lib/db/seed.ts` | developers |
| Backend seed | `SEED=true` env var | `backend/seed.go` | server operators |

## 1. Preset exercise library (`planPresets.ts`)

`allPresetExercises()` returns the de-duplicated union of every guided
plan's exercises (~40). It is the "default exercises" catalogue and is
consumed in two places:

- **Setup wizard** — the step-1 "Add Unused Exercises to Database"
  checkbox seeds the full catalogue at commit, and makes it selectable in
  step 2 (`SetupProgramApp.svelte`).
- **Exercises page** — when the library is empty, a
  "Load default exercises" button seeds the catalogue
  (`ExercisesApp.svelte`).

Both paths **reuse by name** (case-insensitive): an exercise that already
exists is never duplicated. To change this content, edit the plan
definitions — see [onboarding.md](./onboarding.md#default-content-planpresetsts).

## 2. Guided plan generation

Not seeding in the strict sense — `generatePlan(type, experience)` builds
an in-memory working set for the wizard, and rows are only written when
the user commits step 3. Covered in [onboarding.md](./onboarding.md).

## 3. Dev sample data (`frontend/src/lib/db/seed.ts`)

Triggered from Settings → developer options (gated behind typing a
confirmation phrase once per browser session — see `DEV_MODE_KEY` in
`SettingsApp.svelte`). Entry point:

```ts
seedSampleData(type: 'simple' | 'heavy')
```

Both refuse to run when any exercises already exist ("Seed skipped…"), so
they can't corrupt a real dataset. Clear site data (or use the Settings
danger zone) first.

### `seedSimple()`

A realistic small dataset so every page has something to render: a handful
of named exercises (bench, squat, deadlift…), Push/Pull/Legs-style
templates, a program with some completed history, and body-weight entries.
It drives the real services (`startProgram`, `startWorkout`,
`finishWorkout`) where practical, so seeded data goes through the same
code paths as user data.

### `seedHeavy()`

Deliberately oversized to exercise every pagination limit:

- 300 exercises (exercises page paginates at 250),
- 300 completed workouts (history paginates at 250),
- 60 record-bearing exercises (records page paginates at 45),
- 3 programs — 2 completed, 1 active — each with its own program template,
  scheduled future workouts for the active one, and a year of weekly
  body-weight entries.

Rows are built directly and inserted with `bulkPut` **instead of** going
through the workout services — the services would be far too slow at this
volume. That means heavy-seed code must keep field shapes in sync with the
model by hand; when you add a synced field, check whether the heavy seed
needs to set it.

### Modifying the dev seeds

- Keep the "refuses when exercises exist" guard — pages assume seeds never
  merge into live data.
- `simple`: prefer driving services over hand-built rows; it doubles as an
  integration exercise of the domain logic.
- `heavy`: keep the counts above each page's pagination limit (they exist
  to test exactly that), and prefer `bulkPut` for anything in a loop.
- Dates are anchored relative to "today" (`todayLocal()` + `addDays`) so
  the seeded calendar always looks current; keep new data relative, never
  hard-coded.

## 4. Backend seed (`backend/seed.go`)

`SEED=true` (env var or the commented line in `docker-compose.yml`) seeds
sample **exercises** into the server database on startup, only when the
exercises table is empty. Useful to give a brand-new server something to
serve before any client pushes. Clients receive the rows on their next
pull like any other synced data.

Keep the row shapes aligned with `backend/sql/schema.sql` — the seed
writes SQL directly.
