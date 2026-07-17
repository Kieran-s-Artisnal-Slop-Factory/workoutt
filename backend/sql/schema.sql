-- Workoutt schema — canonical data model.
--
-- This DDL is the single source of truth. The frontend's IndexedDB object
-- stores (frontend/src/lib/db/types.ts) mirror these tables 1:1 by field
-- name. Written to be sqlc-ready for the Phase 3 sync backend.
--
-- Sync design (see plan.md "Key decisions"):
--   * id          TEXT UUID primary key, generated client-side (offline-safe)
--   * updated_at  UTC ISO 8601, client-set; conflict resolution is
--                 last-write-wins on this field
--   * deleted_at  UTC ISO 8601 tombstone; rows are never hard-deleted so
--                 deletions sync
--   * server_seq  server-assigned monotonic integer from ONE global counter,
--                 stamped on push; the sync cursor. NULL until the server
--                 first accepts the row. Wall-clock time is never used as
--                 the cursor.
--
-- Date conventions: scheduled/calendar fields are local dates 'YYYY-MM-DD';
-- record-keeping fields (updated_at, started_at, completed_at, deleted_at)
-- are UTC ISO 8601 timestamps.
--
-- Units: weights are stored in kg, distances in km, durations in seconds.
-- Display units (kg/lbs, km/mi) are a user_profile preference applied at
-- render time only.
--
-- Personal records are NOT stored — they are derived from workout_sets.

-- Single row: the user (single-user app, but a table keeps sync uniform).
CREATE TABLE user_profile (
    id                       TEXT PRIMARY KEY,
    name                     TEXT,  -- used for the personal greeting
    highlighted_exercise_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of exercise ids
                                   -- pinned to the "Highlighted PRs" section;
                                   -- deleting an exercise removes its id here
    display_weight_unit      TEXT NOT NULL DEFAULT 'kg'
                             CHECK (display_weight_unit IN ('kg', 'lbs')),
    display_distance_unit    TEXT NOT NULL DEFAULT 'km'
                             CHECK (display_distance_unit IN ('km', 'mi')),
    age_years                INTEGER,
    height_cm                REAL,
    experience_level         TEXT
                             CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
    weight_tracking_enabled  INTEGER NOT NULL DEFAULT 0,  -- boolean
    weight_chart_months      INTEGER NOT NULL DEFAULT 3,   -- months shown on the weight chart; 0 = all time
    -- Pet collection game (see pets.md). pets_started_at marks the first
    -- opt-in ever (NULL = never); pets_enabled is the live toggle.
    pets_enabled             INTEGER NOT NULL DEFAULT 0,  -- boolean
    pets_started_at          TEXT,                        -- UTC ISO 8601
    active_pet_id            TEXT,                        -- REFERENCES pets(id); the XP recipient
    pets_banked_xp           INTEGER NOT NULL DEFAULT 0,  -- XP accrued while disabled
    pets_allow_duplicates    INTEGER NOT NULL DEFAULT 0,  -- boolean; let eggs hatch owned species again
    onboarding_completed_at  TEXT,                        -- UTC ISO 8601
    updated_at               TEXT NOT NULL,
    deleted_at               TEXT,
    server_seq               INTEGER
);

-- Body weight log (optional weight loss/gain tracking).
CREATE TABLE body_weight_entries (
    id           TEXT PRIMARY KEY,
    weight_kg    REAL NOT NULL,
    measured_on  TEXT NOT NULL,  -- local date 'YYYY-MM-DD'
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    server_seq   INTEGER
);

CREATE INDEX idx_body_weight_measured_on ON body_weight_entries (measured_on);

-- Exercise definitions (the catalog, not instances).
CREATE TABLE exercises (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    body_parts        TEXT NOT NULL DEFAULT '[]',  -- JSON array of body parts an
                                              -- exercise targets, e.g.
                                              -- '["lats","biceps","traps"]' for pull-ups.
                                              -- Query with json_each() when needed;
                                              -- IndexedDB mirrors this with a
                                              -- multiEntry index.
    description       TEXT NOT NULL DEFAULT '',
    video_url         TEXT,                   -- optional how-to video link
    image_urls        TEXT NOT NULL DEFAULT '[]',  -- JSON array of URLs
    measurement_type  TEXT NOT NULL
                      CHECK (measurement_type IN
                             ('reps',           -- bodyweight: reps only
                              'weight_reps',    -- weight + reps
                              'distance',       -- distance only
                              'time',           -- duration only
                              'distance_time',  -- distance + duration (pace)
                              'weight_time')),  -- weight + duration (weighted plank)
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT,
    server_seq        INTEGER
);

-- Workout templates: what a workout SHOULD look like.
CREATE TABLE workout_templates (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    server_seq   INTEGER
);

-- Ordered exercises within a workout template.
CREATE TABLE workout_template_exercises (
    id                   TEXT PRIMARY KEY,
    workout_template_id  TEXT NOT NULL REFERENCES workout_templates (id),
    exercise_id          TEXT NOT NULL REFERENCES exercises (id),
    position             INTEGER NOT NULL,  -- order within the template, 0-based
    set_count            INTEGER NOT NULL DEFAULT 3,
    superset_group       INTEGER,           -- entries sharing a number are supersetted
    -- Optional prescribed targets; which apply depends on measurement_type.
    target_reps          INTEGER,
    target_weight_kg     REAL,
    target_time_seconds  REAL,
    target_distance_km   REAL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    server_seq           INTEGER
);

CREATE INDEX idx_wte_template ON workout_template_exercises (workout_template_id);

-- Program templates: reusable programming blueprints.
CREATE TABLE program_templates (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    frequency_per_week  INTEGER NOT NULL,
    duration_weeks      INTEGER NOT NULL,
    preferred_days      TEXT NOT NULL DEFAULT '[]',  -- JSON array of ints, 0=Sunday..6=Saturday
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    server_seq          INTEGER
);

-- Which workout templates a program rotates through, in order.
CREATE TABLE program_template_workouts (
    id                   TEXT PRIMARY KEY,
    program_template_id  TEXT NOT NULL REFERENCES program_templates (id),
    workout_template_id  TEXT NOT NULL REFERENCES workout_templates (id),
    position             INTEGER NOT NULL,  -- rotation order, 0-based
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    server_seq           INTEGER
);

CREATE INDEX idx_ptw_template ON program_template_workouts (program_template_id);

-- Program instances: a template assigned and started. Config fields are
-- SNAPSHOTS of the template at start time, so later template edits do not
-- rewrite an in-flight or historical program.
CREATE TABLE programs (
    id                   TEXT PRIMARY KEY,
    program_template_id  TEXT REFERENCES program_templates (id),  -- provenance only
    name                 TEXT NOT NULL,               -- snapshot
    description          TEXT NOT NULL DEFAULT '',     -- snapshot; editable while running
    frequency_per_week   INTEGER NOT NULL,            -- editable while running
    duration_weeks       INTEGER NOT NULL,            -- editable while running
    preferred_days       TEXT NOT NULL DEFAULT '[]',  -- JSON array of ints; editable while running
    started_on           TEXT NOT NULL,               -- local date 'YYYY-MM-DD'
    ends_on              TEXT NOT NULL,               -- local date; editable while running
    state                TEXT NOT NULL DEFAULT 'active'
                         CHECK (state IN ('active', 'completed', 'abandoned')),
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    server_seq           INTEGER
);

CREATE INDEX idx_programs_state ON programs (state);

-- Workout instances: what the user ACTUALLY did (or is scheduled to do).
-- Created from a template (scheduled by a program, or ad-hoc) but fully
-- editable — actual sets/reps live in workout_exercises/workout_sets.
--
-- Bumping: a missed workout keeps state='scheduled', gets a new scheduled_on
-- on the next available preferred day, and original_scheduled_on records
-- where it first sat (non-NULL means "was bumped"). An explicitly skipped
-- workout gets state='skipped' and never reschedules.
CREATE TABLE workouts (
    id                     TEXT PRIMARY KEY,
    program_id             TEXT REFERENCES programs (id),           -- NULL for ad-hoc
    workout_template_id    TEXT REFERENCES workout_templates (id),  -- provenance only
    name                   TEXT NOT NULL,  -- snapshot of template name
    scheduled_on           TEXT,           -- local date; NULL for ad-hoc workouts
    original_scheduled_on  TEXT,           -- local date; set on first bump
    state                  TEXT NOT NULL DEFAULT 'scheduled'
                           CHECK (state IN ('scheduled', 'in_progress', 'completed', 'skipped')),
    started_at             TEXT,           -- UTC ISO 8601
    completed_at           TEXT,           -- UTC ISO 8601
    notes                  TEXT,           -- free-text, shown on next same-template workout
    updated_at             TEXT NOT NULL,
    deleted_at             TEXT,
    server_seq             INTEGER
);

CREATE INDEX idx_workouts_program ON workouts (program_id);
CREATE INDEX idx_workouts_scheduled_on ON workouts (scheduled_on);
CREATE INDEX idx_workouts_state ON workouts (state);

-- Exercises within a workout instance (copied from the template at start,
-- then freely editable).
CREATE TABLE workout_exercises (
    id              TEXT PRIMARY KEY,
    workout_id      TEXT NOT NULL REFERENCES workouts (id),
    exercise_id     TEXT NOT NULL REFERENCES exercises (id),
    position        INTEGER NOT NULL,
    superset_group  INTEGER,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT,
    server_seq      INTEGER
);

CREATE INDEX idx_we_workout ON workout_exercises (workout_id);

-- Individual sets: the ground truth PRs are derived from. Which value
-- columns are used depends on the exercise's measurement_type.
CREATE TABLE workout_sets (
    id                   TEXT PRIMARY KEY,
    workout_exercise_id  TEXT NOT NULL REFERENCES workout_exercises (id),
    position             INTEGER NOT NULL,           -- set number within the exercise, 0-based
    completed            INTEGER NOT NULL DEFAULT 0, -- boolean
    reps                 INTEGER,
    weight_kg            REAL,
    time_seconds         REAL,
    distance_km          REAL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT,
    server_seq           INTEGER
);

CREATE INDEX idx_ws_workout_exercise ON workout_sets (workout_exercise_id);

-- Earned achievements. Definitions live in frontend code
-- (lib/achievements/catalogue.ts); awards are durable data. Uniqueness is
-- (achievement, scope_type, scope_id, tier) — enforced client-side, since
-- evaluation only inserts missing tuples (never revokes).
CREATE TABLE achievement_awards (
    id           TEXT PRIMARY KEY,
    achievement  TEXT NOT NULL,   -- catalogue id, e.g. 'one_tonne'
    scope_type   TEXT NOT NULL
                 CHECK (scope_type IN ('account', 'exercise', 'program', 'program_template')),
    scope_id     TEXT NOT NULL DEFAULT '',  -- '' for account scope
    tier         INTEGER NOT NULL DEFAULT 0,
    earned_at    TEXT NOT NULL,   -- UTC ISO 8601
    value        REAL,            -- measured value at award time (canonical units)
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    server_seq   INTEGER
);

CREATE INDEX idx_awards_scope ON achievement_awards (scope_type, scope_id);

-- Pet collection game (see pets.md). A pet's evolution stage is DERIVED
-- from xp, never stored. Eggs are derived too: 1 (opt-in) + one per 5
-- workout ledger events, minus pets hatched.
CREATE TABLE pets (
    id          TEXT PRIMARY KEY,
    species     TEXT NOT NULL
                CHECK (species IN ('turtle','frog','crab','lion','octopus',
                                   'pangolin','dragon','snake','parakeet',
                                   'monkey','cow','minotaur','hamster','scorpion')),
    name        TEXT NOT NULL,
    xp          INTEGER NOT NULL DEFAULT 0,  -- lifetime; stage derived
    hatched_at  TEXT NOT NULL,               -- UTC ISO 8601
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    server_seq  INTEGER
);

-- XP idempotency ledger: one row per unique XP-worthy event. Uniqueness is
-- (source_type, source_key), enforced client-side like award tuples.
-- pet_id NULL = banked (accrued while the game was disabled).
CREATE TABLE pet_xp_events (
    id           TEXT PRIMARY KEY,
    source_type  TEXT NOT NULL
                 CHECK (source_type IN ('achievement', 'workout', 'bank_spend')),
    source_key   TEXT NOT NULL,  -- award tuple / workout id / one-off grant id
    pet_id       TEXT REFERENCES pets (id),
    xp           INTEGER NOT NULL,
    created_at   TEXT NOT NULL,  -- UTC ISO 8601
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    server_seq   INTEGER
);

CREATE INDEX idx_pet_xp_source ON pet_xp_events (source_type, source_key);

-- Active-pet history: one span per stretch a pet was the active pet (while
-- the game was enabled). ended_at NULL = still active. Cumulative "time
-- active" is Σ (ended_at or now − started_at); a pet's age is now −
-- hatched_at, independent of activity. See pets.md §"Pets overview".
CREATE TABLE pet_active_spans (
    id          TEXT PRIMARY KEY,
    pet_id      TEXT NOT NULL REFERENCES pets (id),
    started_at  TEXT NOT NULL,  -- UTC ISO 8601
    ended_at    TEXT,           -- UTC ISO 8601; NULL = currently active
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT,
    server_seq  INTEGER
);

CREATE INDEX idx_pet_active_spans_pet ON pet_active_spans (pet_id);
