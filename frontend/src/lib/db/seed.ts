/**
 * Dev seed: sample exercises, templates, a program with history, and body
 * weight entries, so every page has data to render. Triggered from the
 * Settings page; refuses to run if exercises already exist.
 */
import { all, bulkPut, put, withSyncFields, nowIso } from './repo';
import type { Exercise, UserProfile } from './types';
import { addDays, parseLocalDate, todayLocal } from '../utils/dates';
import { startProgram, startWorkout, finishWorkout, getActiveProgram } from '../services/workouts';
import { byIndex } from './repo';
import type { Program, ProgramTemplate, Workout, WorkoutExercise, WorkoutSet } from './types';

function isoAtNoon(localDate: string): string {
  const d = parseLocalDate(localDate);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export async function seedSampleData(): Promise<string> {
  const existing = await all<Exercise>('exercises');
  if (existing.length > 0) {
    return 'Seed skipped: exercises already exist. Import/export or clear site data first.';
  }

  // Profile (only if onboarding hasn't created one).
  const profiles = await all<UserProfile>('user_profile');
  if (profiles.length === 0) {
    await put(
      'user_profile',
      withSyncFields({
        display_weight_unit: 'kg' as const,
        display_distance_unit: 'km' as const,
        age_years: 30,
        height_cm: 180,
        experience_level: 'intermediate' as const,
        weight_tracking_enabled: true,
        onboarding_completed_at: nowIso(),
      })
    );
  }

  // Exercises.
  const ex = {
    bench: withSyncFields({
      name: 'Bench Press',
      body_parts: ['chest', 'triceps', 'shoulders'],
      description: 'Barbell bench press on a flat bench.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    squat: withSyncFields({
      name: 'Back Squat',
      body_parts: ['quads', 'glutes', 'hamstrings', 'core'],
      description: 'High-bar barbell back squat.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    deadlift: withSyncFields({
      name: 'Deadlift',
      body_parts: ['back', 'hamstrings', 'glutes', 'traps'],
      description: 'Conventional barbell deadlift.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    pullup: withSyncFields({
      name: 'Pull-up',
      body_parts: ['lats', 'biceps', 'traps'],
      description: 'Bodyweight pull-up, palms away.',
      video_url: null,
      image_urls: [],
      measurement_type: 'reps' as const,
    }),
    ohp: withSyncFields({
      name: 'Overhead Press',
      body_parts: ['shoulders', 'triceps'],
      description: 'Standing barbell overhead press.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    plank: withSyncFields({
      name: 'Plank',
      body_parts: ['core'],
      description: 'Forearm plank hold.',
      video_url: null,
      image_urls: [],
      measurement_type: 'time' as const,
    }),
    run: withSyncFields({
      name: 'Running',
      body_parts: ['cardio'],
      description: 'Outdoor or treadmill run.',
      video_url: null,
      image_urls: [],
      measurement_type: 'distance_time' as const,
    }),
  };
  await bulkPut('exercises', Object.values(ex));

  // Workout templates.
  const push = withSyncFields({ name: 'Push Day', description: 'Chest, shoulders, triceps.' });
  const pull = withSyncFields({ name: 'Pull Day', description: 'Back and biceps.' });
  const legs = withSyncFields({ name: 'Leg Day', description: 'Squat-focused lower body.' });
  await bulkPut('workout_templates', [push, pull, legs]);

  const tmplExercises = [
    // Push: bench + OHP supersetted with plank finisher
    { t: push.id, e: ex.bench.id, pos: 0, sets: 4, ss: null, reps: 8, kg: 60 },
    { t: push.id, e: ex.ohp.id, pos: 1, sets: 3, ss: null, reps: 8, kg: 40 },
    { t: push.id, e: ex.plank.id, pos: 2, sets: 3, ss: null, secs: 60 },
    // Pull
    { t: pull.id, e: ex.deadlift.id, pos: 0, sets: 3, ss: null, reps: 5, kg: 100 },
    { t: pull.id, e: ex.pullup.id, pos: 1, sets: 3, ss: null, reps: 8 },
    // Legs
    { t: legs.id, e: ex.squat.id, pos: 0, sets: 5, ss: null, reps: 5, kg: 80 },
    { t: legs.id, e: ex.plank.id, pos: 1, sets: 3, ss: null, secs: 90 },
  ].map((r) =>
    withSyncFields({
      workout_template_id: r.t,
      exercise_id: r.e,
      position: r.pos,
      set_count: r.sets,
      superset_group: r.ss,
      target_reps: 'reps' in r ? (r.reps ?? null) : null,
      target_weight_kg: 'kg' in r ? (r.kg ?? null) : null,
      target_time_seconds: 'secs' in r ? (r.secs ?? null) : null,
      target_distance_km: null,
    })
  );
  await bulkPut('workout_template_exercises', tmplExercises);

  // Program template: PPL, 3×/week for 8 weeks (Mon/Wed/Fri).
  const ppl = withSyncFields({
    name: 'Push / Pull / Legs',
    description: 'Classic 3-day split.',
    frequency_per_week: 3,
    duration_weeks: 8,
    preferred_days: [1, 3, 5],
  });
  await put('program_templates', ppl as ProgramTemplate);
  await bulkPut(
    'program_template_workouts',
    [push, pull, legs].map((wt, i) =>
      withSyncFields({ program_template_id: ppl.id, workout_template_id: wt.id, position: i })
    )
  );

  // Start the program 2 weeks ago and complete the first 6 sessions with
  // slightly increasing numbers so Records shows PR progressions.
  const startedOn = addDays(todayLocal(), -14);
  await startProgram(ppl as ProgramTemplate, startedOn);
  const program = (await getActiveProgram()) as Program;

  const scheduled = (await byIndex<Workout>('workouts', 'program_id', program.id))
    .filter((w) => w.state === 'scheduled')
    .sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!));

  let sessionIdx = 0;
  for (const workout of scheduled) {
    if (!workout.scheduled_on || workout.scheduled_on >= todayLocal()) break;
    await startWorkout(workout);
    const bump = Math.floor(sessionIdx / 3); // small progression each full rotation

    const wes = await byIndex<WorkoutExercise>('workout_exercises', 'workout_id', workout.id);
    for (const we of wes) {
      const sets = await byIndex<WorkoutSet>('workout_sets', 'workout_exercise_id', we.id);
      for (const s of sets) {
        const done: WorkoutSet = { ...s, completed: true };
        if (done.weight_kg != null) done.weight_kg += bump * 2.5;
        if (done.reps != null && we.exercise_id === ex.pullup.id) done.reps += bump;
        if (done.time_seconds != null) done.time_seconds += bump * 15;
        await put('workout_sets', done);
      }
    }

    const fresh = (await byIndex<Workout>('workouts', 'program_id', program.id)).find(
      (w) => w.id === workout.id
    )!;
    await finishWorkout(fresh);
    // Backdate the record-keeping timestamps to the scheduled day.
    const finished = (await byIndex<Workout>('workouts', 'program_id', program.id)).find(
      (w) => w.id === workout.id
    )!;
    await put('workouts', {
      ...finished,
      started_at: isoAtNoon(workout.scheduled_on),
      completed_at: isoAtNoon(workout.scheduled_on),
    });
    sessionIdx++;
  }

  // Body weight trend: weekly entries drifting down from 85 kg.
  const weights = [85, 84.6, 84.1, 83.9, 83.4].map((kg, i) =>
    withSyncFields({ weight_kg: kg, measured_on: addDays(todayLocal(), -7 * (4 - i)) })
  );
  await bulkPut('body_weight_entries', weights);

  return `Seeded ${Object.keys(ex).length} exercises, 3 workout templates, 1 program (${sessionIdx} completed sessions), and ${weights.length} weight entries.`;
}
