<script lang="ts">
  /**
   * Interactive first-program walkthrough (reached from onboarding).
   * Three steps — exercises → workout templates → program — with explainers.
   * Nothing is written until the final "Create" click, so moving back and
   * forth never creates duplicates; exercises that already exist (by name)
   * are reused instead of recreated.
   */
  import { onMount } from 'svelte';
  import { all, put, withSyncFields } from '../../lib/db/repo';
  import { startProgram } from '../../lib/services/workouts';
  import { BODY_PARTS, MEASUREMENT_TYPES } from '../../lib/db/types';
  import type { BodyPart, Exercise, MeasurementType, ProgramTemplate } from '../../lib/db/types';
  import { WEEKDAYS_SHORT } from '../../lib/utils/dates';
  import Card from '../Card.svelte';

  const MEASUREMENT_LABELS: Record<MeasurementType, string> = {
    reps: 'Reps only',
    weight_reps: 'Weight + reps',
    distance: 'Distance',
    time: 'Time',
    distance_time: 'Distance + time',
    weight_time: 'Weight + time',
  };

  interface WizExercise {
    name: string;
    body_parts: BodyPart[];
    measurement_type: MeasurementType;
    reused?: boolean;
  }

  interface WizTemplateRow {
    exerciseName: string;
    sets: number | '';
  }

  interface WizTemplate {
    name: string;
    rows: WizTemplateRow[];
  }

  const PPL: {
    exercises: WizExercise[];
    templates: WizTemplate[];
    program: { name: string; frequency: number; weeks: number; days: number[] };
  } = {
    exercises: [
      { name: 'Bench Press', body_parts: ['chest', 'triceps', 'shoulders'], measurement_type: 'weight_reps' },
      { name: 'Overhead Press', body_parts: ['shoulders', 'triceps'], measurement_type: 'weight_reps' },
      { name: 'Barbell Row', body_parts: ['back', 'lats', 'biceps'], measurement_type: 'weight_reps' },
      { name: 'Pull-up', body_parts: ['lats', 'biceps', 'traps'], measurement_type: 'reps' },
      { name: 'Back Squat', body_parts: ['quads', 'glutes', 'hamstrings', 'core'], measurement_type: 'weight_reps' },
      { name: 'Deadlift', body_parts: ['back', 'hamstrings', 'glutes', 'traps'], measurement_type: 'weight_reps' },
      { name: 'Plank', body_parts: ['core'], measurement_type: 'time' },
    ],
    templates: [
      {
        name: 'Push Day',
        rows: [
          { exerciseName: 'Bench Press', sets: 4 },
          { exerciseName: 'Overhead Press', sets: 3 },
          { exerciseName: 'Plank', sets: 3 },
        ],
      },
      {
        name: 'Pull Day',
        rows: [
          { exerciseName: 'Deadlift', sets: 3 },
          { exerciseName: 'Barbell Row', sets: 3 },
          { exerciseName: 'Pull-up', sets: 3 },
        ],
      },
      {
        name: 'Leg Day',
        rows: [
          { exerciseName: 'Back Squat', sets: 5 },
          { exerciseName: 'Plank', sets: 3 },
        ],
      },
    ],
    program: { name: 'Push / Pull / Legs', frequency: 3, weeks: 8, days: [1, 3, 5] },
  };

  let step: 0 | 1 | 2 | 3 = $state(0);
  let mode: 'guided' | 'custom' = $state('guided');
  let existingNames: Set<string> = new Set();

  let exercises: WizExercise[] = $state([]);
  let templates: WizTemplate[] = $state([]);
  let programName = $state('My Program');
  let frequency: number | '' = $state(3);
  let weeks: number | '' = $state(8);
  let days: number[] = $state([1, 3, 5]);
  let startToday = $state(true);

  // Add-exercise mini form (step 1)
  let newName = $state('');
  let newParts: BodyPart[] = $state([]);
  let newType: MeasurementType = $state('weight_reps');

  let stepError = $state('');
  let committing = $state(false);
  let done = $state(false);

  onMount(async () => {
    try {
      existingNames = new Set((await all<Exercise>('exercises')).map((e) => e.name.toLowerCase()));
    } catch {
      // fine — nothing to reuse
    }
  });

  function choosePath(chosen: 'guided' | 'custom') {
    mode = chosen;
    if (chosen === 'guided') {
      exercises = PPL.exercises.map((e) => ({ ...e, body_parts: [...e.body_parts], reused: existingNames.has(e.name.toLowerCase()) }));
      templates = PPL.templates.map((t) => ({ name: t.name, rows: t.rows.map((r) => ({ ...r })) }));
      programName = PPL.program.name;
      frequency = PPL.program.frequency;
      weeks = PPL.program.weeks;
      days = [...PPL.program.days];
    } else {
      exercises = [];
      templates = [{ name: '', rows: [] }];
      programName = 'My Program';
    }
    stepError = '';
    step = 1;
  }

  function toggleNewPart(part: BodyPart) {
    newParts = newParts.includes(part) ? newParts.filter((p) => p !== part) : [...newParts, part];
  }

  function addExercise() {
    const name = newName.trim();
    if (!name || newParts.length === 0) return;
    if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      stepError = `"${name}" is already in your list.`;
      return;
    }
    exercises = [
      ...exercises,
      {
        name,
        body_parts: [...newParts],
        measurement_type: newType,
        reused: existingNames.has(name.toLowerCase()),
      },
    ];
    newName = '';
    newParts = [];
    newType = 'weight_reps';
    stepError = '';
  }

  function removeExercise(i: number) {
    const removed = exercises[i].name;
    exercises = exercises.filter((_, j) => j !== i);
    // Drop any template rows that referenced it.
    for (const t of templates) {
      t.rows = t.rows.filter((r) => r.exerciseName !== removed);
    }
  }

  function toStep2() {
    if (exercises.length === 0) {
      stepError = 'Add at least one exercise to continue.';
      return;
    }
    stepError = '';
    step = 2;
  }

  function toStep3() {
    for (const t of templates) {
      if (!t.name.trim()) {
        stepError = 'Every workout template needs a name.';
        return;
      }
      if (t.rows.length === 0) {
        stepError = `"${t.name}" has no exercises yet — add at least one.`;
        return;
      }
    }
    if (templates.length === 0) {
      stepError = 'Create at least one workout template to continue.';
      return;
    }
    stepError = '';
    step = 3;
  }

  function toggleDay(d: number) {
    days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b);
  }

  async function commit(e: SubmitEvent) {
    e.preventDefault();
    if (days.length === 0) {
      stepError = 'Pick at least one preferred day.';
      return;
    }
    committing = true;
    stepError = '';
    try {
      // Exercises — reuse by name, create the rest.
      const allExisting = await all<Exercise>('exercises');
      const idByName = new Map(allExisting.map((ex) => [ex.name.toLowerCase(), ex.id]));
      const exerciseId = new Map<string, string>();
      for (const ex of exercises) {
        const key = ex.name.toLowerCase();
        let id = idByName.get(key);
        if (!id) {
          const row = await put(
            'exercises',
            withSyncFields({
              name: ex.name,
              body_parts: $state.snapshot(ex.body_parts) as BodyPart[],
              description: '',
              video_url: null,
              image_urls: [],
              measurement_type: ex.measurement_type,
            })
          );
          id = row.id;
        }
        exerciseId.set(ex.name, id);
      }

      // Workout templates + their exercise rows.
      const templateIds: string[] = [];
      for (const t of templates) {
        const tpl = await put('workout_templates', withSyncFields({ name: t.name.trim(), description: '' }));
        templateIds.push(tpl.id);
        for (const [position, row] of t.rows.entries()) {
          await put(
            'workout_template_exercises',
            withSyncFields({
              workout_template_id: tpl.id,
              exercise_id: exerciseId.get(row.exerciseName)!,
              position,
              set_count: Number(row.sets) || 3,
              superset_group: null,
              target_reps: null,
              target_weight_kg: null,
              target_time_seconds: null,
              target_distance_km: null,
            })
          );
        }
      }

      // Program template — the rotation is the templates in listed order.
      const programTemplate = (await put(
        'program_templates',
        withSyncFields({
          name: programName.trim() || 'My Program',
          description: '',
          frequency_per_week: Number(frequency) || 3,
          duration_weeks: Number(weeks) || 8,
          preferred_days: $state.snapshot(days) as number[],
        })
      )) as ProgramTemplate;
      for (const [position, tplId] of templateIds.entries()) {
        await put(
          'program_template_workouts',
          withSyncFields({
            program_template_id: programTemplate.id,
            workout_template_id: tplId,
            position,
          })
        );
      }

      if (startToday) {
        await startProgram(programTemplate);
      }
      done = true;
    } catch (err) {
      console.error('[workoutt setup] failed to create program:', err);
      stepError = 'Something went wrong saving your program — please try again.';
    }
    committing = false;
  }
</script>

{#if done}
  <Card title="You're all set! 🎉">
    <p style="margin-bottom: var(--space-2);">
      <strong>{programName}</strong> is created{startToday ? ' and running — your first workout is on the schedule' : ''}.
    </p>
    <p class="muted" style="margin-bottom: var(--space-3);">
      You can refine everything later: targets and supersets in
      <a href="/workouts/">Workouts</a>, exercise details in
      <a href="/exercises/">Exercises</a>.
    </p>
    <a class="btn btn-primary" href="/">Go to your homepage</a>
  </Card>
{:else if step === 0}
  <Card title="Set up your first program">
    <p style="margin-bottom: var(--space-3);">
      In Workoutt you build things in three layers: <strong>exercises</strong>
      (the movements), <strong>workout templates</strong> (a reusable session
      plan made of exercises), and a <strong>program</strong> (a weekly
      schedule that rotates through your templates). This walkthrough sets up
      all three.
    </p>
    <div class="paths">
      <button type="button" class="path" onclick={() => choosePath('guided')}>
        <strong>Use the classic Push / Pull / Legs</strong>
        <span class="muted">
          A proven 3-day split. Everything is filled in for you — just review
          each step and tweak what you like.
        </span>
      </button>
      <button type="button" class="path" onclick={() => choosePath('custom')}>
        <strong>Build my own from scratch</strong>
        <span class="muted">
          Start with blank forms and we'll walk you through each layer.
        </span>
      </button>
    </div>
  </Card>
{:else}
  <div class="wizard-head">
    <span class="step-chip" class:active={step === 1}>1 · Exercises</span>
    <span class="step-chip" class:active={step === 2}>2 · Workout template</span>
    <span class="step-chip" class:active={step === 3}>3 · Program</span>
  </div>

  {#if stepError}
    <p class="error-msg" role="alert">⚠️ {stepError}</p>
  {/if}

  {#if step === 1}
    <Card title="Step 1 — Exercises">
      <p class="muted explain">
        Exercises are the building blocks: each has a name, the body parts it
        targets, and how it's measured (weight and reps, just reps, time…).
        {#if mode === 'guided'}
          We've picked seven classics for Push/Pull/Legs — remove any you
          don't want or add your own.
        {/if}
      </p>

      {#if exercises.length > 0}
        <ul class="wiz-list">
          {#each exercises as ex, i (ex.name)}
            <li>
              <div>
                <strong>{ex.name}</strong>
                {#if ex.reused}<span class="reuse-badge">already in your library — will be reused</span>{/if}
                <div class="chips">
                  {#each ex.body_parts as part}
                    <span class="chip selected">{part.replace('_', ' ')}</span>
                  {/each}
                  <span class="chip">{MEASUREMENT_LABELS[ex.measurement_type]}</span>
                </div>
              </div>
              <button class="remove" onclick={() => removeExercise(i)} aria-label={`Remove ${ex.name}`}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="add-form">
        <span class="field-label">Add an exercise</span>
        <input bind:value={newName} placeholder="Name, e.g. Lat Pulldown" aria-label="New exercise name" />
        <div class="chips">
          {#each BODY_PARTS as part}
            <button
              type="button"
              class="chip"
              class:selected={newParts.includes(part)}
              onclick={() => toggleNewPart(part)}
            >
              {part.replace('_', ' ')}
            </button>
          {/each}
        </div>
        <div class="add-row">
          <select bind:value={newType} aria-label="Measurement type">
            {#each MEASUREMENT_TYPES as t}
              <option value={t}>{MEASUREMENT_LABELS[t]}</option>
            {/each}
          </select>
          <button type="button" class="btn" onclick={addExercise} disabled={!newName.trim() || newParts.length === 0}>
            + Add
          </button>
        </div>
      </div>

      <div class="wiz-actions">
        <button class="btn" onclick={() => (step = 0)}>Back</button>
        <button class="btn btn-primary" onclick={toStep2}>Continue</button>
      </div>
    </Card>
  {:else if step === 2}
    <Card title="Step 2 — Workout templates">
      <p class="muted explain">
        A workout template is a reusable session plan: which exercises you'll
        do and how many sets of each. When you hit "start workout" the app
        copies the template so you can log what you actually did. (You can add
        set targets and supersets later in the Workouts page.)
      </p>

      {#each templates as t, ti (ti)}
        <div class="tpl-card">
          <div class="tpl-head">
            <input bind:value={t.name} placeholder="Template name, e.g. Push Day" aria-label="Template name" />
            {#if templates.length > 1}
              <button class="remove" onclick={() => (templates = templates.filter((_, j) => j !== ti))} aria-label="Remove template">✕</button>
            {/if}
          </div>
          {#each t.rows as row, ri (ri)}
            <div class="tpl-row">
              <select bind:value={row.exerciseName} aria-label="Exercise">
                {#each exercises as ex}
                  <option value={ex.name}>{ex.name}</option>
                {/each}
              </select>
              <input type="number" min="1" max="20" bind:value={row.sets} placeholder="sets" aria-label="Sets" />
              <button class="remove" onclick={() => (t.rows = t.rows.filter((_, j) => j !== ri))} aria-label="Remove exercise row">✕</button>
            </div>
          {/each}
          <button
            type="button"
            class="btn add-tpl-row"
            onclick={() => (t.rows = [...t.rows, { exerciseName: exercises[0]?.name ?? '', sets: 3 }])}
          >
            + Add exercise
          </button>
        </div>
      {/each}

      <button type="button" class="btn" onclick={() => (templates = [...templates, { name: '', rows: [] }])}>
        + Add another template
      </button>

      <div class="wiz-actions">
        <button class="btn" onclick={() => (step = 1)}>Back</button>
        <button class="btn btn-primary" onclick={toStep3}>Continue</button>
      </div>
    </Card>
  {:else}
    <Card title="Step 3 — Your program">
      <p class="muted explain">
        A program schedules your templates across the week: pick how often you
        train, which days you prefer, and for how long. Workouts rotate
        through your templates in the order from step 2
        ({templates.map((t) => t.name).join(' → ')}). Miss a day and the app
        bumps it forward automatically.
      </p>

      <form class="stack" onsubmit={commit}>
        <div>
          <label for="sp-name">Program name</label>
          <input id="sp-name" required bind:value={programName} />
        </div>
        <div class="row2">
          <div>
            <label for="sp-freq">Workouts per week</label>
            <input id="sp-freq" type="number" min="1" max="7" required bind:value={frequency} />
          </div>
          <div>
            <label for="sp-weeks">Program length (weeks)</label>
            <input id="sp-weeks" type="number" min="1" max="52" required bind:value={weeks} />
          </div>
        </div>
        <div>
          <span class="field-label">Preferred days</span>
          <div class="chips">
            {#each WEEKDAYS_SHORT as day, i}
              <button type="button" class="chip" class:selected={days.includes(i)} onclick={() => toggleDay(i)}>
                {day}
              </button>
            {/each}
          </div>
        </div>
        <label class="start-check">
          <input type="checkbox" bind:checked={startToday} />
          Start this program today (schedules your first workouts)
        </label>

        <div class="wiz-actions">
          <button type="button" class="btn" onclick={() => (step = 2)}>Back</button>
          <button type="submit" class="btn btn-primary" disabled={committing}>
            {committing ? 'Creating…' : startToday ? 'Create & start program' : 'Create program'}
          </button>
        </div>
      </form>
    </Card>
  {/if}
{/if}

<style>
  .paths {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }

  .path {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    text-align: left;
    background: var(--surface-color);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    cursor: pointer;
    font: inherit;
  }

  .path:hover {
    border-color: var(--color-primary);
  }

  .wizard-head {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .step-chip {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-muted-color);
  }

  .step-chip.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-on-primary);
  }

  .explain {
    margin-bottom: var(--space-4);
  }

  .wiz-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .wiz-list li {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  .reuse-badge {
    font-size: var(--font-size-sm);
    color: var(--color-success);
    margin-left: var(--space-2);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  .chip {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    background: var(--surface-color);
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
    line-height: 1.9;
    cursor: pointer;
  }

  .chip.selected {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
    color: var(--color-primary-strong);
    font-weight: 600;
  }

  span.chip {
    cursor: default;
  }

  .add-form {
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    font-weight: 600;
  }

  .add-row {
    display: flex;
    gap: var(--space-2);
  }

  .add-row select {
    flex: 1;
  }

  .tpl-card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tpl-head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .tpl-head input {
    font-weight: 700;
  }

  .tpl-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .tpl-row select {
    flex: 2;
  }

  .tpl-row input {
    flex: 1;
    max-width: 6rem;
  }

  .add-tpl-row {
    align-self: flex-start;
  }

  .remove {
    background: none;
    border: none;
    color: var(--text-muted-color);
    cursor: pointer;
    flex-shrink: 0;
  }

  .remove:hover {
    color: var(--color-danger);
  }

  .row2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .start-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-base);
    color: var(--text-color);
  }

  .start-check input {
    width: auto;
  }

  .wiz-actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-4);
  }

  .error-msg {
    color: var(--color-danger);
    margin-bottom: var(--space-3);
  }

  @media (max-width: 30rem) {
    .row2 {
      grid-template-columns: 1fr;
    }
  }
</style>
