# Sync test matrix

Every piece of app state, verified across devices against a real backend.

**Method:** Device A creates/edits the item and syncs (push). Device B is a
fresh install that "connects to existing server" and pulls, then we assert
the item arrived intact. Bidirectional items are then edited/deleted on B,
synced, and re-checked on a fresh pull. Driven by a two-device harness
(clear local + sync cursors between roles; the Go backend persists).

**Result: all checks pass.** The only bug found was the duplicate
`user_profile` row (fixed in commit `fd0e887` — singleton id + reconcile +
onboarding new-vs-existing). Reschedule, pets, and weight-tracking — the
originally-reported failures — all sync correctly once the profile is a
single row.

Legend: ✅ verified · ⬜ pending

## Stores — create & pull (A → B)

- ✅ `user_profile` — **singleton, exactly one row on B (rawProfileRows: 1)**
  - ✅ name
  - ✅ display_weight_unit / display_distance_unit
  - ✅ age_years / height_cm (180.5, float) / experience_level
  - ✅ weight_tracking_enabled
  - ✅ weight_chart_months (6)
  - ✅ highlighted_exercise_ids (array with 1 id)
  - ✅ pets_enabled / pets_started_at / active_pet_id (= hatched pet) / pets_banked_xp
  - ✅ notifications_enabled / notify_next_workout / notify_stale_workout / next_workout_reminder_time
  - ✅ rest_timer_default_seconds (120)
  - ✅ onboarding_completed_at
- ✅ `body_weight_entries` (weight_kg 82.4, measured_on)
- ✅ `exercises` (name, body_parts array of 3, measurement_type, description, video_url, image_urls)
- ✅ `workout_templates` (name, description)
- ✅ `workout_template_exercises` (position, set_count, superset_group, targets)
- ✅ `program_templates` (frequency, duration, preferred_days array)
- ✅ `program_template_workouts` (rotation position)
- ✅ `programs` (snapshot fields, state, dates)
- ✅ `workouts` (12 rows: scheduled_on, state, name)
- ✅ `workout_exercises` (position, superset_group)
- ✅ `workout_sets` (5 rows: completed bool, reps/weight)
- ✅ `achievement_awards` (6 rows: achievement, scope, tier, earned_at)
- ✅ `pets` (species parakeet, name Tank, xp 130, hatched_at)
- ✅ `pet_xp_events` (7 rows: source_type, source_key, pet_id, xp)
- ✅ `pet_active_spans` (added later — confirmed wired in types/schema/sync.go/export)

## Field-type fidelity (wire ↔ storage)

- ✅ JSON arrays round-trip (body_parts `["chest","triceps","shoulders"]`, preferred_days `[1,3,5]`, image_urls, highlighted_exercise_ids)
- ✅ Booleans round-trip (weight_tracking_enabled, pets_enabled, notifications_*, workout_sets.completed = 5 true)
- ✅ Nullable fields round-trip (superset_group 1 vs null both preserved, video_url null, targets null)
- ✅ Floats round-trip (height_cm 180.5, weight_kg 82.4/62.5)

## Operations (edit / delete / bidirectional)

- ✅ Reschedule a workout on A → new scheduled_on `2026-07-27` + original_scheduled_on on B **(the reported bug — works)**
- ✅ Complete a workout on A (state=completed, completed_at, notes "felt strong", sets) → B
- ✅ Skip a workout on A → state 'skipped' on B
- ✅ Edit a profile field on B (name, unit) → propagates to a fresh pull (bidirectional)
- ✅ Edit a workout_set value on B (weight 62.5→70) → propagates
- ✅ Soft-delete on B (tombstone an exercise) → gone on fresh pull, tombstone present
- ✅ Last-write-wins: older local (updated_at 2000) overwritten by newer server on pull; not pushed
- ✅ Re-sync is idempotent (immediate second syncNow → 0 pushed, 0 pulled)
