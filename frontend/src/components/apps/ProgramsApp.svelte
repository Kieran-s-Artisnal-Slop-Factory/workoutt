<script lang="ts">
  import { onMount } from 'svelte';
  import { all, byIndex, put, softDelete, softDeleteMany, withSyncFields } from '../../lib/db/repo';
  import {
    startProgram,
    abandonProgram,
    programProgress,
    getActiveProgram,
  } from '../../lib/services/workouts';
  import { computeRecords, type ExerciseRecords } from '../../lib/services/records';
  import { formatDate, WEEKDAYS_SHORT } from '../../lib/utils/dates';
  import { formatWeight } from '../../lib/utils/units';
  import type {
    BodyWeightEntry,
    Program,
    ProgramTemplate,
    ProgramTemplateWorkout,
    UserProfile,
    WorkoutTemplate,
  } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Accordion from '../Accordion.svelte';

  let loading = $state(true);
  let programTemplates: ProgramTemplate[] = $state([]);
  let rotations: ProgramTemplateWorkout[] = $state([]);
  let workoutTemplates: WorkoutTemplate[] = $state([]);
  let activeProgram: Program | undefined = $state();
  let progress = $state({ completed: 0, total: 0 });
  let pastPrograms: Program[] = $state([]);
  let allRecords: ExerciseRecords[] = $state([]);
  let weightEntries: BodyWeightEntry[] = $state([]);
  let profile: UserProfile | undefined = $state();
  let busy = $state(false);

  let showForm = $state(false);
  let editingId: string | null = $state(null);
  let fName = $state('');
  let fDescription = $state('');
  let fFrequency = $state(3);
  let fWeeks = $state(8);
  let fDays: number[] = $state([1, 3, 5]);
  let fRotation: { existingId: string | null; workout_template_id: string }[] = $state([]);

  const wtById = $derived(new Map(workoutTemplates.map((t) => [t.id, t])));
  const wu = $derived(profile?.display_weight_unit ?? 'kg');

  onMount(refresh);

  async function refresh() {
    [programTemplates, rotations, workoutTemplates] = await Promise.all([
      all<ProgramTemplate>('program_templates'),
      all<ProgramTemplateWorkout>('program_template_workouts'),
      all<WorkoutTemplate>('workout_templates'),
    ]);
    programTemplates.sort((a, b) => a.name.localeCompare(b.name));
    workoutTemplates.sort((a, b) => a.name.localeCompare(b.name));
    profile = (await all<UserProfile>('user_profile'))[0];

    activeProgram = await getActiveProgram();
    if (activeProgram) progress = await programProgress(activeProgram);

    const programs = await all<Program>('programs');
    pastPrograms = programs
      .filter((p) => p.state !== 'active')
      .sort((a, b) => b.started_on.localeCompare(a.started_on));

    if (pastPrograms.length > 0) {
      allRecords = await computeRecords();
      weightEntries = (await all<BodyWeightEntry>('body_weight_entries')).sort((a, b) =>
        a.measured_on.localeCompare(b.measured_on)
      );
    }
    loading = false;
  }

  function rotationFor(templateId: string): ProgramTemplateWorkout[] {
    return rotations
      .filter((r) => r.program_template_id === templateId)
      .sort((a, b) => a.position - b.position);
  }

  function openNew() {
    editingId = null;
    fName = '';
    fDescription = '';
    fFrequency = 3;
    fWeeks = 8;
    fDays = [1, 3, 5];
    fRotation = workoutTemplates[0]
      ? [{ existingId: null, workout_template_id: workoutTemplates[0].id }]
      : [];
    showForm = true;
  }

  function openEdit(t: ProgramTemplate) {
    editingId = t.id;
    fName = t.name;
    fDescription = t.description;
    fFrequency = t.frequency_per_week;
    fWeeks = t.duration_weeks;
    fDays = [...t.preferred_days];
    fRotation = rotationFor(t.id).map((r) => ({
      existingId: r.id,
      workout_template_id: r.workout_template_id,
    }));
    showForm = true;
  }

  function toggleDay(d: number) {
    fDays = fDays.includes(d) ? fDays.filter((x) => x !== d) : [...fDays, d].sort((a, b) => a - b);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;

    const fields = {
      name: fName.trim(),
      description: fDescription.trim(),
      frequency_per_week: Number(fFrequency),
      duration_weeks: Number(fWeeks),
      preferred_days: $state.snapshot(fDays) as number[],
    };
    let template: ProgramTemplate;
    if (editingId) {
      const existing = programTemplates.find((t) => t.id === editingId)!;
      template = await put('program_templates', { ...$state.snapshot(existing), ...fields } as ProgramTemplate);
    } else {
      template = await put('program_templates', withSyncFields(fields));
    }

    const keptIds = new Set(fRotation.map((r) => r.existingId).filter(Boolean));
    const removed = rotationFor(template.id).filter((r) => !keptIds.has(r.id));
    await softDeleteMany('program_template_workouts', removed.map((r) => r.id));

    for (const [position, row] of fRotation.entries()) {
      const rowFields = {
        program_template_id: template.id,
        workout_template_id: row.workout_template_id,
        position,
      };
      if (row.existingId) {
        const existing = rotations.find((r) => r.id === row.existingId)!;
        await put('program_template_workouts', { ...$state.snapshot(existing), ...rowFields } as ProgramTemplateWorkout);
      } else {
        await put('program_template_workouts', withSyncFields(rowFields));
      }
    }

    showForm = false;
    busy = false;
    await refresh();
  }

  async function removeTemplate(t: ProgramTemplate) {
    if (!confirm(`Delete program template "${t.name}"?`)) return;
    await softDeleteMany('program_template_workouts', rotationFor(t.id).map((r) => r.id));
    await softDelete('program_templates', t.id);
    await refresh();
  }

  async function start(t: ProgramTemplate) {
    if (activeProgram) {
      alert('You already have an active program — abandon it first.');
      return;
    }
    if (
      !confirm(
        `Start "${t.name}" today? This schedules ${t.frequency_per_week}×/week for ${t.duration_weeks} weeks.`
      )
    ) {
      return;
    }
    busy = true;
    await startProgram($state.snapshot(t) as ProgramTemplate);
    busy = false;
    await refresh();
  }

  async function abandon() {
    if (!activeProgram) return;
    if (!confirm(`Abandon "${activeProgram.name}"? Completed workouts are kept; remaining scheduled ones are removed.`)) {
      return;
    }
    busy = true;
    await abandonProgram($state.snapshot(activeProgram) as Program);
    busy = false;
    await refresh();
  }

  /** All-time PR improvements achieved within the program's window. */
  function prsDuring(p: Program): { text: string }[] {
    const out: { text: string }[] = [];
    const to = p.ends_on;
    for (const rec of allRecords) {
      for (const [label, progression] of Object.entries(rec.metrics)) {
        for (const entry of progression) {
          if (entry.date >= p.started_on && entry.date <= to) {
            out.push({
              text: `${rec.exercise.name} — ${label}: ${Math.round(entry.value * 10) / 10} (${formatDate(entry.date)})`,
            });
          }
        }
      }
    }
    return out;
  }

  function weightChange(p: Program): string | null {
    const inRange = weightEntries.filter(
      (e) => e.measured_on >= p.started_on && e.measured_on <= p.ends_on
    );
    if (inRange.length < 2) return null;
    const delta = inRange[inRange.length - 1].weight_kg - inRange[0].weight_kg;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${formatWeight(delta, wu)}`;
  }
</script>

<div class="page-header">
  <h1>Programs</h1>
  <button class="btn btn-primary" onclick={openNew} disabled={workoutTemplates.length === 0}>
    New program template
  </button>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  {#if workoutTemplates.length === 0}
    <p class="muted" style="margin-bottom: var(--space-4);">
      <a href="/workouts/">Create workout templates</a> first — programs are built from them.
    </p>
  {/if}

  <div class="stack">
    {#if activeProgram}
      <Card title="Current program">
        <h3>{activeProgram.name}</h3>
        <p class="muted">
          Started {formatDate(activeProgram.started_on)} · ends {formatDate(activeProgram.ends_on)} ·
          {progress.completed}/{progress.total} workouts completed
        </p>
        <div class="form-actions" style="margin-top: var(--space-3);">
          <button class="btn btn-danger" onclick={abandon} disabled={busy}>Abandon program</button>
        </div>
      </Card>
    {/if}

    {#if showForm}
      <Card title={editingId ? 'Edit program template' : 'New program template'}>
        <form class="stack" onsubmit={save}>
          <div>
            <label for="pt-name">Name</label>
            <input id="pt-name" required bind:value={fName} placeholder="e.g. Push / Pull / Legs" />
          </div>
          <div>
            <label for="pt-desc">Description</label>
            <input id="pt-desc" bind:value={fDescription} />
          </div>
          <div class="row">
            <div>
              <label for="pt-freq">Workouts per week</label>
              <input id="pt-freq" type="number" min="1" max="7" bind:value={fFrequency} />
            </div>
            <div>
              <label for="pt-weeks">Program length (weeks)</label>
              <input id="pt-weeks" type="number" min="1" max="52" bind:value={fWeeks} />
            </div>
          </div>

          <div>
            <span class="field-label">Preferred days</span>
            <div class="days">
              {#each WEEKDAYS_SHORT as day, i}
                <button
                  type="button"
                  class="chip"
                  class:selected={fDays.includes(i)}
                  onclick={() => toggleDay(i)}
                >
                  {day}
                </button>
              {/each}
            </div>
            {#if fDays.length < fFrequency}
              <p class="muted" style="font-size: var(--font-size-sm); margin-top: var(--space-1);">
                Fewer preferred days than weekly workouts — extra sessions land on the earliest days
                of the week.
              </p>
            {/if}
          </div>

          <div class="stack" style="gap: var(--space-2);">
            <span class="field-label">Workout rotation (repeats in order)</span>
            {#each fRotation as row, i (i)}
              <div class="rotation-row">
                <span class="muted">{i + 1}.</span>
                <select bind:value={row.workout_template_id} aria-label={`Rotation slot ${i + 1}`}>
                  {#each workoutTemplates as wt}
                    <option value={wt.id}>{wt.name}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="btn btn-danger"
                  onclick={() => (fRotation = fRotation.filter((_, j) => j !== i))}
                  aria-label="Remove rotation slot"
                >
                  ✕
                </button>
              </div>
            {/each}
            <button
              type="button"
              class="btn"
              onclick={() =>
                (fRotation = [
                  ...fRotation,
                  { existingId: null, workout_template_id: workoutTemplates[0].id },
                ])}
            >
              + Add workout
            </button>
          </div>

          <div class="form-actions">
            <button type="button" class="btn" onclick={() => (showForm = false)}>Cancel</button>
            <button
              type="submit"
              class="btn btn-primary"
              disabled={busy || fRotation.length === 0 || fDays.length === 0}
            >
              {editingId ? 'Save changes' : 'Create program template'}
            </button>
          </div>
        </form>
      </Card>
    {/if}

    <h2>Program templates</h2>
    {#if programTemplates.length === 0}
      <p class="muted">No program templates yet.</p>
    {:else}
      {#each programTemplates as t (t.id)}
        <Accordion summary={t.name}>
          {#if t.description}
            <p class="muted" style="margin-bottom: var(--space-2);">{t.description}</p>
          {/if}
          <p style="margin-bottom: var(--space-2);">
            {t.frequency_per_week}×/week for {t.duration_weeks} weeks on
            {t.preferred_days.map((d) => WEEKDAYS_SHORT[d]).join(', ')}
          </p>
          <ol style="padding-left: var(--space-4); margin-bottom: var(--space-3);">
            {#each rotationFor(t.id) as r}
              <li>{wtById.get(r.workout_template_id)?.name ?? 'Unknown template'}</li>
            {/each}
          </ol>
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => start(t)} disabled={busy || !!activeProgram}>
              Start program
            </button>
            <button class="btn" onclick={() => openEdit(t)}>Edit</button>
            <button class="btn btn-danger" onclick={() => removeTemplate(t)}>Delete</button>
          </div>
        </Accordion>
      {/each}
    {/if}

    <h2>Past programs</h2>
    {#if pastPrograms.length === 0}
      <p class="muted">No past programs yet.</p>
    {:else}
      {#each pastPrograms as p (p.id)}
        <Accordion summary={`${p.name} — ${formatDate(p.started_on)} to ${formatDate(p.ends_on)} (${p.state})`}>
          {@const prs = prsDuring(p)}
          {@const wc = weightChange(p)}
          {#if wc}
            <p style="margin-bottom: var(--space-2);">Weight change: <strong>{wc}</strong></p>
          {/if}
          {#if prs.length > 0}
            <strong>PRs achieved:</strong>
            <ul style="padding-left: var(--space-4);">
              {#each prs as pr}
                <li>{pr.text}</li>
              {/each}
            </ul>
          {:else}
            <p class="muted">No PRs recorded during this program.</p>
          {/if}
        </Accordion>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    display: block;
    margin-bottom: var(--space-1);
  }

  .days {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .chip {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    background: var(--surface-color);
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
    line-height: 2;
    cursor: pointer;
  }

  .chip.selected {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
    color: var(--color-primary-strong);
    font-weight: 600;
  }

  .rotation-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .rotation-row select {
    flex: 1;
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
