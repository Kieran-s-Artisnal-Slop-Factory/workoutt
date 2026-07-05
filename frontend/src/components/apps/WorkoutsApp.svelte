<script lang="ts">
  import { onMount } from 'svelte';
  import { all, byIndex, put, softDelete, softDeleteMany, withSyncFields } from '../../lib/db/repo';
  import { startAdhocWorkout } from '../../lib/services/workouts';
  import { formatWeight, formatDistance, formatDuration, displayToKg, kgToDisplay } from '../../lib/utils/units';
  import { formatTimestamp } from '../../lib/utils/dates';
  import type {
    Exercise,
    UserProfile,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
    WorkoutTemplateExercise,
  } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Accordion from '../Accordion.svelte';

  let loading = $state(true);
  let templates: WorkoutTemplate[] = $state([]);
  let templateExercises: WorkoutTemplateExercise[] = $state([]);
  let exercises: Exercise[] = $state([]);
  let profile: UserProfile | undefined = $state();
  let history: Workout[] = $state([]);
  let historyExercises: WorkoutExercise[] = $state([]);
  let historySets: WorkoutSet[] = $state([]);
  let busy = $state(false);

  interface FormRow {
    existingId: string | null;
    exercise_id: string;
    set_count: number;
    superset_group: number | '';
    target_reps: number | '';
    target_weight: number | ''; // display units
    target_time_seconds: number | '';
    target_distance_km: number | '';
  }

  let showForm = $state(false);
  let editingId: string | null = $state(null);
  let fName = $state('');
  let fDescription = $state('');
  let fRows: FormRow[] = $state([]);

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const exerciseById = $derived(new Map(exercises.map((e) => [e.id, e])));

  onMount(refresh);

  async function refresh() {
    [templates, templateExercises, exercises] = await Promise.all([
      all<WorkoutTemplate>('workout_templates'),
      all<WorkoutTemplateExercise>('workout_template_exercises'),
      all<Exercise>('exercises'),
    ]);
    templates.sort((a, b) => a.name.localeCompare(b.name));
    exercises.sort((a, b) => a.name.localeCompare(b.name));
    profile = (await all<UserProfile>('user_profile'))[0];

    const workouts = await all<Workout>('workouts');
    history = workouts
      .filter((w) => w.state === 'completed' && w.completed_at)
      .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));
    [historyExercises, historySets] = await Promise.all([
      all<WorkoutExercise>('workout_exercises'),
      all<WorkoutSet>('workout_sets'),
    ]);
    loading = false;
  }

  function rowsFor(templateId: string): WorkoutTemplateExercise[] {
    return templateExercises
      .filter((te) => te.workout_template_id === templateId)
      .sort((a, b) => a.position - b.position);
  }

  function emptyRow(): FormRow {
    return {
      existingId: null,
      exercise_id: exercises[0]?.id ?? '',
      set_count: 3,
      superset_group: '',
      target_reps: '',
      target_weight: '',
      target_time_seconds: '',
      target_distance_km: '',
    };
  }

  function openNew() {
    editingId = null;
    fName = '';
    fDescription = '';
    fRows = [emptyRow()];
    showForm = true;
  }

  function openEdit(t: WorkoutTemplate) {
    editingId = t.id;
    fName = t.name;
    fDescription = t.description;
    fRows = rowsFor(t.id).map((te) => ({
      existingId: te.id,
      exercise_id: te.exercise_id,
      set_count: te.set_count,
      superset_group: te.superset_group ?? '',
      target_reps: te.target_reps ?? '',
      target_weight: te.target_weight_kg == null ? '' : Math.round(kgToDisplay(te.target_weight_kg, wu) * 10) / 10,
      target_time_seconds: te.target_time_seconds ?? '',
      target_distance_km: te.target_distance_km ?? '',
    }));
    showForm = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;

    let template: WorkoutTemplate;
    const fields = { name: fName.trim(), description: fDescription.trim() };
    if (editingId) {
      const existing = templates.find((t) => t.id === editingId)!;
      template = await put('workout_templates', { ...$state.snapshot(existing), ...fields } as WorkoutTemplate);
    } else {
      template = await put('workout_templates', withSyncFields(fields));
    }

    // Replace the template's exercise rows: upsert current, tombstone removed.
    const keptIds = new Set(fRows.map((r) => r.existingId).filter(Boolean));
    const removed = rowsFor(template.id).filter((te) => !keptIds.has(te.id));
    await softDeleteMany('workout_template_exercises', removed.map((te) => te.id));

    for (const [position, row] of fRows.entries()) {
      const fieldsRow = {
        workout_template_id: template.id,
        exercise_id: row.exercise_id,
        position,
        set_count: Number(row.set_count) || 1,
        superset_group: row.superset_group === '' ? null : Number(row.superset_group),
        target_reps: row.target_reps === '' ? null : Number(row.target_reps),
        target_weight_kg: row.target_weight === '' ? null : displayToKg(Number(row.target_weight), wu),
        target_time_seconds: row.target_time_seconds === '' ? null : Number(row.target_time_seconds),
        target_distance_km: row.target_distance_km === '' ? null : Number(row.target_distance_km),
      };
      if (row.existingId) {
        const existing = templateExercises.find((te) => te.id === row.existingId)!;
        await put('workout_template_exercises', { ...$state.snapshot(existing), ...fieldsRow } as WorkoutTemplateExercise);
      } else {
        await put('workout_template_exercises', withSyncFields(fieldsRow));
      }
    }

    showForm = false;
    busy = false;
    await refresh();
  }

  async function removeTemplate(t: WorkoutTemplate) {
    if (!confirm(`Delete template "${t.name}"? Past workouts based on it are kept.`)) return;
    await softDeleteMany('workout_template_exercises', rowsFor(t.id).map((te) => te.id));
    await softDelete('workout_templates', t.id);
    await refresh();
  }

  async function startNow(t: WorkoutTemplate) {
    if (busy) return;
    busy = true;
    const workout = await startAdhocWorkout($state.snapshot(t) as WorkoutTemplate);
    location.href = `/workout/?id=${workout.id}`;
  }

  function measurementOf(exerciseId: string) {
    return exerciseById.get(exerciseId)?.measurement_type ?? 'weight_reps';
  }

  function describeTarget(te: WorkoutTemplateExercise): string {
    const parts: string[] = [`${te.set_count}×`];
    if (te.target_reps != null) parts.push(`${te.target_reps} reps`);
    if (te.target_weight_kg != null) parts.push(formatWeight(te.target_weight_kg, wu));
    if (te.target_time_seconds != null) parts.push(formatDuration(te.target_time_seconds));
    if (te.target_distance_km != null)
      parts.push(formatDistance(te.target_distance_km, profile?.display_distance_unit ?? 'km'));
    return parts.join(' ');
  }

  function describeSet(s: WorkoutSet, ex: Exercise | undefined): string {
    const parts: string[] = [];
    if (s.weight_kg != null) parts.push(formatWeight(s.weight_kg, wu));
    if (s.reps != null) parts.push(`× ${s.reps}`);
    if (s.time_seconds != null) parts.push(formatDuration(s.time_seconds));
    if (s.distance_km != null)
      parts.push(formatDistance(s.distance_km, profile?.display_distance_unit ?? 'km'));
    return parts.join(' ') || (ex ? '—' : '—');
  }

  function setsOfHistoryExercise(weId: string): WorkoutSet[] {
    return historySets
      .filter((s) => s.workout_exercise_id === weId && s.completed)
      .sort((a, b) => a.position - b.position);
  }

  function exercisesOfWorkout(workoutId: string): WorkoutExercise[] {
    return historyExercises
      .filter((we) => we.workout_id === workoutId)
      .sort((a, b) => a.position - b.position);
  }
</script>

<div class="page-header">
  <h1>Workouts</h1>
  <button class="btn btn-primary" onclick={openNew} disabled={exercises.length === 0}>
    New template
  </button>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  {#if exercises.length === 0}
    <p class="muted" style="margin-bottom: var(--space-4);">
      <a href="/exercises/">Create some exercises</a> first — templates are built from them.
    </p>
  {/if}

  {#if showForm}
    <Card title={editingId ? 'Edit template' : 'New template'}>
      <form class="stack" onsubmit={save}>
        <div>
          <label for="wt-name">Name</label>
          <input id="wt-name" required bind:value={fName} placeholder="e.g. Push Day" />
        </div>
        <div>
          <label for="wt-desc">Description</label>
          <input id="wt-desc" bind:value={fDescription} />
        </div>

        <div class="stack" style="gap: var(--space-2);">
          <span class="field-label">Exercises (superset: give rows the same group number)</span>
          {#each fRows as row, i (i)}
            {@const mt = measurementOf(row.exercise_id)}
            <div class="row-edit">
              <select bind:value={row.exercise_id} aria-label="Exercise">
                {#each exercises as ex}
                  <option value={ex.id}>{ex.name}</option>
                {/each}
              </select>
              <input type="number" min="1" max="20" bind:value={row.set_count} aria-label="Sets" title="Sets" />
              <input type="number" min="1" bind:value={row.superset_group} placeholder="SS" title="Superset group" aria-label="Superset group" />
              {#if mt === 'reps' || mt === 'weight_reps'}
                <input type="number" min="0" bind:value={row.target_reps} placeholder="reps" aria-label="Target reps" />
              {/if}
              {#if mt === 'weight_reps' || mt === 'weight_time'}
                <input type="number" min="0" step="0.5" bind:value={row.target_weight} placeholder={wu} aria-label="Target weight" />
              {/if}
              {#if mt === 'time' || mt === 'distance_time' || mt === 'weight_time'}
                <input type="number" min="0" bind:value={row.target_time_seconds} placeholder="sec" aria-label="Target seconds" />
              {/if}
              {#if mt === 'distance' || mt === 'distance_time'}
                <input type="number" min="0" step="0.1" bind:value={row.target_distance_km} placeholder="km" aria-label="Target distance (km)" />
              {/if}
              <button type="button" class="btn btn-danger" onclick={() => (fRows = fRows.filter((_, j) => j !== i))} aria-label="Remove exercise row">✕</button>
            </div>
          {/each}
          <button type="button" class="btn" onclick={() => (fRows = [...fRows, emptyRow()])}>
            + Add exercise
          </button>
        </div>

        <div class="form-actions">
          <button type="button" class="btn" onclick={() => (showForm = false)}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={busy || fRows.length === 0}>
            {editingId ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </form>
    </Card>
  {/if}

  <h2 style="margin-bottom: var(--space-3);">Templates</h2>
  {#if templates.length === 0}
    <p class="muted">No templates yet.</p>
  {:else}
    <div class="stack" style="margin-bottom: var(--space-5);">
      {#each templates as t (t.id)}
        <Accordion summary={t.name}>
          {#if t.description}
            <p class="muted" style="margin-bottom: var(--space-2);">{t.description}</p>
          {/if}
          <ul class="exercise-list">
            {#each rowsFor(t.id) as te}
              <li>
                <strong>{exerciseById.get(te.exercise_id)?.name ?? 'Unknown exercise'}</strong>
                — {describeTarget(te)}
                {#if te.superset_group != null}
                  <span class="ss-badge">SS{te.superset_group}</span>
                {/if}
              </li>
            {/each}
          </ul>
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => startNow(t)} disabled={busy}>Start now</button>
            <button class="btn" onclick={() => openEdit(t)}>Edit</button>
            <button class="btn btn-danger" onclick={() => removeTemplate(t)}>Delete</button>
          </div>
        </Accordion>
      {/each}
    </div>
  {/if}

  <h2 style="margin-bottom: var(--space-3);">History</h2>
  {#if history.length === 0}
    <p class="muted">No completed workouts yet.</p>
  {:else}
    <div class="stack">
      {#each history as w (w.id)}
        <Accordion summary={`${w.name} — ${formatTimestamp(w.completed_at!)}`}>
          {#each exercisesOfWorkout(w.id) as we}
            {@const ex = exerciseById.get(we.exercise_id)}
            <div style="margin-bottom: var(--space-2);">
              <strong>{ex?.name ?? 'Unknown exercise'}</strong>
              <ul class="exercise-list">
                {#each setsOfHistoryExercise(we.id) as s}
                  <li>Set {s.position + 1}: {describeSet(s, ex)}</li>
                {/each}
              </ul>
            </div>
          {/each}
        </Accordion>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .row-edit {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }

  .row-edit select {
    flex: 2 1 8rem;
    min-width: 7rem;
  }

  .row-edit input {
    flex: 1 1 3.5rem;
    min-width: 3.5rem;
  }

  .exercise-list {
    padding-left: var(--space-4);
    margin-bottom: var(--space-2);
  }

  .ss-badge {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 700;
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
