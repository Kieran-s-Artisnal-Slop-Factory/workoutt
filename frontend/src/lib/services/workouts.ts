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
import { addDays, dayOfWeek, daysBetween, todayLocal } from '../utils/dates';

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

export async function finishWorkout(workout: Workout, completedAt?: string): Promise<void> {
  await put('workouts', { ...workout, state: 'completed', completed_at: completedAt ?? nowIso() });
}

/**
 * Notes from the most recently completed workout of the given template
 * (excluding a workout id, e.g. the current one), so they can be surfaced
 * during the next workout of that template.
 */
export async function getLatestTemplateNotes(
  templateId: string,
  excludeWorkoutId?: string
): Promise<{ notes: string; date: string } | null> {
  const prior = (await all<Workout>('workouts'))
    .filter(
      (w) =>
        w.workout_template_id === templateId &&
        w.id !== excludeWorkoutId &&
        w.state === 'completed' &&
        w.completed_at &&
        typeof w.notes === 'string' &&
        w.notes.trim() !== ''
    )
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));
  const latest = prior[0];
  return latest ? { notes: latest.notes!.trim(), date: latest.completed_at!.slice(0, 10) } : null;
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
      description: template.description ?? '',
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

/**
 * The rotation (ordered, de-duplicated template ids) a program currently
 * uses. Derived from the program's OWN workouts so it reflects mid-program
 * edits — upcoming scheduled ones first (the live rotation), else all of
 * them, else the source template as a last resort.
 */
export async function programRotation(program: Program): Promise<string[]> {
  const ws = (await byIndex<Workout>('workouts', 'program_id', program.id))
    .filter((w) => w.workout_template_id && w.scheduled_on)
    .sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!));

  const scheduled = ws.filter((w) => w.state === 'scheduled');
  const source = scheduled.length > 0 ? scheduled : ws;
  const seen = new Set<string>();
  const order: string[] = [];
  for (const w of source) {
    if (!seen.has(w.workout_template_id!)) {
      seen.add(w.workout_template_id!);
      order.push(w.workout_template_id!);
    }
  }
  if (order.length > 0) return order;

  // Program has no dated workouts (edge case) — fall back to the template.
  if (program.program_template_id) {
    const rows = (
      await byIndex<ProgramTemplateWorkout>(
        'program_template_workouts',
        'program_template_id',
        program.program_template_id
      )
    ).sort((a, b) => a.position - b.position);
    return rows.map((r) => r.workout_template_id);
  }
  return [];
}

/** Generate scheduled workouts for a program from `fromDate` through ends_on. */
async function generateProgramWorkouts(
  program: Program,
  rotationTemplateIds: string[],
  fromDate: string
): Promise<void> {
  if (rotationTemplateIds.length === 0) return;
  const templatesById = new Map<string, WorkoutTemplate>();
  for (const wt of await all<WorkoutTemplate>('workout_templates')) templatesById.set(wt.id, wt);

  const days = [...program.preferred_days].sort((a, b) => a - b);
  const perWeek = Math.min(program.frequency_per_week, days.length || 7);
  const weekStart = addDays(fromDate, -dayOfWeek(fromDate));
  let rotationIdx = 0;

  for (let week = 0; week < 520; week++) {
    if (addDays(weekStart, week * 7) > program.ends_on) break;
    for (let d = 0; d < perWeek; d++) {
      const date = addDays(weekStart, week * 7 + (days[d] ?? d));
      if (date < fromDate || date > program.ends_on) continue;
      const wt = templatesById.get(rotationTemplateIds[rotationIdx % rotationTemplateIds.length]);
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
          notes: null,
        })
      );
    }
  }
}

export interface ProgramEdit {
  name: string;
  description: string;
  frequency_per_week: number;
  preferred_days: number[];
  ends_on: string;
  rotationTemplateIds: string[];
}

/**
 * Edit a running program: update its config and regenerate the remaining
 * schedule from today. Past, completed, skipped, and in-progress workouts are
 * left untouched — only future scheduled slots are rebuilt from the new
 * frequency, preferred days, rotation, and end date.
 */
export async function updateProgram(program: Program, edit: ProgramEdit): Promise<Program> {
  const today = todayLocal();
  const durationWeeks = Math.max(1, Math.ceil(daysBetween(program.started_on, edit.ends_on) / 7));

  const updated = (await put('programs', {
    ...program,
    name: edit.name,
    description: edit.description,
    frequency_per_week: edit.frequency_per_week,
    preferred_days: [...edit.preferred_days],
    ends_on: edit.ends_on,
    duration_weeks: durationWeeks,
  })) as Program;

  // Drop future scheduled slots and rebuild them from today.
  const workouts = await byIndex<Workout>('workouts', 'program_id', program.id);
  const futureScheduled = workouts.filter(
    (w) => w.state === 'scheduled' && w.scheduled_on && w.scheduled_on >= today
  );
  await softDeleteMany('workouts', futureScheduled.map((w) => w.id));

  await generateProgramWorkouts(updated, edit.rotationTemplateIds, today);
  return updated;
}

export interface ProgramProgress {
  completed: number;
  total: number;
  skipped: number;
  /** Workouts that were rescheduled at least once (any state). */
  bumped: number;
}

/** Progress of a program: completed vs total, plus skip/bump counts. */
export async function programProgress(program: Program): Promise<ProgramProgress> {
  const workouts = await byIndex<Workout>('workouts', 'program_id', program.id);
  return {
    completed: workouts.filter((w) => w.state === 'completed').length,
    total: workouts.length,
    skipped: workouts.filter((w) => w.state === 'skipped').length,
    bumped: workouts.filter((w) => w.original_scheduled_on != null).length,
  };
}

/** Exercise lookup map, for rendering workout contents. */
export async function exerciseMap(): Promise<Map<string, Exercise>> {
  const map = new Map<string, Exercise>();
  for (const ex of await all<Exercise>('exercises')) map.set(ex.id, ex);
  return map;
}
