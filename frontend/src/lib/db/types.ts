/**
 * Workoutt data model — TypeScript mirror of backend/sql/schema.sql.
 *
 * The SQL DDL is the canonical definition; these types and the STORES map
 * must stay 1:1 with it by field name. Every synced entity carries the
 * SyncFields (see plan.md "Key decisions" for the sync design).
 *
 * Units: weight kg, distance km, duration seconds — always. Display units
 * are a UserProfile preference applied at render time only.
 * Dates: calendar fields are local 'YYYY-MM-DD'; *_at fields are UTC ISO 8601.
 */

/** Columns present on every synced entity. */
export interface SyncFields {
  /** UUID v4, generated client-side. */
  id: string;
  /** UTC ISO 8601, client-set. Conflict resolution is last-write-wins on this. */
  updated_at: string;
  /** UTC ISO 8601 tombstone. Soft-delete only, so deletions sync. */
  deleted_at: string | null;
  /** Server-assigned monotonic sync cursor. null until first accepted by the server. */
  server_seq: number | null;
}

export type WeightUnit = 'kg' | 'lbs';
export type DistanceUnit = 'km' | 'mi';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export const MEASUREMENT_TYPES = [
  'reps',
  'weight_reps',
  'distance',
  'time',
  'distance_time',
  'weight_time',
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export const BODY_PARTS = [
  'chest',
  'back',
  'lats',
  'traps',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'full_body',
  'cardio',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export type ProgramState = 'active' | 'completed' | 'abandoned';
export type WorkoutState = 'scheduled' | 'in_progress' | 'completed' | 'skipped';

/** Single row (single-user app). */
export interface UserProfile extends SyncFields {
  /** Display name for the personal greeting. Nullable — older profiles predate it. */
  name: string | null;
  /**
   * Exercise ids pinned to the Records page's "Highlighted PRs" section.
   * Deleting an exercise must remove its id here (cascade). May be undefined
   * on profiles created before this field existed — read with `?? []`.
   */
  highlighted_exercise_ids: string[];
  display_weight_unit: WeightUnit;
  display_distance_unit: DistanceUnit;
  age_years: number | null;
  height_cm: number | null;
  experience_level: ExperienceLevel | null;
  weight_tracking_enabled: boolean;
  /**
   * How many months back the body-weight chart shows (the logs stay full).
   * 0 means all time. May be undefined on older rows — read with `?? 3`.
   */
  weight_chart_months?: number;
  /**
   * Default seconds pre-filled into the in-workout rest timer. May be
   * undefined on older rows — read with `?? 90`.
   */
  rest_timer_default_seconds?: number;
  /**
   * Reminder preferences (notifications.md). Synced so the push server can
   * read them; the actual push subscription is per-device (server-only).
   * `notifications_enabled` is the master switch. Read with `?? false` /
   * `?? true` / `?? '08:00'`.
   */
  notifications_enabled?: boolean;
  notify_next_workout?: boolean;
  notify_stale_workout?: boolean;
  /** Local HH:MM to remind on a workout day. */
  next_workout_reminder_time?: string;
  /**
   * Pet collection game (pets.md). All optional — rows predate the feature.
   * `pets_enabled` is the live toggle; `pets_started_at` marks the first
   * opt-in ever (null = never opted in, so no XP is ledgered at all).
   * Read with `?? false` / `?? null` / `?? 0`.
   */
  pets_enabled?: boolean;
  pets_started_at?: string | null;
  active_pet_id?: string | null;
  /** XP accrued while the game was disabled, spendable on re-enable. */
  pets_banked_xp?: number;
  /**
   * When true, eggs may hatch a species already owned (and keep accruing
   * past a full collection). Default false — read with `?? false`. Forced
   * true once every species is owned, since there is nothing new to hatch.
   */
  pets_allow_duplicates?: boolean;
  onboarding_completed_at: string | null;
}

/** A collected animal (pet game, pets.md). Stage is derived from xp. */
export interface Pet extends SyncFields {
  /** One of PET_SPECIES (lib/pets/sprites/types.ts). */
  species: string;
  name: string;
  /** Lifetime XP; evolution stage is derived, never stored. */
  xp: number;
  /** UTC ISO 8601. */
  hatched_at: string;
}

export type PetXpSource = 'achievement' | 'workout' | 'bank_spend';

/**
 * XP idempotency ledger: one row per unique XP-worthy event, so
 * re-evaluation, sync replays, and imports can never double-pay.
 * Uniqueness is (source_type, source_key). pet_id null = banked.
 */
export interface PetXpEvent extends SyncFields {
  source_type: PetXpSource;
  /** Award tuple / workout id / one-off grant id. */
  source_key: string;
  pet_id: string | null;
  xp: number;
  /** UTC ISO 8601. */
  created_at: string;
}

/**
 * One stretch during which a pet was the active pet (while the game was
 * enabled). `ended_at` null = currently active. Cumulative active time is
 * Σ over a pet's spans of (ended_at ?? now) − started_at — distinct from
 * age (now − hatched_at). See lib/pets/xp.ts petActiveMs().
 */
export interface PetActiveSpan extends SyncFields {
  pet_id: string;
  /** UTC ISO 8601. */
  started_at: string;
  /** UTC ISO 8601, or null while still active. */
  ended_at: string | null;
}

export interface BodyWeightEntry extends SyncFields {
  weight_kg: number;
  /** Local date 'YYYY-MM-DD'. */
  measured_on: string;
}

export interface Exercise extends SyncFields {
  name: string;
  /** One or more body parts the exercise targets (e.g. pull-ups: lats, biceps, traps). */
  body_parts: BodyPart[];
  description: string;
  video_url: string | null;
  image_urls: string[];
  measurement_type: MeasurementType;
}

export interface WorkoutTemplate extends SyncFields {
  name: string;
  description: string;
}

export interface WorkoutTemplateExercise extends SyncFields {
  workout_template_id: string;
  exercise_id: string;
  /** Order within the template, 0-based. */
  position: number;
  set_count: number;
  /** Entries sharing a number are supersetted together. */
  superset_group: number | null;
  target_reps: number | null;
  target_weight_kg: number | null;
  target_time_seconds: number | null;
  target_distance_km: number | null;
}

export interface ProgramTemplate extends SyncFields {
  name: string;
  description: string;
  frequency_per_week: number;
  duration_weeks: number;
  /** Days of week, 0=Sunday..6=Saturday. */
  preferred_days: number[];
}

export interface ProgramTemplateWorkout extends SyncFields {
  program_template_id: string;
  workout_template_id: string;
  /** Rotation order, 0-based. */
  position: number;
}

/**
 * A program instance. Config fields are snapshots of the template at start
 * time so later template edits don't rewrite an in-flight program.
 */
export interface Program extends SyncFields {
  program_template_id: string | null;
  name: string;
  /** Snapshot of the template description at start; editable while running. May be undefined on older rows. */
  description?: string;
  frequency_per_week: number;
  duration_weeks: number;
  preferred_days: number[];
  /** Local date 'YYYY-MM-DD'. */
  started_on: string;
  /** Local date 'YYYY-MM-DD'. Editable while running (was: never extended by bumps). */
  ends_on: string;
  state: ProgramState;
}

/**
 * A workout instance — scheduled by a program or started ad-hoc.
 * Bumping: state stays 'scheduled', scheduled_on moves to the next available
 * preferred day, and original_scheduled_on (non-null = "was bumped") records
 * where it first sat. Skipped workouts never reschedule.
 */
export interface Workout extends SyncFields {
  program_id: string | null;
  workout_template_id: string | null;
  name: string;
  scheduled_on: string | null;
  original_scheduled_on: string | null;
  state: WorkoutState;
  started_at: string | null;
  completed_at: string | null;
  /**
   * Free-text notes recorded when finishing. Surfaced during the next
   * workout of the same template. May be undefined on older rows.
   */
  notes?: string | null;
}

export type AchievementScope = 'account' | 'exercise' | 'program' | 'program_template';

/**
 * An earned achievement. Definitions (title, thresholds…) live in code
 * (lib/achievements/catalogue.ts); awards are durable data so they survive
 * workout edits and sync across devices. Uniqueness is the tuple
 * (achievement, scope_type, scope_id, tier) — evaluation only ever inserts
 * missing tuples, never revokes (see acheivements.md).
 */
export interface AchievementAward extends SyncFields {
  /** Catalogue id, e.g. 'one_tonne'. */
  achievement: string;
  scope_type: AchievementScope;
  /** '' for account; exercise_id / program_id / program_template_id otherwise. */
  scope_id: string;
  /** 0 for single-tier achievements; 1,2,3… for tiered thresholds. */
  tier: number;
  /** UTC ISO 8601 — when it was awarded (first detected, for backfills). */
  earned_at: string;
  /** Measured value at award time (canonical units), for display. */
  value: number | null;
}

export interface WorkoutExercise extends SyncFields {
  workout_id: string;
  exercise_id: string;
  position: number;
  superset_group: number | null;
}

/**
 * One set as actually performed. Which value fields apply depends on the
 * exercise's measurement_type. PRs are derived from these rows.
 */
export interface WorkoutSet extends SyncFields {
  workout_exercise_id: string;
  position: number;
  completed: boolean;
  reps: number | null;
  weight_kg: number | null;
  time_seconds: number | null;
  distance_km: number | null;
}

/**
 * IndexedDB object store definitions. Store names match SQL table names;
 * every store uses keyPath 'id'. Indexes mirror the SQL indexes, except
 * body_parts which is a multiEntry index over the array (SQLite side uses
 * json_each() instead).
 */
export interface StoreIndex {
  name: string;
  multiEntry?: boolean;
}

export const STORES: Record<string, { indexes: StoreIndex[] }> = {
  user_profile: { indexes: [] },
  body_weight_entries: { indexes: [{ name: 'measured_on' }] },
  exercises: { indexes: [{ name: 'body_parts', multiEntry: true }] },
  workout_templates: { indexes: [] },
  workout_template_exercises: { indexes: [{ name: 'workout_template_id' }] },
  program_templates: { indexes: [] },
  program_template_workouts: { indexes: [{ name: 'program_template_id' }] },
  programs: { indexes: [{ name: 'state' }] },
  workouts: { indexes: [{ name: 'program_id' }, { name: 'scheduled_on' }, { name: 'state' }] },
  workout_exercises: { indexes: [{ name: 'workout_id' }] },
  workout_sets: { indexes: [{ name: 'workout_exercise_id' }] },
  achievement_awards: { indexes: [] },
  pets: { indexes: [] },
  pet_xp_events: { indexes: [{ name: 'source_key' }] },
  pet_active_spans: { indexes: [{ name: 'pet_id' }] },
};

export type StoreName = keyof typeof STORES;
