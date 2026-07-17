/**
 * Achievement catalogue — definitions live in code, awards in data (see
 * acheivements.md). Adding or renaming a definition never migrates user
 * data; removing one just hides its orphan awards.
 *
 * Thresholds are in canonical units (kg, km, seconds); the UI converts to
 * display units, same as everywhere else.
 */
import { BODY_PARTS } from '../db/types';
import type { AchievementScope, MeasurementType } from '../db/types';

export type AchievementUnit = 'count' | 'kg' | 'km' | 'seconds' | 'days' | 'weeks';

export interface AchievementTier {
  /** 0 for single-tier achievements; 1,2,3… for tiered ones. */
  tier: number;
  threshold: number;
  /** Tier suffix for display, e.g. 'I' / 'II' / 'III'. */
  label?: string;
  /** Pet-game XP this tier pays when awarded (pets.md §2). */
  xp: number;
}

interface BaseDef {
  id: string;
  title: string;
  description: string;
  scope: AchievementScope;
  /** Ascending thresholds; each earned tier gets its own award row. */
  tiers: AchievementTier[];
  unit: AchievementUnit;
}

/** Aggregates over all completed workouts, account-wide. */
export interface AccountAggregate {
  totalWorkouts: number;
  /** Max distinct training days inside any rolling 7-day window. */
  bestWeekDays: number;
  /** Distinct body parts hit across all completed workouts. */
  bodyPartsCovered: number;
  hasProgram: boolean;
  hasNote: boolean;
}

/** Cumulative totals for one exercise across all completed workouts. */
export interface ExerciseAggregate {
  /** Σ weight × reps over completed sets with both present. */
  volumeKg: number;
  reps: number;
  seconds: number;
  distanceKm: number;
  sets: number;
  /** Distinct completed workouts featuring this exercise. */
  workouts: number;
}

/** Totals for one program iteration (a specific run). */
export interface ProgramAggregate {
  volumeKg: number;
  /** 1 when the run finished with every workout completed, else 0. */
  fullHouse: number;
  /** Net body-weight change (kg) across the run's window; null = unknown. */
  weightChangeKg: number | null;
}

/** Totals across every iteration of one program template. */
export interface TemplateAggregate {
  /** Completed runs of this template. */
  iterations: number;
  /** Σ duration_weeks over completed runs. */
  totalWeeks: number;
}

export interface AccountDef extends BaseDef {
  scope: 'account';
  metric: (agg: AccountAggregate) => number;
}

export interface ExerciseDef extends BaseDef {
  scope: 'exercise';
  /** Which measurement types this applies to — others never show it. */
  measurementTypes: MeasurementType[];
  metric: (agg: ExerciseAggregate) => number;
}

export interface ProgramDef extends BaseDef {
  scope: 'program';
  metric: (agg: ProgramAggregate) => number;
}

export interface TemplateDef extends BaseDef {
  scope: 'program_template';
  metric: (agg: TemplateAggregate) => number;
}

export type AchievementDef = AccountDef | ExerciseDef | ProgramDef | TemplateDef;

/** Default pet-XP by tier number: I-or-single 15, II 25, III 40. */
const DEFAULT_TIER_XP: Record<number, number> = { 0: 15, 1: 15, 2: 25, 3: 40 };

const t = (tier: number, threshold: number, label?: string, xp?: number): AchievementTier => ({
  tier,
  threshold,
  label,
  xp: xp ?? DEFAULT_TIER_XP[tier] ?? 15,
});

// --- 1. Account-wide — trigger once ever. -------------------------------

export const ACCOUNT_DEFS: AccountDef[] = [
  {
    id: 'first_workout',
    title: 'First steps',
    description: 'Complete your first workout.',
    scope: 'account',
    unit: 'count',
    tiers: [t(0, 1)],
    metric: (a) => a.totalWorkouts,
  },
  {
    id: 'first_program',
    title: 'Getting serious',
    description: 'Set up your first program.',
    scope: 'account',
    unit: 'count',
    tiers: [t(0, 1)],
    metric: (a) => (a.hasProgram ? 1 : 0),
  },
  {
    id: 'consistency',
    title: 'Consistency',
    description: 'Complete workouts across all programs and ad-hoc sessions.',
    scope: 'account',
    unit: 'count',
    tiers: [t(1, 10, 'I'), t(2, 30, 'II'), t(3, 100, 'III')],
    metric: (a) => a.totalWorkouts,
  },
  {
    id: 'streak_week',
    title: 'Streak',
    description: 'Work out on 7 distinct days within a single week.',
    scope: 'account',
    unit: 'days',
    tiers: [t(0, 7, undefined, 40)],
    metric: (a) => a.bestWeekDays,
  },
  {
    id: 'well_rounded',
    title: 'Well-rounded',
    description: 'Hit every body-part group at least once.',
    scope: 'account',
    unit: 'count',
    tiers: [t(0, BODY_PARTS.length, undefined, 40)],
    metric: (a) => a.bodyPartsCovered,
  },
  {
    id: 'bookkeeper',
    title: 'Bookkeeper',
    description: 'Add an end-of-workout note.',
    scope: 'account',
    unit: 'count',
    tiers: [t(0, 1)],
    metric: (a) => (a.hasNote ? 1 : 0),
  },
];

// --- 2. Per-exercise — trigger once per exercise (and tier). ------------

export const EXERCISE_DEFS: ExerciseDef[] = [
  {
    id: 'one_tonne',
    title: 'One tonne',
    description: 'Lift cumulative volume (weight × reps) on this exercise.',
    scope: 'exercise',
    unit: 'kg',
    measurementTypes: ['weight_reps'],
    tiers: [t(1, 1_000, 'I'), t(2, 10_000, 'II'), t(3, 50_000, 'III')],
    metric: (a) => a.volumeKg,
  },
  {
    id: 'century',
    title: 'Century',
    description: 'Complete 100 sets of this exercise.',
    scope: 'exercise',
    unit: 'count',
    measurementTypes: ['weight_reps', 'weight_time'],
    tiers: [t(0, 100)],
    metric: (a) => a.sets,
  },
  {
    id: 'rep_machine',
    title: 'Rep machine',
    description: 'Accumulate reps on this exercise.',
    scope: 'exercise',
    unit: 'count',
    measurementTypes: ['reps'],
    tiers: [t(1, 1_000, 'I'), t(2, 10_000, 'II')],
    metric: (a) => a.reps,
  },
  {
    id: 'time_under_tension',
    title: 'Time under tension',
    description: 'Accumulate time on this exercise.',
    scope: 'exercise',
    unit: 'seconds',
    measurementTypes: ['time', 'weight_time', 'distance_time'],
    tiers: [t(1, 3_600, 'I'), t(2, 36_000, 'II')],
    metric: (a) => a.seconds,
  },
  {
    id: 'long_hauler',
    title: 'Long hauler',
    description: 'Accumulate distance on this exercise.',
    scope: 'exercise',
    unit: 'km',
    measurementTypes: ['distance', 'distance_time'],
    tiers: [t(1, 42.2, 'I'), t(2, 100, 'II')],
    metric: (a) => a.distanceKm,
  },
  {
    id: 'ten_timer',
    title: 'Ten-timer',
    description: 'Perform this exercise in 10 separate workouts.',
    scope: 'exercise',
    unit: 'count',
    measurementTypes: ['reps', 'weight_reps', 'distance', 'time', 'distance_time', 'weight_time'],
    tiers: [t(0, 10)],
    metric: (a) => a.workouts,
  },
];

// --- 3a. Per-program iteration — earnable again on each new run. --------

export const PROGRAM_DEFS: ProgramDef[] = [
  {
    id: 'volume_block',
    title: 'Volume block',
    description: 'Lift 1 tonne of total volume during this run of the program.',
    scope: 'program',
    unit: 'kg',
    tiers: [t(0, 1_000)],
    metric: (a) => a.volumeKg,
  },
  {
    id: 'full_house',
    title: 'Full house',
    description: 'Finish the program with every scheduled workout completed.',
    scope: 'program',
    unit: 'count',
    tiers: [t(0, 1)],
    metric: (a) => a.fullHouse,
  },
  {
    id: 'trimmed_down',
    title: 'Trimmed down',
    description: 'Lose 2 kg or more over this run of the program.',
    scope: 'program',
    unit: 'kg',
    tiers: [t(0, 2)],
    metric: (a) => (a.weightChangeKg != null && a.weightChangeKg < 0 ? -a.weightChangeKg : 0),
  },
  {
    id: 'bulked_up',
    title: 'Bulked up',
    description: 'Gain 2 kg or more over this run of the program.',
    scope: 'program',
    unit: 'kg',
    tiers: [t(0, 2)],
    metric: (a) => (a.weightChangeKg != null && a.weightChangeKg > 0 ? a.weightChangeKg : 0),
  },
];

// --- 3b. Per-program template — once for the template's lifetime. -------

export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: 'repeat_program',
    title: 'Repeat offender',
    description: 'Finish this program multiple times.',
    scope: 'program_template',
    unit: 'count',
    tiers: [t(1, 2, 'I'), t(2, 3, 'II'), t(3, 5, 'III')],
    metric: (a) => a.iterations,
  },
  {
    id: 'program_weeks',
    title: 'Long hauler (program)',
    description: 'Accumulate 12 total weeks across all runs of this program.',
    scope: 'program_template',
    unit: 'weeks',
    tiers: [t(0, 12)],
    metric: (a) => a.totalWeeks,
  },
];

export const ALL_DEFS: AchievementDef[] = [
  ...ACCOUNT_DEFS,
  ...EXERCISE_DEFS,
  ...PROGRAM_DEFS,
  ...TEMPLATE_DEFS,
];

export const DEF_BY_ID: Map<string, AchievementDef> = new Map(ALL_DEFS.map((d) => [d.id, d]));

/**
 * Pet-game XP an award pays (pets.md). Falls back to the base rate for
 * orphan awards whose definition was removed from the catalogue.
 */
export function xpForAward(achievementId: string, tier: number): number {
  const def = DEF_BY_ID.get(achievementId);
  return def?.tiers.find((tr) => tr.tier === tier)?.xp ?? 15;
}
