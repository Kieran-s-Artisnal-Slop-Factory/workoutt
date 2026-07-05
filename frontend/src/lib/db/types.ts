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
  display_weight_unit: WeightUnit;
  display_distance_unit: DistanceUnit;
  age_years: number | null;
  height_cm: number | null;
  experience_level: ExperienceLevel | null;
  weight_tracking_enabled: boolean;
  onboarding_completed_at: string | null;
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
  frequency_per_week: number;
  duration_weeks: number;
  preferred_days: number[];
  /** Local date 'YYYY-MM-DD'. */
  started_on: string;
  /** Local date 'YYYY-MM-DD'. Never extended by bumps. */
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
};

export type StoreName = keyof typeof STORES;
