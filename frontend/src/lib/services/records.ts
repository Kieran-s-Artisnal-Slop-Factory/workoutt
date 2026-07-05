/**
 * Personal-record derivation. PRs are never stored — they are computed from
 * completed workouts' sets (see plan.md "Key decisions"). For each exercise
 * and metric we build the full record PROGRESSION (every time the record
 * improved), so the Records page can show current and previous PRs.
 */
import { all } from '../db/repo';
import type {
  Exercise,
  MeasurementType,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../db/types';

export interface RecordEntry {
  value: number;
  /** Secondary value for composite metrics (e.g. reps at max weight, time for best pace). */
  secondary: number | null;
  /** Local date the record was achieved (workout's completion date). */
  date: string;
}

export interface ExerciseRecords {
  exercise: Exercise;
  /** Metric label → progression, oldest first; last entry is the current PR. */
  metrics: Record<string, RecordEntry[]>;
}

interface SetWithDate extends WorkoutSet {
  date: string;
}

/** Metric definitions per measurement type. */
const METRICS: Record<
  MeasurementType,
  {
    label: string;
    value: (s: WorkoutSet) => number | null;
    secondary?: (s: WorkoutSet) => number | null;
    /** true if lower is better (default: higher is better). */
    lowerIsBetter?: boolean;
  }[]
> = {
  reps: [{ label: 'Max reps', value: (s) => s.reps }],
  weight_reps: [
    { label: 'Max weight', value: (s) => s.weight_kg, secondary: (s) => s.reps },
    {
      label: 'Max volume (single set)',
      value: (s) => (s.weight_kg != null && s.reps != null ? s.weight_kg * s.reps : null),
    },
  ],
  distance: [{ label: 'Longest distance', value: (s) => s.distance_km }],
  time: [{ label: 'Longest time', value: (s) => s.time_seconds }],
  distance_time: [
    { label: 'Longest distance', value: (s) => s.distance_km, secondary: (s) => s.time_seconds },
    {
      label: 'Best pace',
      value: (s) =>
        s.time_seconds != null && s.distance_km != null && s.distance_km > 0
          ? s.time_seconds / s.distance_km // seconds per km
          : null,
      secondary: (s) => s.distance_km,
      lowerIsBetter: true,
    },
  ],
  weight_time: [
    { label: 'Max weight', value: (s) => s.weight_kg, secondary: (s) => s.time_seconds },
    { label: 'Longest time', value: (s) => s.time_seconds, secondary: (s) => s.weight_kg },
  ],
};

/**
 * Compute record progressions for every exercise that has completed sets.
 * Optionally restrict to workouts completed within [from, to] local dates
 * (used for per-program PR summaries).
 */
export async function computeRecords(range?: { from: string; to: string }): Promise<ExerciseRecords[]> {
  const [exercises, workouts, workoutExercises, sets] = await Promise.all([
    all<Exercise>('exercises'),
    all<Workout>('workouts'),
    all<WorkoutExercise>('workout_exercises'),
    all<WorkoutSet>('workout_sets'),
  ]);

  const completedDates = new Map<string, string>(); // workout id → local date
  for (const w of workouts) {
    if (w.state === 'completed' && w.completed_at) {
      completedDates.set(w.id, w.completed_at.slice(0, 10));
    }
  }

  const weToWorkout = new Map<string, string>();
  const weToExercise = new Map<string, string>();
  for (const we of workoutExercises) {
    weToWorkout.set(we.id, we.workout_id);
    weToExercise.set(we.id, we.exercise_id);
  }

  // Group completed sets by exercise, tagged with the workout's date.
  const setsByExercise = new Map<string, SetWithDate[]>();
  for (const s of sets) {
    if (!s.completed) continue;
    const workoutId = weToWorkout.get(s.workout_exercise_id);
    const date = workoutId && completedDates.get(workoutId);
    if (!date) continue;
    if (range && (date < range.from || date > range.to)) continue;
    const exerciseId = weToExercise.get(s.workout_exercise_id);
    if (!exerciseId) continue;
    let bucket = setsByExercise.get(exerciseId);
    if (!bucket) setsByExercise.set(exerciseId, (bucket = []));
    bucket.push({ ...s, date });
  }

  const results: ExerciseRecords[] = [];
  for (const exercise of exercises) {
    const exerciseSets = setsByExercise.get(exercise.id);
    if (!exerciseSets?.length) continue;
    exerciseSets.sort((a, b) => a.date.localeCompare(b.date));

    const metrics: Record<string, RecordEntry[]> = {};
    for (const metric of METRICS[exercise.measurement_type]) {
      const progression: RecordEntry[] = [];
      let best: number | null = null;
      for (const s of exerciseSets) {
        const v = metric.value(s);
        if (v == null) continue;
        const improved =
          best == null || (metric.lowerIsBetter ? v < best : v > best);
        if (improved) {
          best = v;
          progression.push({ value: v, secondary: metric.secondary?.(s) ?? null, date: s.date });
        }
      }
      if (progression.length > 0) metrics[metric.label] = progression;
    }

    if (Object.keys(metrics).length > 0) results.push({ exercise, metrics });
  }

  return results.sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
}

export interface RecentPR {
  exercise: Exercise;
  label: string;
  entry: RecordEntry;
}

/** The most recently achieved PRs across all exercises and metrics. */
export async function recentPRs(limit = 5): Promise<RecentPR[]> {
  const records = await computeRecords();
  const flat: RecentPR[] = records.flatMap((r) =>
    Object.entries(r.metrics).flatMap(([label, progression]) =>
      progression.map((entry) => ({ exercise: r.exercise, label, entry }))
    )
  );
  return flat.sort((a, b) => b.entry.date.localeCompare(a.entry.date)).slice(0, limit);
}
