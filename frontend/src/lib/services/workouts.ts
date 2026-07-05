/**
 * Workout + program domain logic: instantiating workout instances from
 * templates, generating a program's schedule, and lifecycle transitions.
 *
 * Phase 1 scheduling is generation-only (frequency × preferred days,
 * rotating through the program's workout templates). Bump/skip handling is
 * Phase 2 (see plan.md).
 */
import { all, byIndex, get, put, softDelete, softDeleteMany, withSyncFields, nowIso } from '../db/repo';
import type {
  Exercise,
  Program,
  ProgramTemplate,
  ProgramTemplateWorkout,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
  WorkoutTemplateExercise,
} from '../db/types';
import { addDays, dayOfWeek, todayLocal } from '../utils/dates';

/** The single in_progress workout, if any (there should be at most one). */
export async function getInProgressWorkout(): Promise<Workout | undefined> {
  const rows = await byIndex<Workout>('workouts', 'state', 'in_progress');
  return rows[0];
}

/**
 * The workout to surface on the homepage: the in-progress one first,
 * otherwise the earliest scheduled one (past-due included, so a missed
 * workout stays visible until Phase 2 adds bumping).
 */
export async function getNextWorkout(): Promise<Workout | undefined> {
  const inProgress = await getInProgressWorkout();
  if (inProgress) return inProgress;
  const scheduled = await byIndex<Workout>('workouts', 'state', 'scheduled');
  return scheduled
    .filter((w) => w.scheduled_on)
    .sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!))[0];
}

export async function getActiveProgram(): Promise<Program | undefined> {
  const rows = await byIndex<Program>('programs', 'state', 'active');
  return rows[0];
}

/**
 * Copy the template's exercises into the workout instance and create its
 * sets, prefilled with the template's target values (the user then edits
 * them to what was actually performed). Marks the workout in_progress.
 */
export async function startWorkout(workout: Workout): Promise<void> {
  const already = await byIndex<WorkoutExercise>('workout_exercises', 'workout_id', workout.id);
  if (already.length === 0 && workout.workout_template_id) {
    const templateExercises = (
      await byIndex<WorkoutTemplateExercise>(
        'workout_template_exercises',
        'workout_template_id',
        workout.workout_template_id
      )
    ).sort((a, b) => a.position - b.position);

    for (const te of templateExercises) {
      const we = await put(
        'workout_exercises',
        withSyncFields<Omit<WorkoutExercise, keyof import('../db/types').SyncFields>>({
          workout_id: workout.id,
          exercise_id: te.exercise_id,
          position: te.position,
          superset_group: te.superset_group,
        })
      );
      for (let i = 0; i < te.set_count; i++) {
        await put(
          'workout_sets',
          withSyncFields({
            workout_exercise_id: we.id,
            position: i,
            completed: false,
            reps: te.target_reps,
            weight_kg: te.target_weight_kg,
            time_seconds: te.target_time_seconds,
            distance_km: te.target_distance_km,
          })
        );
      }
    }
  }

  await put('workouts', { ...workout, state: 'in_progress', started_at: nowIso() });
}

/** Start an ad-hoc (non-program) workout from a template. */
export async function startAdhocWorkout(template: WorkoutTemplate): Promise<Workout> {
  const workout = await put(
    'workouts',
    withSyncFields<Omit<Workout, keyof import('../db/types').SyncFields>>({
      program_id: null,
      workout_template_id: template.id,
      name: template.name,
      scheduled_on: null,
      original_scheduled_on: null,
      state: 'scheduled',
      started_at: null,
      completed_at: null,
    })
  );
  await startWorkout(workout);
  return (await get<Workout>('workouts', workout.id))!;
}

export async function finishWorkout(workout: Workout): Promise<void> {
  await put('workouts', { ...workout, state: 'completed', completed_at: nowIso() });
}

/**
 * Abandon a workout: discard all logged progress. A program-scheduled
 * workout goes back to 'scheduled' (it stays on the calendar); an ad-hoc
 * one is discarded entirely.
 */
export async function abandonWorkout(workout: Workout): Promise<void> {
  const exercises = await byIndex<WorkoutExercise>('workout_exercises', 'workout_id', workout.id);
  for (const we of exercises) {
    const sets = await byIndex<WorkoutSet>('workout_sets', 'workout_exercise_id', we.id);
    await softDeleteMany('workout_sets', sets.map((s) => s.id));
  }
  await softDeleteMany('workout_exercises', exercises.map((e) => e.id));

  if (workout.program_id && workout.scheduled_on) {
    await put('workouts', { ...workout, state: 'scheduled', started_at: null });
  } else {
    await softDelete('workouts', workout.id);
  }
}

/**
 * Start a program from a template: snapshot its config and generate the
 * full schedule up front. Each week uses the first frequency_per_week of the
 * preferred days (sorted), rotating through the program's workout templates
 * in position order.
 */
export async function startProgram(
  template: ProgramTemplate,
  startOn: string = todayLocal()
): Promise<Program> {
  const rotation = (
    await byIndex<ProgramTemplateWorkout>(
      'program_template_workouts',
      'program_template_id',
      template.id
    )
  ).sort((a, b) => a.position - b.position);

  const workoutTemplates = new Map<string, WorkoutTemplate>();
  for (const wt of await all<WorkoutTemplate>('workout_templates')) {
    workoutTemplates.set(wt.id, wt);
  }

  const program = await put(
    'programs',
    withSyncFields<Omit<Program, keyof import('../db/types').SyncFields>>({
      program_template_id: template.id,
      name: template.name,
      frequency_per_week: template.frequency_per_week,
      duration_weeks: template.duration_weeks,
      preferred_days: [...template.preferred_days],
      started_on: startOn,
      ends_on: addDays(startOn, template.duration_weeks * 7),
      state: 'active',
    })
  );

  if (rotation.length > 0) {
    const days = [...template.preferred_days].sort((a, b) => a - b);
    const perWeek = Math.min(template.frequency_per_week, days.length || 7);
    let rotationIdx = 0;

    // Anchor weeks on the start date's week (Sunday-based).
    const weekStart = addDays(startOn, -dayOfWeek(startOn));

    for (let week = 0; week < template.duration_weeks; week++) {
      for (let d = 0; d < perWeek; d++) {
        const date = addDays(weekStart, week * 7 + (days[d] ?? d));
        if (date < startOn) continue; // skip days already past in the first week
        const wt = workoutTemplates.get(rotation[rotationIdx % rotation.length].workout_template_id);
        rotationIdx++;
        if (!wt) continue;
        await put(
          'workouts',
          withSyncFields<Omit<Workout, keyof import('../db/types').SyncFields>>({
            program_id: program.id,
            workout_template_id: wt.id,
            name: wt.name,
            scheduled_on: date,
            original_scheduled_on: null,
            state: 'scheduled',
            started_at: null,
            completed_at: null,
          })
        );
      }
    }
  }

  return program;
}

/** Explicitly skip a workout: it never reschedules and is recorded as skipped. */
export async function skipWorkout(workout: Workout): Promise<void> {
  await put('workouts', { ...workout, state: 'skipped' });
}

/**
 * Bump handling (Phase 2): if any scheduled workout's day has passed, all
 * remaining scheduled workouts of the active program are re-laid out over
 * the preferred-day sequence starting today, keeping their order — the
 * missed one moves to the next available day and the rest shift as needed.
 * Workouts that no longer fit before the program's end date are marked
 * skipped (bumping never extends the program).
 *
 * Returns true if anything changed. Call on app load before reading the
 * schedule.
 */
export async function applyBumps(): Promise<boolean> {
  const program = await getActiveProgram();
  if (!program) return false;

  const today = todayLocal();
  const remaining = (await byIndex<Workout>('workouts', 'program_id', program.id))
    .filter((w) => w.state === 'scheduled' && w.scheduled_on)
    .sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!));
  if (!remaining.some((w) => w.scheduled_on! < today)) return false;

  // Candidate dates: the program's preferred days, from this week forward.
  const days = [...program.preferred_days].sort((a, b) => a - b);
  const perWeek = Math.min(program.frequency_per_week, days.length || 7);
  const weekStart = addDays(today, -dayOfWeek(today));
  const dates: string[] = [];
  for (let week = 0; dates.length < remaining.length && week < 520; week++) {
    for (let d = 0; d < perWeek; d++) {
      const date = addDays(weekStart, week * 7 + (days[d] ?? d));
      if (date >= today) dates.push(date);
    }
  }

  let changed = false;
  for (const [i, workout] of remaining.entries()) {
    const date = dates[i];
    if (date === undefined || date > program.ends_on) {
      await put('workouts', { ...workout, state: 'skipped' });
      changed = true;
      continue;
    }
    if (workout.scheduled_on !== date) {
      await put('workouts', {
        ...workout,
        scheduled_on: date,
        original_scheduled_on: workout.original_scheduled_on ?? workout.scheduled_on,
      });
      changed = true;
    }
  }
  return changed;
}

export async function abandonProgram(program: Program): Promise<void> {
  // Remove its remaining scheduled workouts; completed history stays.
  const workouts = await byIndex<Workout>('workouts', 'program_id', program.id);
  const scheduled = workouts.filter((w) => w.state === 'scheduled');
  await softDeleteMany('workouts', scheduled.map((w) => w.id));
  await put('programs', { ...program, state: 'abandoned' });
}

/** Progress of a program: completed vs total (completed + skipped + remaining). */
export async function programProgress(
  program: Program
): Promise<{ completed: number; total: number }> {
  const workouts = await byIndex<Workout>('workouts', 'program_id', program.id);
  return {
    completed: workouts.filter((w) => w.state === 'completed').length,
    total: workouts.length,
  };
}

/** Exercise lookup map, for rendering workout contents. */
export async function exerciseMap(): Promise<Map<string, Exercise>> {
  const map = new Map<string, Exercise>();
  for (const ex of await all<Exercise>('exercises')) map.set(ex.id, ex);
  return map;
}
