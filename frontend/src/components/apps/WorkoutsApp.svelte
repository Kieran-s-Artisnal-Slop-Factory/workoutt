<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, softDelete, softDeleteMany, withSyncFields } from '../../lib/db/repo';
  import { startAdhocWorkout } from '../../lib/services/workouts';
  import { formatWeight, formatDistance, formatDuration, displayToKg, kgToDisplay, displayToKm, kmToDisplay } from '../../lib/utils/units';
  import { formatTimestamp } from '../../lib/utils/dates';
  import { topBodyParts } from '../../lib/utils/bodyparts';
  import type {
    Exercise,
    UserProfile,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
    WorkoutTemplateExercise,
  } from '../../lib/db/types';
  import { BODY_PARTS } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Accordion from '../Accordion.svelte';
  import TimeInput from '../TimeInput.svelte';
  import ChipFilter from '../ChipFilter.svelte';
  import Pagination from '../Pagination.svelte';
  import { href } from '../../lib/paths';

  const HISTORY_PAGE_SIZE = 30;

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
    set_count: number | '';
    superset_group: number | null;
    target_reps: number | '';
    target_weight: number | ''; // display units
    target_time_seconds: number | null;
    target_distance: number | ''; // display units
  }

  let showForm = $state(false);
  let editingId: string | null = $state(null);
  let expandedTemplateId: string | null = $state(null);
  let templateFilterParts: string[] = $state([]);
  let fName = $state('');
  let fDescription = $state('');
  let fRows: FormRow[] = $state([]);
  /** Superset groups that exist but have no rows yet (just created, waiting for drags). */
  let pendingGroups: number[] = $state([]);
  let draggingRow: number | null = $state(null);
  let dragOverGroup: number | null | 'ungrouped' = $state(null);

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const du = $derived(profile?.display_distance_unit ?? 'km');
  const exerciseById = $derived(new Map(exercises.map((e) => [e.id, e])));
  const formGroups = $derived(
    [...new Set([...fRows.map((r) => r.superset_group).filter((g): g is number => g != null), ...pendingGroups])].sort(
      (a, b) => a - b
    )
  );
  /** How many completed workouts came from each template. */
  const completedByTemplate = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const w of history) {
      if (w.workout_template_id) {
        counts.set(w.workout_template_id, (counts.get(w.workout_template_id) ?? 0) + 1);
      }
    }
    return counts;
  });

  let historyPage = $state(0);
  let historySearch = $state('');
  const filteredHistory = $derived(
    historySearch.trim()
      ? history.filter((w) => w.name.toLowerCase().includes(historySearch.trim().toLowerCase()))
      : history
  );
  const pagedHistory = $derived(
    filteredHistory.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)
  );
  $effect(() => {
    historySearch;
    historyPage = 0;
  });

  const visibleTemplates = $derived(
    templates.filter(
      (t) =>
        templateFilterParts.length === 0 ||
        rowsFor(t.id).some((te) =>
          exerciseById.get(te.exercise_id)?.body_parts.some((p) => templateFilterParts.includes(p))
        )
    )
  );

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

  function templateBodyParts(templateId: string) {
    return topBodyParts(
      rowsFor(templateId).map((te) => ({
        exercise: exerciseById.get(te.exercise_id),
        weight: te.set_count,
      }))
    );
  }

  function emptyRow(): FormRow {
    return {
      existingId: null,
      exercise_id: exercises[0]?.id ?? '',
      set_count: 3,
      superset_group: null,
      target_reps: '',
      target_weight: '',
      target_time_seconds: null,
      target_distance: '',
    };
  }

  function openNew() {
    editingId = null;
    fName = '';
    fDescription = '';
    fRows = [emptyRow()];
    pendingGroups = [];
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
      superset_group: te.superset_group,
      target_reps: te.target_reps ?? '',
      target_weight: te.target_weight_kg == null ? '' : Math.round(kgToDisplay(te.target_weight_kg, wu) * 10) / 10,
      target_time_seconds: te.target_time_seconds,
      target_distance: te.target_distance_km == null ? '' : Math.round(kmToDisplay(te.target_distance_km, du) * 100) / 100,
    }));
    pendingGroups = [];
    showForm = true;
  }

  function addSupersetGroup() {
    const used = formGroups;
    pendingGroups = [...pendingGroups, (used[used.length - 1] ?? 0) + 1];
  }

  function dropOnGroup(group: number | null) {
    if (draggingRow == null) return;
    fRows[draggingRow].superset_group = group;
    if (group != null) pendingGroups = pendingGroups.filter((g) => g !== group);
    draggingRow = null;
    dragOverGroup = null;
  }

  // Pointer-event drag instead of HTML5 drag-and-drop: Edge intercepts
  // native drags (shows 🚫) even with drag data set, and pointer events
  // also work on touch screens.
  function rowPointerDown(e: PointerEvent, i: number) {
    draggingRow = i;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released/invalid — dragging still works via bubbling.
    }
  }

  function rowPointerMove(e: PointerEvent) {
    if (draggingRow == null) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-drop-group]') as HTMLElement | null;
    if (!el) {
      dragOverGroup = null;
      return;
    }
    const v = el.dataset.dropGroup!;
    dragOverGroup = v === 'ungrouped' ? 'ungrouped' : Number(v);
  }

  function rowPointerUp() {
    if (draggingRow != null && dragOverGroup != null) {
      dropOnGroup(dragOverGroup === 'ungrouped' ? null : dragOverGroup);
    } else {
      draggingRow = null;
      dragOverGroup = null;
    }
  }

  function rowPointerCancel() {
    draggingRow = null;
    dragOverGroup = null;
  }

  function removeGroup(group: number) {
    for (const row of fRows) {
      if (row.superset_group === group) row.superset_group = null;
    }
    pendingGroups = pendingGroups.filter((g) => g !== group);
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

    // Singleton "supersets" aren't supersets — clear them on save.
    const groupSizes = new Map<number, number>();
    for (const r of fRows) {
      if (r.superset_group != null) groupSizes.set(r.superset_group, (groupSizes.get(r.superset_group) ?? 0) + 1);
    }

    // Persist in visual order: ungrouped rows first, then each group.
    const ordered = [
      ...fRows.filter((r) => r.superset_group == null),
      ...formGroups.flatMap((g) => fRows.filter((r) => r.superset_group === g)),
    ];

    const keptIds = new Set(ordered.map((r) => r.existingId).filter(Boolean));
    const removed = rowsFor(template.id).filter((te) => !keptIds.has(te.id));
    await softDeleteMany('workout_template_exercises', removed.map((te) => te.id));

    for (const [position, row] of ordered.entries()) {
      const group =
        row.superset_group != null && (groupSizes.get(row.superset_group) ?? 0) > 1
          ? row.superset_group
          : null;
      const rowFields = {
        workout_template_id: template.id,
        exercise_id: row.exercise_id,
        position,
        set_count: Number(row.set_count) || 1,
        superset_group: group,
        target_reps: row.target_reps === '' ? null : Number(row.target_reps),
        target_weight_kg: row.target_weight === '' ? null : displayToKg(Number(row.target_weight), wu),
        target_time_seconds: row.target_time_seconds,
        target_distance_km: row.target_distance === '' ? null : displayToKm(Number(row.target_distance), du),
      };
      if (row.existingId) {
        const existing = templateExercises.find((te) => te.id === row.existingId)!;
        await put('workout_template_exercises', { ...$state.snapshot(existing), ...rowFields } as WorkoutTemplateExercise);
      } else {
        await put('workout_template_exercises', withSyncFields(rowFields));
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
    location.href = href(`/workout/?id=${workout.id}`);
  }

  function measurementOf(exerciseId: string) {
    return exerciseById.get(exerciseId)?.measurement_type ?? 'weight_reps';
  }

  function describeTarget(te: WorkoutTemplateExercise): string {
    const parts: string[] = [`${te.set_count}×`];
    if (te.target_reps != null) parts.push(`${te.target_reps} reps`);
    if (te.target_weight_kg != null) parts.push(formatWeight(te.target_weight_kg, wu));
    if (te.target_time_seconds != null) parts.push(formatDuration(te.target_time_seconds));
    if (te.target_distance_km != null) parts.push(formatDistance(te.target_distance_km, du));
    return parts.join(' ');
  }

  function describeSet(s: WorkoutSet): string {
    const parts: string[] = [];
    if (s.weight_kg != null) parts.push(formatWeight(s.weight_kg, wu));
    if (s.reps != null) parts.push(`× ${s.reps}`);
    if (s.time_seconds != null) parts.push(formatDuration(s.time_seconds));
    if (s.distance_km != null) parts.push(formatDistance(s.distance_km, du));
    return parts.join(' ') || '—';
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

  function historyBodyParts(workoutId: string) {
    return topBodyParts(
      exercisesOfWorkout(workoutId).map((we) => ({
        exercise: exerciseById.get(we.exercise_id),
        weight: setsOfHistoryExercise(we.id).length || 1,
      }))
    );
  }
</script>

{#snippet bodyPartChips(parts: string[])}
  {#if parts.length > 0}
    <div class="bp-chips">
      {#each parts as part}
        <span class="bp-chip">{part.replace('_', ' ')}</span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet formRow(row: FormRow, i: number)}
  {@const mt = measurementOf(row.exercise_id)}
  <div class="row-edit" class:dragging={draggingRow === i}>
    <span
      class="drag-handle"
      role="button"
      tabindex="-1"
      title="Drag into a superset group"
      aria-label="Drag to move into a superset group"
      onpointerdown={(e) => rowPointerDown(e, i)}
      onpointermove={rowPointerMove}
      onpointerup={rowPointerUp}
      onpointercancel={rowPointerCancel}>⠿</span>
    <select bind:value={row.exercise_id} aria-label="Exercise">
      {#each exercises as ex}
        <option value={ex.id}>{ex.name}</option>
      {/each}
    </select>
    <input type="number" min="1" max="20" bind:value={row.set_count} placeholder="sets" title="Number of sets" aria-label="Sets" />
    {#if mt === 'reps' || mt === 'weight_reps'}
      <input type="number" min="0" bind:value={row.target_reps} placeholder="reps" title="Target reps" aria-label="Target reps" />
    {/if}
    {#if mt === 'weight_reps' || mt === 'weight_time'}
      <input type="number" min="0" step="0.5" bind:value={row.target_weight} placeholder={wu} title={`Target weight (${wu})`} aria-label="Target weight" />
    {/if}
    {#if mt === 'time' || mt === 'distance_time' || mt === 'weight_time'}
      <TimeInput
        seconds={row.target_time_seconds}
        onchange={(v) => (row.target_time_seconds = v)}
        ariaLabel="Target time"
      />
    {/if}
    {#if mt === 'distance' || mt === 'distance_time'}
      <input type="number" min="0" step="0.1" bind:value={row.target_distance} placeholder={du} title={`Target distance (${du})`} aria-label="Target distance" />
    {/if}
    <button type="button" class="btn btn-danger" onclick={() => (fRows = fRows.filter((_, j) => j !== i))} aria-label="Remove exercise row">✕</button>
  </div>
{/snippet}

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
      <a href={href('/exercises/')}>Create some exercises</a> first — templates are built from them.
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
          <span class="field-label">Exercises — drag the ⠿ handle into a superset group to pair them</span>

          <div
            class="ungrouped"
            class:drag-over={dragOverGroup === 'ungrouped' && draggingRow != null && fRows[draggingRow]?.superset_group != null}
            role="list"
            data-drop-group="ungrouped"
          >
            {#each fRows as row, i (i)}
              {#if row.superset_group == null}
                {@render formRow(row, i)}
              {/if}
            {/each}
            {#if fRows.every((r) => r.superset_group != null)}
              <p class="drop-hint">Drag exercises here to take them out of a superset</p>
            {/if}
          </div>

          {#each formGroups as g (g)}
            <div
              class="ss-box"
              class:drag-over={dragOverGroup === g}
              role="list"
              data-drop-group={g}
            >
              <div class="ss-head">
                <span>Superset {g}</span>
                <button type="button" class="ss-remove" onclick={() => removeGroup(g)} aria-label={`Dissolve superset ${g}`}>
                  Dissolve
                </button>
              </div>
              {#each fRows as row, i (i)}
                {#if row.superset_group === g}
                  {@render formRow(row, i)}
                {/if}
              {/each}
              {#if !fRows.some((r) => r.superset_group === g)}
                <p class="drop-hint">Drag exercises here — they'll be performed back-to-back</p>
              {/if}
            </div>
          {/each}

          <div class="form-list-actions">
            <button type="button" class="btn" onclick={() => (fRows = [...fRows, emptyRow()])}>
              + Add exercise
            </button>
            <button type="button" class="btn" onclick={addSupersetGroup}>
              + New superset group
            </button>
          </div>
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

  <h2 class="section-title" style="margin-bottom: var(--space-3);">Templates</h2>
  {#if templates.length === 0}
    <p class="muted">No templates yet.</p>
  {:else}
    <div style="margin-bottom: var(--space-3);">
      <ChipFilter
        label="Filter by body part"
        options={BODY_PARTS.map((p) => ({ value: p, label: p.replace('_', ' ') }))}
        bind:selected={templateFilterParts}
      />
    </div>
    {#if visibleTemplates.length === 0}
      <p class="muted" style="margin-bottom: var(--space-5);">No templates target those body parts.</p>
    {:else}
    <div class="table-wrap" style="margin-bottom: var(--space-5);">
      <table class="data-table">
        <thead>
          <tr>
            <th>Template</th>
            <th>Body parts</th>
            <th>Exercises</th>
            <th>Completed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each visibleTemplates as t (t.id)}
            <tr
              class="clickable"
              aria-expanded={expandedTemplateId === t.id}
              tabindex="0"
              onclick={() => (expandedTemplateId = expandedTemplateId === t.id ? null : t.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter') expandedTemplateId = expandedTemplateId === t.id ? null : t.id;
              }}
            >
              <td><strong>{t.name}</strong></td>
              <td data-label="Body parts">{@render bodyPartChips(templateBodyParts(t.id))}</td>
              <td class="muted" data-label="Exercises">{rowsFor(t.id).length}</td>
              <td class="muted" data-label="Completed">{completedByTemplate.get(t.id) ?? 0}×</td>
              <td class="actions-cell">
                <button
                  class="btn btn-primary"
                  disabled={busy}
                  onclick={(e) => {
                    e.stopPropagation();
                    startNow(t);
                  }}>Start</button
                >
                <button
                  class="btn"
                  onclick={(e) => {
                    e.stopPropagation();
                    openEdit(t);
                  }}>Edit</button
                >
                <button
                  class="btn btn-danger"
                  onclick={(e) => {
                    e.stopPropagation();
                    removeTemplate(t);
                  }}>Delete</button
                >
              </td>
            </tr>
            {#if expandedTemplateId === t.id}
              <tr class="detail-row">
                <td colspan="5">
                  {#if t.description}
                    <p class="muted" style="margin-bottom: var(--space-2);">{t.description}</p>
                  {/if}
                  <ul class="exercise-list">
                    {#each rowsFor(t.id) as te}
                      <li>
                        <strong>{exerciseById.get(te.exercise_id)?.name ?? 'Unknown exercise'}</strong>
                        — {describeTarget(te)}
                        {#if te.superset_group != null}
                          <span class="ss-badge">Superset {te.superset_group}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
  {/if}

  <h2 class="section-title" style="margin-bottom: var(--space-3);">History</h2>
  {#if history.length === 0}
    <p class="muted">No completed workouts yet.</p>
  {:else}
    <input
      type="search"
      style="margin-bottom: var(--space-3);"
      placeholder="Search history by workout name…"
      bind:value={historySearch}
    />
    {#if filteredHistory.length === 0}
      <p class="muted">No workouts match “{historySearch}”.</p>
    {:else}
    <div class="stack">
      {#each pagedHistory as w (w.id)}
        <Accordion summary={`${w.name} — ${formatTimestamp(w.completed_at!)}`}>
          {@render bodyPartChips(historyBodyParts(w.id))}
          <div style="margin-top: var(--space-2);">
            {#each exercisesOfWorkout(w.id) as we}
              <div style="margin-bottom: var(--space-2);">
                <strong>{exerciseById.get(we.exercise_id)?.name ?? 'Unknown exercise'}</strong>
                <ul class="exercise-list">
                  {#each setsOfHistoryExercise(we.id) as s}
                    <li>Set {s.position + 1}: {describeSet(s)}</li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
          <div class="form-actions">
            <a class="btn" href={href(`/workout/?id=${w.id}&edit=1`)}>Edit workout</a>
          </div>
        </Accordion>
      {/each}
    </div>
    <Pagination
      total={filteredHistory.length}
      pageSize={HISTORY_PAGE_SIZE}
      bind:page={historyPage}
      label="workouts"
    />
    {/if}
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

  .row-edit.dragging {
    opacity: 0.4;
  }

  .drag-handle {
    cursor: grab;
    color: var(--text-muted-color);
    font-size: var(--font-size-lg);
    padding: 0 var(--space-1);
    user-select: none;
    touch-action: none;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .row-edit select {
    flex: 2 1 8rem;
    min-width: 7rem;
  }

  .row-edit input {
    flex: 1 1 3.5rem;
    min-width: 3.5rem;
  }

  .ungrouped {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-radius: var(--radius-md);
    padding: var(--space-1);
  }

  .ss-box {
    border: 2px dashed var(--color-primary);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: color-mix(in srgb, var(--color-primary-soft) 40%, transparent);
  }

  .drag-over {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
    background: var(--color-primary-soft);
  }

  .ss-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 700;
    color: var(--color-primary-strong);
    font-size: var(--font-size-sm);
  }

  .ss-remove {
    background: none;
    border: none;
    color: var(--text-muted-color);
    cursor: pointer;
    font-size: var(--font-size-sm);
    text-decoration: underline;
  }

  .drop-hint {
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-2);
    margin: 0;
  }

  .form-list-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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

  .bp-chips {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .bp-chip {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .actions-cell {
    text-align: right;
    white-space: nowrap;
  }

  .actions-cell button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
  }
</style>
