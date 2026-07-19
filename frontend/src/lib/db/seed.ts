/**
 * Dev seed: sample exercises, templates, a program with history, and body
 * weight entries, so every page has data to render. Triggered from the
 * Settings page; refuses to run if exercises already exist.
 */
import { all, bulkPut, put, withSyncFields, nowIso } from './repo';
import { newProfile } from './profile';
import type { Exercise, UserProfile } from './types';
import { addDays, dayOfWeek, parseLocalDate, todayLocal } from '../utils/dates';
import {   startProgram,
  startWorkout,
  finishWorkout,
  getActiveProgram,
  skipWorkout, } from '../services/workouts';
import { byIndex } from './repo';
import type {
  BodyPart,
  MeasurementType,
  Program,
  ProgramTemplate,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
} from './types';

function isoAtNoon(localDate: string): string {
  const d = parseLocalDate(localDate);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export type SeedType = 'simple' | 'heavy';

/**
 * Dev seed entry point. 'simple' loads a realistic small dataset; 'heavy'
 * loads enough data to exercise the pagination limits (250+ exercises, 250+
 * past workouts, 45+ derived records).
 */
export async function seedSampleData(type: SeedType = 'simple'): Promise<string> {
  return type === 'heavy' ? seedHeavy() : seedSimple();
}

async function seedSimple(): Promise<string> {
  const existing = await all<Exercise>('exercises');
  if (existing.length > 0) {
    return 'Seed skipped: exercises already exist. Import/export or clear site data first.';
  }

  // Profile (only if onboarding hasn't created one).
  const profiles = await all<UserProfile>('user_profile');
  if (profiles.length === 0) {
    await put(
      'user_profile',
      newProfile({
        name: null,
        highlighted_exercise_ids: [],
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
   const extraExercises = {
    inclineBench: withSyncFields({
      name: 'Incline Bench Press',
      body_parts: ['chest', 'shoulders', 'triceps'],
      description: 'Incline barbell bench press.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    dumbbellBench: withSyncFields({
      name: 'Dumbbell Bench Press',
      body_parts: ['chest', 'triceps'],
      description: 'Flat dumbbell bench press.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    chestFly: withSyncFields({
      name: 'Chest Fly',
      body_parts: ['chest'],
      description: 'Machine chest fly.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    cableCross: withSyncFields({
      name: 'Cable Crossover',
      body_parts: ['chest'],
      description: 'Cable crossover.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    latPulldown: withSyncFields({
      name: 'Lat Pulldown',
      body_parts: ['lats', 'biceps'],
      description: 'Wide-grip pulldown.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    seatedRow: withSyncFields({
      name: 'Seated Cable Row',
      body_parts: ['back', 'lats'],
      description: 'Cable row.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    barbellRow: withSyncFields({
      name: 'Barbell Row',
      body_parts: ['back', 'lats'],
      description: 'Bent-over row.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    dumbbellRow: withSyncFields({
      name: 'Dumbbell Row',
      body_parts: ['back', 'lats'],
      description: 'Single-arm row.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    facePull: withSyncFields({
      name: 'Face Pull',
      body_parts: ['shoulders', 'traps'],
      description: 'Cable face pull.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    curl: withSyncFields({
      name: 'Barbell Curl',
      body_parts: ['biceps'],
      description: 'Standing curl.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    hammerCurl: withSyncFields({
      name: 'Hammer Curl',
      body_parts: ['biceps', 'forearms'],
      description: 'Neutral grip curl.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    skullCrusher: withSyncFields({
      name: 'Skull Crusher',
      body_parts: ['triceps'],
      description: 'EZ bar extension.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    pushdown: withSyncFields({
      name: 'Tricep Pushdown',
      body_parts: ['triceps'],
      description: 'Cable pushdown.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    lateralRaise: withSyncFields({
      name: 'Lateral Raise',
      body_parts: ['shoulders'],
      description: 'DB lateral raise.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    frontRaise: withSyncFields({
      name: 'Front Raise',
      body_parts: ['shoulders'],
      description: 'DB front raise.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    legPress: withSyncFields({
      name: 'Leg Press',
      body_parts: ['quads', 'glutes'],
      description: '45 degree leg press.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    rdl: withSyncFields({
      name: 'Romanian Deadlift',
      body_parts: ['hamstrings', 'glutes'],
      description: 'Romanian deadlift.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    legCurl: withSyncFields({
      name: 'Leg Curl',
      body_parts: ['hamstrings'],
      description: 'Machine leg curl.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    legExtension: withSyncFields({
      name: 'Leg Extension',
      body_parts: ['quads'],
      description: 'Machine extension.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    calfRaise: withSyncFields({
      name: 'Standing Calf Raise',
      body_parts: ['calves'],
      description: 'Standing calf raise.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    seatedCalf: withSyncFields({
      name: 'Seated Calf Raise',
      body_parts: ['calves'],
      description: 'Seated calf raise.',
      video_url: null,
      image_urls: [],
      measurement_type: 'weight_reps' as const,
    }),
    hangingLegRaise: withSyncFields({
      name: 'Hanging Leg Raise',
      body_parts: ['core'],
      description: 'Leg raises.',
      video_url: null,
      image_urls: [],
      measurement_type: 'reps' as const,
    }),
    russianTwist: withSyncFields({
      name: 'Russian Twist',
      body_parts: ['core'],
      description: 'Weighted twist.',
      video_url: null,
      image_urls: [],
      measurement_type: 'reps' as const,
    }),
    bicycleCrunch: withSyncFields({
      name: 'Bicycle Crunch',
      body_parts: ['core'],
      description: 'Alternating crunch.',
      video_url: null,
      image_urls: [],
      measurement_type: 'reps' as const,
    }),
    elliptical: withSyncFields({
      name: 'Elliptical',
      body_parts: ['cardio'],
      description: 'Elliptical trainer.',
      video_url: null,
      image_urls: [],
      measurement_type: 'distance_time' as const,
    }),
  };
  await bulkPut('exercises', [
    ...Object.values(ex),
    ...Object.values(extraExercises),
  ]);
  

  // Workout templates.
  const push = withSyncFields({ name: 'Push Day', description: 'Chest, shoulders, triceps.' });
  const pull = withSyncFields({ name: 'Pull Day', description: 'Back and biceps.' });
  const legs = withSyncFields({ name: 'Leg Day', description: 'Squat-focused lower body.' });
  const extraTemplates = [
    withSyncFields({ name: 'Upper Body A', description: 'Upper body workout.' }),
    withSyncFields({ name: 'Upper Body B', description: 'Upper body workout.' }),
    withSyncFields({ name: 'Lower Body A', description: 'Lower body workout.' }),
    withSyncFields({ name: 'Lower Body B', description: 'Lower body workout.' }),
    withSyncFields({ name: 'Chest Focus', description: 'Chest emphasis.' }),
    withSyncFields({ name: 'Back Focus', description: 'Back emphasis.' }),
    withSyncFields({ name: 'Shoulder Day', description: 'Shoulders.' }),
    withSyncFields({ name: 'Arm Day', description: 'Arms.' }),
    withSyncFields({ name: 'Full Body A', description: 'Full body.' }),
    withSyncFields({ name: 'Cardio & Core', description: 'Cardio and abs.' }),
  ];
  await bulkPut('workout_templates', [push, pull, legs]);
  await bulkPut('workout_templates', extraTemplates);

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
  const extraTemplateExercises:any[] = [];

  extraTemplates.forEach((t, i) => {
    const exercisePool = [
      extraExercises.inclineBench,
      extraExercises.latPulldown,
      extraExercises.legPress,
      extraExercises.lateralRaise,
      extraExercises.curl,
      extraExercises.pushdown,
      extraExercises.elliptical,
      extraExercises.hangingLegRaise,
    ];

    exercisePool.slice(0, 4).forEach((e, pos) => {
      extraTemplateExercises.push(
        withSyncFields({
          workout_template_id: t.id,
          exercise_id: e.id,
          position: pos,
          set_count: 3,
          superset_group: null,
          target_reps: e.measurement_type === 'distance_time' ? null : 10,
          target_weight_kg:
            e.measurement_type === 'weight_reps' ? 40 : null,
          target_time_seconds:
            e.measurement_type === 'distance_time' ? 900 : null,
          target_distance_km:
            e.measurement_type === 'distance_time' ? 3 : null,
        })
      );
    });
  });

  await bulkPut('workout_template_exercises', extraTemplateExercises);
  await bulkPut('workout_template_exercises', tmplExercises);


  // Program template: PPL, 3×/week for 8 weeks (Mon/Wed/Fri).
  const ppl = withSyncFields({
    name: 'Push / Pull / Legs',
    description: 'Classic 3-day split.',
    frequency_per_week: 3,
    duration_weeks: 8,
    preferred_days: [1, 3, 5],
  });
    const upperLower = withSyncFields({
    name: 'Upper / Lower',
    description: '4 day split.',
    frequency_per_week: 4,
    duration_weeks: 10,
    preferred_days: [1, 2, 4, 5],
  });

  const broSplit = withSyncFields({
    name: 'Bro Split',
    description: '5 day bodybuilding split.',
    frequency_per_week: 5,
    duration_weeks: 12,
    preferred_days: [1, 2, 3, 4, 5],
  });

  await bulkPut('program_templates', [upperLower, broSplit]);

  await bulkPut('program_template_workouts', [
    withSyncFields({ program_template_id: upperLower.id, workout_template_id: extraTemplates[0].id, position: 0 }),
    withSyncFields({ program_template_id: upperLower.id, workout_template_id: extraTemplates[2].id, position: 1 }),
    withSyncFields({ program_template_id: upperLower.id, workout_template_id: extraTemplates[1].id, position: 2 }),
    withSyncFields({ program_template_id: upperLower.id, workout_template_id: extraTemplates[3].id, position: 3 }),

    withSyncFields({ program_template_id: broSplit.id, workout_template_id: extraTemplates[4].id, position: 0 }),
    withSyncFields({ program_template_id: broSplit.id, workout_template_id: extraTemplates[5].id, position: 1 }),
    withSyncFields({ program_template_id: broSplit.id, workout_template_id: extraTemplates[6].id, position: 2 }),
    withSyncFields({ program_template_id: broSplit.id, workout_template_id: extraTemplates[7].id, position: 3 }),
    withSyncFields({ program_template_id: broSplit.id, workout_template_id: legs.id, position: 4 }),
  ]);
  await put('program_templates', ppl as ProgramTemplate);
  await bulkPut(
    'program_template_workouts',
    [push, pull, legs].map((wt, i) =>
      withSyncFields({ program_template_id: ppl.id, workout_template_id: wt.id, position: i })
    )
  );

  // -----------------------------------------------------------------------------
  // Historical completed program
  // -----------------------------------------------------------------------------

  const oldProgramStart = addDays(
    todayLocal(),
    -(ppl.duration_weeks * 7 + 14)
  );

  await startProgram(ppl as ProgramTemplate, oldProgramStart);

  const previousProgram = (
    await byIndex<Program>('programs', 'state', 'active')
  ).find((p) => p.started_on === oldProgramStart)!;

  const previousWorkouts = (
    await byIndex<Workout>('workouts', 'program_id', previousProgram.id)
  ).sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!));

  let completedCount = 0;

  for (const workout of previousWorkouts) {
    if (!workout.scheduled_on) continue;

    // Skip roughly every 5th workout
    if (completedCount % 5 === 4) {
      await skipWorkout(workout);
      completedCount++;
      continue;
    }

    await startWorkout(workout);

    const wes = await byIndex<WorkoutExercise>(
      'workout_exercises',
      'workout_id',
      workout.id
    );

    for (const we of wes) {
      const sets = await byIndex<WorkoutSet>(
        'workout_sets',
        'workout_exercise_id',
        we.id
      );

      for (const s of sets) {
        const done = { ...s, completed: true };

        if (done.weight_kg != null)
          done.weight_kg += Math.floor(completedCount / 2) * 2.5;

        if (done.reps != null)
          done.reps += Math.floor(completedCount / 4);

        if (done.time_seconds != null)
          done.time_seconds += Math.floor(completedCount / 3) * 10;

        await put('workout_sets', done);
      }
    }

    const fresh = (
      await byIndex<Workout>('workouts', 'program_id', previousProgram.id)
    ).find((w) => w.id === workout.id)!;

    await finishWorkout(fresh);

    const finished = (
      await byIndex<Workout>('workouts', 'program_id', previousProgram.id)
    ).find((w) => w.id === workout.id)!;

    await put('workouts', {
      ...finished,
      started_at: isoAtNoon(workout.scheduled_on),
      completed_at: isoAtNoon(workout.scheduled_on),
    });

    completedCount++;
  }

  // mark the historical program complete so the next one can become active
  await put('programs', {
    ...previousProgram,
    state: 'completed',
  });


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

  return `Seeded ${Object.keys(ex).length+Object.keys(extraExercises).length} exercises, ${3+extraTemplates.length} workout templates, 3 programs, and ${weights.length} weight entries.`;
}

/**
 * Heavy-usage seed: deliberately large so every paginated page overflows —
 * 300 exercises (exercises page paginates at 250), 300 completed workouts
 * (history paginates at 250), and 60 record-bearing exercises (records
 * paginate at 45). Rows are built directly and bulk-inserted rather than
 * driven through the workout services, which would be far too slow at this
 * volume.
 */
async function seedHeavy(): Promise<string> {
  const existing = await all<Exercise>('exercises');
  if (existing.length > 0) {
    return 'Seed skipped: exercises already exist. Import/export or clear site data first.';
  }

  const profiles = await all<UserProfile>('user_profile');
  if (profiles.length === 0) {
    await put(
      'user_profile',
      newProfile({
        name: null,
        highlighted_exercise_ids: [],
        display_weight_unit: 'kg' as const,
        display_distance_unit: 'km' as const,
        age_years: 30,
        height_cm: 180,
        experience_level: 'advanced' as const,
        weight_tracking_enabled: true,
        onboarding_completed_at: nowIso(),
      })
    );
  }

  const BODY_PART_POOL: BodyPart[] = [
    'chest', 'back', 'lats', 'traps', 'shoulders', 'biceps', 'triceps',
    'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core',
  ];
  const TOTAL_EXERCISES = 300;
  const RECORD_POOL_SIZE = 60; // > 45 so the records page paginates
  const TOTAL_WORKOUTS = 300; // > 250 so the history page paginates

  // --- Exercises. The first RECORD_POOL_SIZE are weight_reps (they'll get
  // completed sets and therefore records); the rest are varied filler so the
  // exercises page has plenty to page through.
  const FILLER_TYPES: MeasurementType[] = ['weight_reps', 'reps', 'time', 'distance', 'distance_time', 'weight_time'];
  const exerciseRows: (Exercise & { id: string })[] = [];
  for (let i = 0; i < TOTAL_EXERCISES; i++) {
    const isRecordPool = i < RECORD_POOL_SIZE;
    const bodyParts = [BODY_PART_POOL[i % BODY_PART_POOL.length]];
    exerciseRows.push(
      withSyncFields({
        name: `Exercise ${String(i + 1).padStart(3, '0')}`,
        body_parts: bodyParts,
        description: 'Generated for heavy-usage testing.',
        video_url: null,
        image_urls: [],
        measurement_type: isRecordPool ? ('weight_reps' as const) : FILLER_TYPES[i % FILLER_TYPES.length],
      })
    ) as Exercise & { id: string };
  }
  await bulkPut('exercises', exerciseRows);
  const recordPool = exerciseRows.slice(0, RECORD_POOL_SIZE);

  // --- Templates (each pulls 4 exercises from the record pool).
  const TEMPLATE_COUNT = 15;
  const templateRows: (WorkoutTemplate & { id: string })[] = [];
  const templateExerciseRows: unknown[] = [];
  for (let t = 0; t < TEMPLATE_COUNT; t++) {
    const tpl = withSyncFields({
      name: `Program Day ${String(t + 1).padStart(2, '0')}`,
      description: 'Generated template.',
    }) as WorkoutTemplate & { id: string };
    templateRows.push(tpl);
    for (let p = 0; p < 4; p++) {
      const ex = recordPool[(t * 4 + p) % recordPool.length];
      templateExerciseRows.push(
        withSyncFields({
          workout_template_id: tpl.id,
          exercise_id: ex.id,
          position: p,
          set_count: 3,
          superset_group: null,
          target_reps: 8,
          target_weight_kg: 40,
          target_time_seconds: null,
          target_distance_km: null,
        })
      );
    }
  }
  await bulkPut('workout_templates', templateRows);
  await bulkPut('workout_template_exercises', templateExerciseRows);

  // --- Completed workouts spread over the past ~300 days, each with 3
  // exercises from the record pool and 3 sets with weights that climb over
  // time so the records show progressions.
  const workoutRows: unknown[] = [];
  const workoutExerciseRows: unknown[] = [];
  const workoutSetRows: unknown[] = [];
  for (let w = 0; w < TOTAL_WORKOUTS; w++) {
    const daysAgo = TOTAL_WORKOUTS - w; // oldest first
    const date = addDays(todayLocal(), -daysAgo);
    const completedAt = isoAtNoon(date);
    const template = templateRows[w % TEMPLATE_COUNT];
    const workout = withSyncFields({
      program_id: null,
      workout_template_id: template.id,
      name: template.name,
      scheduled_on: null,
      original_scheduled_on: null,
      state: 'completed' as const,
      started_at: completedAt,
      completed_at: completedAt,
    }) as Workout & { id: string };
    workoutRows.push(workout);

    for (let p = 0; p < 3; p++) {
      const ex = recordPool[(w * 3 + p) % recordPool.length];
      const we = withSyncFields({
        workout_id: workout.id,
        exercise_id: ex.id,
        position: p,
        superset_group: null,
      }) as WorkoutExercise & { id: string };
      workoutExerciseRows.push(we);
      for (let s = 0; s < 3; s++) {
        // Weight climbs with the workout index → PR progression over time.
        const weight = 40 + Math.floor(w / 20) * 2.5 + (p % 3) * 5;
        workoutSetRows.push(
          withSyncFields({
            workout_exercise_id: we.id,
            position: s,
            completed: true,
            reps: 8,
            weight_kg: weight,
            time_seconds: null,
            distance_km: null,
          })
        );
      }
    }
  }
  // --- Programs. Without these the Programs page is empty under the heavy
  // seed. Build 3 program templates and 3 instances (2 completed, 1 active),
  // then adopt the completed workouts above into the matching date windows so
  // each program has real history (and per-program records have data).
  const PROGRAM_SPECS = [
    { name: 'Heavy Program A', startDaysAgo: 300, endDaysAgo: 200, state: 'completed' as const, freq: 4, days: [1, 2, 4, 5], tpl: [0, 1, 2, 3, 4] },
    { name: 'Heavy Program B', startDaysAgo: 199, endDaysAgo: 90, state: 'completed' as const, freq: 5, days: [1, 2, 3, 4, 5], tpl: [5, 6, 7, 8, 9] },
    { name: 'Heavy Program C', startDaysAgo: 89, endDaysAgo: -30, state: 'active' as const, freq: 3, days: [1, 3, 5], tpl: [10, 11, 12] },
  ];

  const programTemplateRows: unknown[] = [];
  const programTemplateWorkoutRows: unknown[] = [];
  const programRows: (Program & { id: string })[] = [];
  for (const spec of PROGRAM_SPECS) {
    const durationWeeks = Math.max(1, Math.round((spec.startDaysAgo - spec.endDaysAgo) / 7));
    const pt = withSyncFields({
      name: spec.name,
      description: `Generated ${spec.state} program.`,
      frequency_per_week: spec.freq,
      duration_weeks: durationWeeks,
      preferred_days: spec.days,
    }) as ProgramTemplate & { id: string };
    programTemplateRows.push(pt);
    spec.tpl.forEach((ti, pos) => {
      programTemplateWorkoutRows.push(
        withSyncFields({
          program_template_id: pt.id,
          workout_template_id: templateRows[ti].id,
          position: pos,
        })
      );
    });

    const startedOn = addDays(todayLocal(), -spec.startDaysAgo);
    const endsOn = addDays(todayLocal(), -spec.endDaysAgo);
    programRows.push(
      withSyncFields({
        program_template_id: pt.id,
        name: spec.name,
        description: `Generated ${spec.state} program.`,
        frequency_per_week: spec.freq,
        duration_weeks: durationWeeks,
        preferred_days: spec.days,
        started_on: startedOn,
        ends_on: endsOn,
        state: spec.state,
      }) as Program & { id: string }
    );
  }
  await bulkPut('program_templates', programTemplateRows);
  await bulkPut('program_template_workouts', programTemplateWorkoutRows);
  await bulkPut('programs', programRows);

  // Adopt completed workouts into whichever program window they fall in, and
  // give them a scheduled_on so the schedule/records line up.
  for (const w of workoutRows as (Workout & { id: string })[]) {
    const day = (w.completed_at ?? '').slice(0, 10);
    const owner = programRows.find((p) => day >= p.started_on && day <= p.ends_on);
    if (owner) {
      w.program_id = owner.id;
      w.scheduled_on = day;
    }
  }

  await bulkPut('workouts', workoutRows);
  await bulkPut('workout_exercises', workoutExerciseRows);
  await bulkPut('workout_sets', workoutSetRows);

  // Future scheduled workouts for the active program so it has upcoming days.
  const active = programRows.find((p) => p.state === 'active')!;
  const activeSpec = PROGRAM_SPECS.find((s) => s.state === 'active')!;
  const futureWorkoutRows: unknown[] = [];
  const sortedDays = [...activeSpec.days].sort((a, b) => a - b);
  let rot = 0;
  const weekStart = addDays(todayLocal(), -dayOfWeek(todayLocal()));
  for (let week = 0; week < 60; week++) {
    if (addDays(weekStart, week * 7) > active.ends_on) break;
    for (const d of sortedDays) {
      const date = addDays(weekStart, week * 7 + d);
      if (date <= todayLocal() || date > active.ends_on) continue;
      const tpl = templateRows[activeSpec.tpl[rot % activeSpec.tpl.length]];
      rot++;
      futureWorkoutRows.push(
        withSyncFields({
          program_id: active.id,
          workout_template_id: tpl.id,
          name: tpl.name,
          scheduled_on: date,
          original_scheduled_on: null,
          state: 'scheduled' as const,
          started_at: null,
          completed_at: null,
          notes: null,
        })
      );
    }
  }
  await bulkPut('workouts', futureWorkoutRows);

  // --- A year of weekly body-weight entries.
  const bodyWeights = Array.from({ length: 52 }, (_, i) =>
    withSyncFields({
      weight_kg: Math.round((88 - i * 0.08) * 10) / 10,
      measured_on: addDays(todayLocal(), -7 * (51 - i)),
    })
  );
  await bulkPut('body_weight_entries', bodyWeights);

  return `Heavy seed: ${TOTAL_EXERCISES} exercises, ${TEMPLATE_COUNT} templates, ${PROGRAM_SPECS.length} programs (1 active, 2 past), ${TOTAL_WORKOUTS} completed workouts (${RECORD_POOL_SIZE} exercises with records), ${bodyWeights.length} weight entries.`;
}
