<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, softDelete, withSyncFields } from '../../lib/db/repo';
  import { BODY_PARTS, MEASUREMENT_TYPES } from '../../lib/db/types';
  import type { BodyPart, Exercise, MeasurementType } from '../../lib/db/types';
  import Card from '../Card.svelte';

  const MEASUREMENT_LABELS: Record<MeasurementType, string> = {
    reps: 'Reps only',
    weight_reps: 'Weight + reps',
    distance: 'Distance',
    time: 'Time',
    distance_time: 'Distance + time',
    weight_time: 'Weight + time',
  };

  let loading = $state(true);
  let exercises: Exercise[] = $state([]);
  let search = $state('');
  let filterPart = $state('');

  let showForm = $state(false);
  let editingId: string | null = $state(null);
  let expandedId: string | null = $state(null);
  let fName = $state('');
  let fParts: BodyPart[] = $state([]);
  let fType: MeasurementType = $state('weight_reps');
  let fDescription = $state('');
  let fVideo = $state('');
  let fImages = $state('');

  const filtered = $derived(
    exercises.filter(
      (e) =>
        (!search || e.name.toLowerCase().includes(search.toLowerCase())) &&
        (!filterPart || e.body_parts.includes(filterPart as BodyPart))
    )
  );

  onMount(refresh);

  async function refresh() {
    exercises = (await all<Exercise>('exercises')).sort((a, b) => a.name.localeCompare(b.name));
    loading = false;
  }

  function openNew() {
    editingId = null;
    fName = '';
    fParts = [];
    fType = 'weight_reps';
    fDescription = '';
    fVideo = '';
    fImages = '';
    showForm = true;
  }

  function openEdit(e: Exercise) {
    editingId = e.id;
    fName = e.name;
    fParts = [...e.body_parts];
    fType = e.measurement_type;
    fDescription = e.description;
    fVideo = e.video_url ?? '';
    fImages = e.image_urls.join(', ');
    showForm = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const fields = {
      name: fName.trim(),
      body_parts: $state.snapshot(fParts) as BodyPart[],
      description: fDescription.trim(),
      video_url: fVideo.trim() || null,
      image_urls: fImages.split(',').map((s) => s.trim()).filter(Boolean),
      measurement_type: fType,
    };
    if (editingId) {
      const existing = exercises.find((x) => x.id === editingId)!;
      await put('exercises', { ...$state.snapshot(existing), ...fields } as Exercise);
    } else {
      await put('exercises', withSyncFields(fields));
    }
    showForm = false;
    await refresh();
  }

  async function remove(e: Exercise) {
    if (!confirm(`Delete "${e.name}"? Past workouts that used it keep their data.`)) return;
    await softDelete('exercises', e.id);
    await refresh();
  }

  function togglePart(part: BodyPart) {
    fParts = fParts.includes(part) ? fParts.filter((p) => p !== part) : [...fParts, part];
  }
</script>

<div class="page-header">
  <h1>Exercises</h1>
  <button class="btn btn-primary" onclick={openNew}>New exercise</button>
</div>

{#if showForm}
  <Card title={editingId ? 'Edit exercise' : 'New exercise'}>
    <form class="stack" onsubmit={save}>
      <div>
        <label for="ex-name">Name</label>
        <input id="ex-name" required bind:value={fName} placeholder="e.g. Pull-up" />
      </div>

      <div>
        <span class="field-label">Body parts targeted</span>
        <div class="chips">
          {#each BODY_PARTS as part}
            <button
              type="button"
              class="chip"
              class:selected={fParts.includes(part)}
              onclick={() => togglePart(part)}
            >
              {part.replace('_', ' ')}
            </button>
          {/each}
        </div>
      </div>

      <div>
        <label for="ex-type">Measurement</label>
        <select id="ex-type" bind:value={fType}>
          {#each MEASUREMENT_TYPES as t}
            <option value={t}>{MEASUREMENT_LABELS[t]}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="ex-desc">Description</label>
        <textarea id="ex-desc" rows="3" bind:value={fDescription}></textarea>
      </div>

      <div>
        <label for="ex-video">Video link (optional)</label>
        <input id="ex-video" type="url" bind:value={fVideo} placeholder="https://…" />
      </div>

      <div>
        <label for="ex-images">Image URLs (optional, comma-separated)</label>
        <input id="ex-images" bind:value={fImages} />
      </div>

      <div class="form-actions">
        <button type="button" class="btn" onclick={() => (showForm = false)}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={fParts.length === 0}>
          {editingId ? 'Save changes' : 'Create exercise'}
        </button>
      </div>
    </form>
  </Card>
{/if}

<div class="filters">
  <input type="search" placeholder="Search exercises…" bind:value={search} />
  <select bind:value={filterPart}>
    <option value="">All body parts</option>
    {#each BODY_PARTS as part}
      <option value={part}>{part.replace('_', ' ')}</option>
    {/each}
  </select>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if filtered.length === 0}
  <p class="muted">
    {exercises.length === 0
      ? 'No exercises yet — create one, or load sample data from Settings.'
      : 'Nothing matches your search.'}
  </p>
{:else}
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>Exercise</th>
          <th>Body parts</th>
          <th>Measurement</th>
          <th class="actions-head"></th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as exercise (exercise.id)}
          <tr
            class="clickable"
            aria-expanded={expandedId === exercise.id}
            tabindex="0"
            onclick={() => (expandedId = expandedId === exercise.id ? null : exercise.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter') expandedId = expandedId === exercise.id ? null : exercise.id;
            }}
          >
            <td><strong>{exercise.name}</strong></td>
            <td>
              <div class="chips">
                {#each exercise.body_parts as part}
                  <span class="chip selected">{part.replace('_', ' ')}</span>
                {/each}
              </div>
            </td>
            <td class="muted">{MEASUREMENT_LABELS[exercise.measurement_type]}</td>
            <td class="actions-cell">
              <button
                class="btn"
                onclick={(e) => {
                  e.stopPropagation();
                  openEdit(exercise);
                }}>Edit</button
              >
              <button
                class="btn btn-danger"
                onclick={(e) => {
                  e.stopPropagation();
                  remove(exercise);
                }}>Delete</button
              >
            </td>
          </tr>
          {#if expandedId === exercise.id}
            <tr class="detail-row">
              <td colspan="4">
                {#if exercise.description}
                  <p style="margin-bottom: var(--space-2);">{exercise.description}</p>
                {:else}
                  <p class="muted" style="margin-bottom: var(--space-2);">No description.</p>
                {/if}
                {#if exercise.video_url}
                  <p style="margin-bottom: var(--space-2);">
                    <a href={exercise.video_url} target="_blank" rel="noopener">Watch how-to video ↗</a>
                  </p>
                {/if}
                {#if exercise.image_urls.length > 0}
                  <div class="images">
                    {#each exercise.image_urls as url}
                      <img src={url} alt={`${exercise.name} example`} loading="lazy" />
                    {/each}
                  </div>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .filters {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    display: block;
    margin-bottom: var(--space-1);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .chip {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    background: var(--surface-color);
    padding: 0 var(--space-3);
    font-size: var(--font-size-sm);
    line-height: 1.8;
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

  .images {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-2);
  }

  .images img {
    max-height: 8rem;
    border-radius: var(--radius-md);
  }

  .actions-cell {
    text-align: right;
    white-space: nowrap;
  }

  .actions-cell button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  @media (max-width: 30rem) {
    .filters {
      grid-template-columns: 1fr;
    }
  }
</style>
