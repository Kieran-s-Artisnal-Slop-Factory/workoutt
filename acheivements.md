# Achievements — plan

A plan for an achievements system in Workoutt. Achievements are **derived,
awarded, and persisted**: they are computed from existing workout data, but
once earned they are written to their own store (with the moment they were
earned) so they survive data changes and sync across devices — mirroring how
the app already treats durable facts.

## Goals & principles

- **Local-first, sync-friendly.** Awards live in a new synced store using the
  same envelope as everything else (`id` UUID, `updated_at`, `deleted_at`,
  nullable `server_seq`). No server logic is required to *earn* an
  achievement — the client evaluates and writes the award; sync just carries
  it. This keeps parity with the "PRs are derived, not stored / but awards are
  durable" split.
- **Definitions in code, awards in data.** The *catalogue* of achievements
  (id, title, description, type, threshold, how to measure) is a static table
  shipped in the frontend (`lib/achievements/catalogue.ts`). The *awards* (which
  achievement was earned, when, and for which scope) are rows in IndexedDB.
  Adding/renaming a definition never migrates user data; removing one just
  hides orphan awards.
- **Idempotent evaluation.** Evaluation can run any number of times and only
  ever *adds* missing awards — it never revokes. Re-running after a sync, a
  backup import, or an edit is safe.
- **Cheap and incremental.** Evaluate after the events that can unlock things
  (finishing/editing a workout, finishing a program) and lazily on the
  achievements page. Each evaluation reads the already-loaded aggregates, not
  the whole DB where avoidable.

## The three achievement types

### 1. Account-wide achievements — trigger **once** ever

Earned a single time across the whole account, regardless of exercise or
program. Scope key: the account (there is only one user).

Examples:
- **First steps** — completed your first workout.
- **Getting serious** — set up your first program.
- **Consistency I / II / III** — completed 10 / 30 / 100 total workouts across
  all programs and ad-hoc sessions.
- **Streak** — completed workouts on 7 distinct days within a rolling 7-day
  window (a soft streak; avoids punishing rest days).
- **Well-rounded** — logged at least one workout hitting every body-part group.
- **Bookkeeper** — added an end-of-workout note (ties into the notes feature).

Evaluation input: counts over all completed workouts.

### 2. Per-exercise achievements — trigger **once per exercise**

Earned independently for each exercise, and largely keyed off the exercise's
`measurement_type` so the threshold only applies where it makes sense. Scope
key: `exercise_id`.

By measurement type:
- `weight_reps`, `weight_time` (has weight):
  - **One tonne** — 1,000 kg of cumulative volume (Σ weight × reps) on this
    exercise. Tiers: 1 t / 10 t / 50 t.
  - **Century** — 100 completed sets of this exercise.
- `reps` (bodyweight):
  - **Rep machine** — 1,000 / 10,000 cumulative reps.
- `time`, `weight_time`, `distance_time` (has time):
  - **Time under tension** — 1 hour / 10 hours cumulative time on this exercise.
- `distance`, `distance_time` (has distance):
  - **Long hauler** — 42.2 km (a marathon) / 100 km cumulative distance.
- Any type:
  - **Ten-timer** — performed this exercise in 10 separate completed workouts.

Because the threshold set is chosen from the exercise's measurement type, a
running exercise never shows a "volume" achievement and a bench press never
shows a "distance" one. A definition declares which measurement types it
applies to; evaluation skips definitions that don't match the exercise.

### 3. Per-program achievements

Two sub-kinds, distinguished by their scope key:

**(a) Once per program *iteration*** — scope key: `program_id` (a specific run
of a program). Re-running the same program template creates a new `program_id`,
so these can be earned again for the new iteration.
- **Volume block** — lifted 1 tonne of total volume across all
  `weight_reps`/`weight_time` exercises during *this* run of the program.
- **Full house** — completed every scheduled workout of the program iteration
  (0 skipped).
- **Trimmed down / bulked up** — net body-weight change of ≥ X within the
  iteration's date window (ties into the per-program weight-change work).

**(b) Once per program *for the lifetime of the program template*** — scope
key: `program_template_id` (all iterations of that program, ever). Earned a
single time no matter how many iterations run.
- **Repeat offender** — ran this program 2 / 3 / 5 times (counts distinct
  iterations of the template).
- **Long hauler (program)** — accumulated 12 total weeks across all iterations
  of this program.

For iteration-scoped achievements the date window is `program.started_on …
program.ends_on` (or last completed workout, whichever is later), matching the
"By Program" records feature.

## Data model

New synced store `achievement_awards` (add to `STORES`, `schema.sql`,
`sync.go` table metadata):

```
achievement_awards
  id            TEXT  UUID (PK)
  achievement   TEXT  catalogue id, e.g. 'one_tonne', 'first_workout'
  scope_type    TEXT  'account' | 'exercise' | 'program' | 'program_template'
  scope_id      TEXT  '' for account; exercise_id / program_id /
                      program_template_id otherwise
  tier          INTEGER  0 for single-tier; 1,2,3… for tiered thresholds
  earned_at     TEXT  UTC ISO 8601 — the moment it was awarded
  value         REAL  the measured value at award time (e.g. 1000 for 1 t) —
                      handy for display, not required for uniqueness
  updated_at, deleted_at, server_seq   (standard sync fields)
```

Uniqueness is the tuple **(achievement, scope_type, scope_id, tier)**. Before
inserting, evaluation checks whether that tuple already exists; if so it does
nothing. (An IndexedDB index on a composite `achievement|scope_id|tier` string
makes the check O(1); LWW on `updated_at` keeps sync deterministic if two
devices award the same thing.)

The **catalogue** (code, not data):

```ts
interface AchievementDef {
  id: string;
  title: string;
  description: string;
  scope: 'account' | 'exercise' | 'program' | 'program_template';
  measurementTypes?: MeasurementType[]; // per-exercise: which types it applies to
  tiers: { tier: number; threshold: number; label?: string }[]; // 1+ tiers
  // metric(scopeAggregate) -> current numeric value; compared against thresholds
  metric: keyof ScopeAggregate;
}
```

## Evaluation

A single `evaluateAchievements()` pass:

1. Build aggregates from completed workouts + sets (reuse the record-derivation
   pass so we don't scan twice):
   - **account aggregate**: total workouts, distinct training days, whether a
     program exists, body-parts covered, notes-added flag.
   - **per-exercise aggregate** (`Map<exerciseId, {volumeKg, reps, seconds,
     distanceKm, sets, workouts}>`).
   - **per-program aggregate** (`Map<programId, {volumeKg, scheduled, skipped,
     weightChange, weeks}>`) and **per-template aggregate**
     (`Map<templateId, {iterations, totalWeeks}>`).
2. For each catalogue definition, for each relevant scope, for each tier whose
   threshold is met: if no award row exists for that (achievement, scope, tier),
   insert one with `earned_at = now`, `value = current`.
3. Collect the newly-inserted awards and return them so the UI can show a
   "🏅 Achievement unlocked" toast/modal (reusing the post-workout summary
   modal pattern).

**When it runs:**
- After `finishWorkout` / editing a completed workout (covers account +
  per-exercise + iteration-scoped).
- After a program completes/abandons and after `updateProgram`
  (template-lifetime + iteration wrap-up).
- Lazily when the Achievements page mounts (backfills anything missed, e.g.
  awards that should exist for pre-feature data).

**Backfill:** because evaluation is idempotent and reads historical data, the
first run after shipping simply awards everything already earned, stamped
`earned_at = now` (we can't know the true historical moment without more
bookkeeping; acceptable, and noted in the UI as "first detected").

## UI (later, not in this doc's scope to build)

- A new **Achievements** page: account achievements up top, then per-exercise
  (grouped/searchable like records), then per-program (grouped by program with
  an iteration/template split). Locked achievements shown greyed with progress
  bars (`value / threshold`); earned ones show the date.
- Unlock notification reusing the existing modal/summary component after a
  workout or program finishes.

## Open questions / decisions to confirm before building

- **Tier storage:** one award row per tier (chosen above) vs. one row per
  achievement with a `maxTier` field. Per-tier rows make "unlocked on" dates
  per tier possible and keep uniqueness simple — recommended.
- **Streak semantics:** rolling-window vs. strict consecutive days. Rolling is
  gentler and rest-day friendly — recommended default.
- **Historical `earned_at`:** accept "first detected" for backfilled awards, or
  invest in reconstructing the true unlock moment by replaying workouts in date
  order (more expensive). Recommend "first detected" for v1.
- **Units in thresholds:** thresholds are stored in canonical units (kg, km,
  seconds); the UI converts to the user's display units, same as everywhere.
