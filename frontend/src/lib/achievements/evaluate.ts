/**
 * Achievement evaluation — idempotent and additive (see acheivements.md).
 * Builds aggregates from completed workouts, compares them against the
 * catalogue, and inserts any missing award rows. It never revokes, so it is
 * safe to run after every workout, after a sync/import, or lazily on the
 * achievements page (which backfills pre-feature data with
 * earned_at = "first detected").
 */
import { all, put, withSyncFields, nowIso } from '../db/repo';
import type {
  AchievementAward,
  BodyWeightEntry,
  Exercise,
  Program,
  ProgramTemplate,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '../db/types';
import { daysBetween, todayLocal } from '../utils/dates';
import {
  ACCOUNT_DEFS,
  EXERCISE_DEFS,
  PROGRAM_DEFS,
  TEMPLATE_DEFS,
  type AccountAggregate,
  type AchievementDef,
  type ExerciseAggregate,
  type ProgramAggregate,
  type TemplateAggregate,
} from './catalogue';

export interface Aggregates {
  account: AccountAggregate;
  byExercise: Map<string, ExerciseAggregate>;
  byProgram: Map<string, ProgramAggregate>;
  byTemplate: Map<string, TemplateAggregate>;
  exercises: Exercise[];
  programs: Program[];
  programTemplates: ProgramTemplate[];
}

const emptyExerciseAgg = (): ExerciseAggregate => ({
  volumeKg: 0,
  reps: 0,
  seconds: 0,
  distanceKm: 0,
  sets: 0,
  workouts: 0,
});

/** One pass over the database building every scope's aggregate. */
export async function buildAggregates(): Promise<Aggregates> {
  const [exercises, workouts, workoutExercises, sets, programs, programTemplates, weights] =
    await Promise.all([
      all<Exercise>('exercises'),
      all<Workout>('workouts'),
      all<WorkoutExercise>('workout_exercises'),
      all<WorkoutSet>('workout_sets'),
      all<Program>('programs'),
      all<ProgramTemplate>('program_templates'),
      all<BodyWeightEntry>('body_weight_entries'),
    ]);

  const completed = workouts.filter((w) => w.state === 'completed' && w.completed_at);
  const completedById = new Map(completed.map((w) => [w.id, w]));

  const weById = new Map(workoutExercises.map((we) => [we.id, we]));
  const exerciseById = new Map(exercises.map((ex) => [ex.id, ex]));

  // --- Per-exercise + per-program volume, from completed sets. ----------
  const byExercise = new Map<string, ExerciseAggregate>();
  const workoutsPerExercise = new Map<string, Set<string>>();
  const volumeByProgram = new Map<string, number>();
  const partsCovered = new Set<string>();

  for (const s of sets) {
    if (!s.completed) continue;
    const we = weById.get(s.workout_exercise_id);
    const workout = we && completedById.get(we.workout_id);
    if (!we || !workout) continue;
    const exercise = exerciseById.get(we.exercise_id);
    if (!exercise) continue;

    let agg = byExercise.get(exercise.id);
    if (!agg) byExercise.set(exercise.id, (agg = emptyExerciseAgg()));
    agg.sets += 1;
    if (s.reps != null) agg.reps += s.reps;
    if (s.time_seconds != null) agg.seconds += s.time_seconds;
    if (s.distance_km != null) agg.distanceKm += s.distance_km;
    const volume = s.weight_kg != null && s.reps != null ? s.weight_kg * s.reps : 0;
    agg.volumeKg += volume;

    let wset = workoutsPerExercise.get(exercise.id);
    if (!wset) workoutsPerExercise.set(exercise.id, (wset = new Set()));
    wset.add(workout.id);

    for (const part of exercise.body_parts) partsCovered.add(part);

    if (workout.program_id) {
      volumeByProgram.set(workout.program_id, (volumeByProgram.get(workout.program_id) ?? 0) + volume);
    }
  }
  for (const [id, wset] of workoutsPerExercise) byExercise.get(id)!.workouts = wset.size;

  // --- Account. ----------------------------------------------------------
  const distinctDays = [...new Set(completed.map((w) => w.completed_at!.slice(0, 10)))].sort();
  let bestWeekDays = 0;
  for (let i = 0, j = 0; j < distinctDays.length; j++) {
    while (daysBetween(distinctDays[i], distinctDays[j]) > 6) i++;
    bestWeekDays = Math.max(bestWeekDays, j - i + 1);
  }

  const account: AccountAggregate = {
    totalWorkouts: completed.length,
    bestWeekDays,
    bodyPartsCovered: partsCovered.size,
    hasProgram: programs.length > 0,
    hasNote: completed.some((w) => typeof w.notes === 'string' && w.notes.trim() !== ''),
  };

  // --- Per-program iteration. ---------------------------------------------
  const today = todayLocal();
  const sortedWeights = [...weights].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const byProgram = new Map<string, ProgramAggregate>();
  for (const p of programs) {
    const runWorkouts = workouts.filter((w) => w.program_id === p.id);
    const done = runWorkouts.filter((w) => w.state === 'completed').length;
    const to = p.state === 'active' ? today : p.ends_on;
    const inRange = sortedWeights.filter((e) => e.measured_on >= p.started_on && e.measured_on <= to);
    const first = inRange[0];
    const last = inRange[inRange.length - 1];
    byProgram.set(p.id, {
      volumeKg: volumeByProgram.get(p.id) ?? 0,
      fullHouse: p.state === 'completed' && runWorkouts.length > 0 && done === runWorkouts.length ? 1 : 0,
      weightChangeKg: first && last && first !== last ? last.weight_kg - first.weight_kg : null,
    });
  }

  // --- Per-template lifetime (finished runs only). -------------------------
  const byTemplate = new Map<string, TemplateAggregate>();
  for (const p of programs) {
    if (p.state !== 'completed' || !p.program_template_id) continue;
    let agg = byTemplate.get(p.program_template_id);
    if (!agg) byTemplate.set(p.program_template_id, (agg = { iterations: 0, totalWeeks: 0 }));
    agg.iterations += 1;
    agg.totalWeeks += p.duration_weeks;
  }

  return { account, byExercise, byProgram, byTemplate, exercises, programs, programTemplates };
}

/** A freshly earned achievement, enriched for the unlock notice. */
export interface NewAward {
  award: AchievementAward;
  def: AchievementDef;
  tierLabel: string | null;
  /** What it was earned for (exercise/program name); null for account-wide. */
  scopeName: string | null;
}

const awardKey = (a: Pick<AchievementAward, 'achievement' | 'scope_type' | 'scope_id' | 'tier'>) =>
  `${a.achievement}|${a.scope_type}|${a.scope_id}|${a.tier}`;

/**
 * Compare aggregates against the catalogue and insert every missing award.
 * Returns only the newly inserted ones (empty on a no-op re-run).
 */
export async function evaluateAchievements(aggregates?: Aggregates): Promise<NewAward[]> {
  const aggs = aggregates ?? (await buildAggregates());
  const existing = new Set((await all<AchievementAward>('achievement_awards')).map(awardKey));
  const now = nowIso();
  const fresh: NewAward[] = [];

  const check = async (
    def: AchievementDef,
    scopeId: string,
    value: number,
    scopeName: string | null
  ) => {
    for (const tier of def.tiers) {
      if (value < tier.threshold) continue;
      const candidate = {
        achievement: def.id,
        scope_type: def.scope,
        scope_id: scopeId,
        tier: tier.tier,
      };
      if (existing.has(awardKey(candidate))) continue;
      existing.add(awardKey(candidate));
      const award = await put(
        'achievement_awards',
        withSyncFields({ ...candidate, earned_at: now, value })
      );
      fresh.push({ award, def, tierLabel: tier.label ?? null, scopeName });
    }
  };

  for (const def of ACCOUNT_DEFS) {
    await check(def, '', def.metric(aggs.account), null);
  }

  const exerciseById = new Map(aggs.exercises.map((ex) => [ex.id, ex]));
  for (const [exerciseId, agg] of aggs.byExercise) {
    const exercise = exerciseById.get(exerciseId);
    if (!exercise) continue;
    for (const def of EXERCISE_DEFS) {
      if (!def.measurementTypes.includes(exercise.measurement_type)) continue;
      await check(def, exerciseId, def.metric(agg), exercise.name);
    }
  }

  const programById = new Map(aggs.programs.map((p) => [p.id, p]));
  for (const [programId, agg] of aggs.byProgram) {
    const program = programById.get(programId);
    if (!program) continue;
    for (const def of PROGRAM_DEFS) {
      await check(def, programId, def.metric(agg), program.name);
    }
  }

  const templateNames = new Map(aggs.programTemplates.map((pt) => [pt.id, pt.name]));
  for (const [templateId, agg] of aggs.byTemplate) {
    const name =
      templateNames.get(templateId) ??
      aggs.programs.find((p) => p.program_template_id === templateId)?.name ??
      null;
    for (const def of TEMPLATE_DEFS) {
      await check(def, templateId, def.metric(agg), name);
    }
  }

  return fresh;
}
