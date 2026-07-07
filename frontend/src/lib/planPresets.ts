/**
 * Guided-plan presets for the setup walkthrough. A plan type + experience
 * level produces a ready-to-review `{exercises, templates, program}` in the
 * shape the wizard consumes.
 *
 * Experience adjusts each plan:
 *   - beginner     (<1yr): 3×/week, no supersets, ≤1 compound per workout
 *   - intermediate (<5yr): 4×/week, supersets allowed, 1–2 compounds
 *   - advanced     (5+yr): 4–5×/week (we use 5), no restrictions
 */
import type { BodyPart, ExperienceLevel, MeasurementType } from './db/types';

export type PlanType = 'cardio' | 'calisthenics' | 'dumbbell_calisthenics' | 'full_gym';

export interface GenExercise {
  name: string;
  body_parts: BodyPart[];
  measurement_type: MeasurementType;
}
export interface GenRow {
  exerciseName: string;
  sets: number;
  superset_group: number | null;
}
export interface GenTemplate {
  name: string;
  rows: GenRow[];
}
export interface GeneratedPlan {
  exercises: GenExercise[];
  templates: GenTemplate[];
  program: { name: string; frequency: number; weeks: number; days: number[] };
}

export const PLAN_OPTIONS: { type: PlanType; label: string; description: string }[] = [
  {
    type: 'cardio',
    label: 'Cardio focused',
    description: 'Centers on improving cardio, with a single upper body day.',
  },
  {
    type: 'calisthenics',
    label: 'Strength focused (Calisthenics)',
    description: 'Fully bodyweight — no extra equipment needed to get started.',
  },
  {
    type: 'dumbbell_calisthenics',
    label: 'Strength focused (Dumbbells + Calisthenics)',
    description: 'Strength work using dumbbells alongside calisthenics.',
  },
  {
    type: 'full_gym',
    label: 'Strength focused (Full gym)',
    description: 'Strength work using a full range of gym equipment.',
  },
];

interface PlanExercise extends GenExercise {
  compound: boolean;
}
interface DayDef {
  name: string;
  exercises: string[]; // references PlanExercise names, in order
}
interface PlanDef {
  program_name: string;
  exercises: PlanExercise[];
  /** Ordered day pool; the first `frequency` are used, so any prefix ≥3 must be coherent. */
  days: DayDef[];
}

const RULES: Record<ExperienceLevel, { frequency: number; maxCompounds: number; allowSupersets: boolean; weeks: number }> = {
  beginner: { frequency: 3, maxCompounds: 1, allowSupersets: false, weeks: 8 },
  intermediate: { frequency: 4, maxCompounds: 2, allowSupersets: true, weeks: 10 },
  advanced: { frequency: 5, maxCompounds: Infinity, allowSupersets: true, weeks: 12 },
};

const PREFERRED_DAYS: Record<number, number[]> = {
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
};

// --- helpers to keep the plan definitions terse
const c = (name: string, body_parts: BodyPart[], measurement_type: MeasurementType): PlanExercise => ({
  name,
  body_parts,
  measurement_type,
  compound: true,
});
const iso = (name: string, body_parts: BodyPart[], measurement_type: MeasurementType): PlanExercise => ({
  name,
  body_parts,
  measurement_type,
  compound: false,
});

const PLANS: Record<PlanType, PlanDef> = {
  cardio: {
    program_name: 'Cardio Focus',
    exercises: [
      iso('Running', ['cardio'], 'distance_time'),
      iso('Cycling', ['cardio'], 'distance_time'),
      iso('Rowing Machine', ['cardio', 'back'], 'distance_time'),
      iso('Incline Walk', ['cardio'], 'distance_time'),
      iso('Jump Rope', ['cardio', 'calves'], 'time'),
      c('Push-up', ['chest', 'triceps'], 'reps'),
      c('Pull-up', ['lats', 'biceps'], 'reps'),
      c('Dumbbell Shoulder Press', ['shoulders', 'triceps'], 'weight_reps'),
      iso('Dumbbell Curl', ['biceps'], 'weight_reps'),
      iso('Plank', ['core'], 'time'),
    ],
    days: [
      { name: 'Cardio · Endurance', exercises: ['Running', 'Plank'] },
      { name: 'Cardio · Intervals', exercises: ['Cycling', 'Jump Rope'] },
      { name: 'Upper Body', exercises: ['Push-up', 'Pull-up', 'Dumbbell Shoulder Press', 'Dumbbell Curl', 'Plank'] },
      { name: 'Cardio · Steady State', exercises: ['Rowing Machine', 'Incline Walk'] },
      { name: 'Cardio · Mixed', exercises: ['Running', 'Jump Rope'] },
    ],
  },
  calisthenics: {
    program_name: 'Calisthenics Strength',
    exercises: [
      c('Pull-up', ['lats', 'biceps'], 'reps'),
      c('Chin-up', ['biceps', 'lats'], 'reps'),
      c('Push-up', ['chest', 'triceps'], 'reps'),
      c('Dip', ['chest', 'triceps'], 'reps'),
      c('Pike Push-up', ['shoulders', 'triceps'], 'reps'),
      c('Inverted Row', ['back', 'biceps'], 'reps'),
      c('Bodyweight Squat', ['quads', 'glutes'], 'reps'),
      c('Walking Lunge', ['quads', 'glutes'], 'reps'),
      c('Pistol Squat', ['quads', 'glutes'], 'reps'),
      iso('Plank', ['core'], 'time'),
      iso('Hanging Leg Raise', ['core'], 'reps'),
      iso('Calf Raise', ['calves'], 'reps'),
      iso('Superman', ['back'], 'time'),
    ],
    days: [
      { name: 'Push', exercises: ['Push-up', 'Dip', 'Pike Push-up', 'Plank'] },
      { name: 'Pull', exercises: ['Pull-up', 'Chin-up', 'Inverted Row', 'Hanging Leg Raise'] },
      { name: 'Legs', exercises: ['Bodyweight Squat', 'Walking Lunge', 'Pistol Squat', 'Calf Raise'] },
      { name: 'Core & Mobility', exercises: ['Plank', 'Hanging Leg Raise', 'Superman'] },
      { name: 'Full Body', exercises: ['Push-up', 'Pull-up', 'Bodyweight Squat', 'Plank'] },
    ],
  },
  dumbbell_calisthenics: {
    program_name: 'Dumbbell & Calisthenics',
    exercises: [
      c('Dumbbell Bench Press', ['chest', 'triceps'], 'weight_reps'),
      c('Dumbbell Row', ['back', 'lats', 'biceps'], 'weight_reps'),
      c('Dumbbell Shoulder Press', ['shoulders', 'triceps'], 'weight_reps'),
      c('Goblet Squat', ['quads', 'glutes'], 'weight_reps'),
      c('Dumbbell RDL', ['hamstrings', 'glutes'], 'weight_reps'),
      c('Dumbbell Lunge', ['quads', 'glutes'], 'weight_reps'),
      c('Pull-up', ['lats', 'biceps'], 'reps'),
      c('Dip', ['chest', 'triceps'], 'reps'),
      iso('Dumbbell Curl', ['biceps'], 'weight_reps'),
      iso('Dumbbell Lateral Raise', ['shoulders'], 'weight_reps'),
      iso('Dumbbell Calf Raise', ['calves'], 'weight_reps'),
      iso('Plank', ['core'], 'time'),
    ],
    days: [
      { name: 'Upper A', exercises: ['Dumbbell Bench Press', 'Dumbbell Row', 'Dumbbell Curl', 'Dumbbell Lateral Raise', 'Plank'] },
      { name: 'Lower A', exercises: ['Goblet Squat', 'Dumbbell RDL', 'Dumbbell Calf Raise', 'Plank'] },
      { name: 'Upper B', exercises: ['Dumbbell Shoulder Press', 'Pull-up', 'Dip', 'Dumbbell Curl'] },
      { name: 'Lower B', exercises: ['Dumbbell Lunge', 'Goblet Squat', 'Dumbbell Calf Raise'] },
      { name: 'Full Body', exercises: ['Dumbbell Bench Press', 'Goblet Squat', 'Dumbbell Row', 'Plank'] },
    ],
  },
  full_gym: {
    program_name: 'Full Gym Strength',
    exercises: [
      c('Bench Press', ['chest', 'triceps'], 'weight_reps'),
      c('Barbell Row', ['back', 'lats', 'biceps'], 'weight_reps'),
      c('Overhead Press', ['shoulders', 'triceps'], 'weight_reps'),
      c('Back Squat', ['quads', 'glutes', 'core'], 'weight_reps'),
      c('Deadlift', ['back', 'hamstrings', 'glutes'], 'weight_reps'),
      c('Romanian Deadlift', ['hamstrings', 'glutes'], 'weight_reps'),
      c('Lat Pulldown', ['lats', 'biceps'], 'weight_reps'),
      c('Leg Press', ['quads', 'glutes'], 'weight_reps'),
      iso('Cable Fly', ['chest'], 'weight_reps'),
      iso('Bicep Curl', ['biceps'], 'weight_reps'),
      iso('Tricep Pushdown', ['triceps'], 'weight_reps'),
      iso('Lateral Raise', ['shoulders'], 'weight_reps'),
      iso('Leg Curl', ['hamstrings'], 'weight_reps'),
      iso('Calf Raise', ['calves'], 'weight_reps'),
      iso('Plank', ['core'], 'time'),
    ],
    days: [
      { name: 'Push', exercises: ['Bench Press', 'Overhead Press', 'Cable Fly', 'Tricep Pushdown', 'Lateral Raise'] },
      { name: 'Pull', exercises: ['Deadlift', 'Barbell Row', 'Lat Pulldown', 'Bicep Curl'] },
      { name: 'Legs', exercises: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Calf Raise'] },
      { name: 'Upper', exercises: ['Bench Press', 'Barbell Row', 'Overhead Press', 'Bicep Curl', 'Tricep Pushdown'] },
      { name: 'Lower', exercises: ['Back Squat', 'Leg Press', 'Leg Curl', 'Calf Raise', 'Plank'] },
    ],
  },
};

export function generatePlan(type: PlanType, experience: ExperienceLevel): GeneratedPlan {
  const def = PLANS[type];
  const rule = RULES[experience];
  const byName = new Map(def.exercises.map((e) => [e.name, e]));
  const frequency = rule.frequency;
  const usedNames = new Set<string>();

  const templates: GenTemplate[] = def.days.slice(0, frequency).map((day) => {
    // Resolve exercises, then cap the number of compounds for the experience.
    let compoundsKept = 0;
    const kept = day.exercises
      .map((n) => byName.get(n)!)
      .filter((e): e is PlanExercise => Boolean(e))
      .filter((e) => {
        if (!e.compound) return true;
        if (compoundsKept >= rule.maxCompounds) return false;
        compoundsKept++;
        return true;
      });

    const rows: GenRow[] = kept.map((e) => ({
      exerciseName: e.name,
      sets: e.compound ? 4 : 3,
      superset_group: null,
    }));

    // Supersets (intermediate+): pair up the accessory (isolation) exercises
    // into one group. Cardio machine work (distance-based) is never
    // supersetted — running and cycling aren't accessories.
    if (rule.allowSupersets) {
      const isoRows = rows.filter((r) => {
        const e = byName.get(r.exerciseName)!;
        return !e.compound && e.measurement_type !== 'distance' && e.measurement_type !== 'distance_time';
      });
      if (isoRows.length >= 2) {
        for (const r of isoRows) r.superset_group = 1;
      }
    }

    for (const r of rows) usedNames.add(r.exerciseName);
    return { name: day.name, rows };
  });

  const exercises: GenExercise[] = def.exercises
    .filter((e) => usedNames.has(e.name))
    .map(({ compound, ...rest }) => rest);

  return {
    exercises,
    templates,
    program: {
      name: def.program_name,
      frequency,
      weeks: rule.weeks,
      days: PREFERRED_DAYS[frequency] ?? [1, 3, 5],
    },
  };
}
