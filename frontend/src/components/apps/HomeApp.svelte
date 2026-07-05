<script lang="ts">
  import { onMount } from 'svelte';
  import { all } from '../../lib/db/repo';
  import {
    getNextWorkout,
    getActiveProgram,
    programProgress,
    startWorkout,
    startAdhocWorkout,
  } from '../../lib/services/workouts';
  import { formatDate, todayLocal, daysBetween } from '../../lib/utils/dates';
  import type { Program, UserProfile, Workout, WorkoutTemplate } from '../../lib/db/types';
  import Card from '../Card.svelte';

  let loading = $state(true);
  let nextWorkout: Workout | undefined = $state();
  let program: Program | undefined = $state();
  let progress = $state({ completed: 0, total: 0 });
  let templates: WorkoutTemplate[] = $state([]);
  let adhocTemplateId = $state('');
  let busy = $state(false);

  onMount(async () => {
    const profile = (await all<UserProfile>('user_profile'))[0];
    if (!profile?.onboarding_completed_at) {
      location.href = '/onboarding/';
      return;
    }
    nextWorkout = await getNextWorkout();
    program = await getActiveProgram();
    if (program) progress = await programProgress(program);
    templates = (await all<WorkoutTemplate>('workout_templates')).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    loading = false;
  });

  async function startNext() {
    if (!nextWorkout || busy) return;
    busy = true;
    if (nextWorkout.state === 'scheduled') await startWorkout($state.snapshot(nextWorkout) as Workout);
    location.href = `/workout/?id=${nextWorkout.id}`;
  }

  async function startAdhoc() {
    const template = templates.find((t) => t.id === adhocTemplateId);
    if (!template || busy) return;
    busy = true;
    const workout = await startAdhocWorkout($state.snapshot(template) as WorkoutTemplate);
    location.href = `/workout/?id=${workout.id}`;
  }

  function scheduleLabel(w: Workout): string {
    if (!w.scheduled_on) return 'Unscheduled';
    const days = daysBetween(todayLocal(), w.scheduled_on);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${formatDate(w.scheduled_on)} — overdue`;
    return formatDate(w.scheduled_on);
  }
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="grid-2">
    <Card title="Next workout">
      {#if nextWorkout}
        <h3>{nextWorkout.name}</h3>
        <p class="muted">
          {#if nextWorkout.state === 'in_progress'}
            In progress — pick up where you left off.
          {:else}
            {scheduleLabel(nextWorkout)}
          {/if}
          {#if nextWorkout.original_scheduled_on}
            <span class="badge">bumped</span>
          {/if}
        </p>
        <button class="btn btn-primary" style="margin-top: var(--space-3);" onclick={startNext} disabled={busy}>
          {nextWorkout.state === 'in_progress' ? 'Resume workout' : 'Start workout'}
        </button>
      {:else}
        <p class="muted">No workout scheduled.</p>
        {#if templates.length > 0}
          <div style="margin-top: var(--space-3);">
            <label for="home-adhoc">Start one anyway</label>
            <div class="adhoc">
              <select id="home-adhoc" bind:value={adhocTemplateId}>
                <option value="" disabled>Choose a template…</option>
                {#each templates as t}
                  <option value={t.id}>{t.name}</option>
                {/each}
              </select>
              <button class="btn btn-primary" onclick={startAdhoc} disabled={!adhocTemplateId || busy}>
                Start
              </button>
            </div>
          </div>
        {:else}
          <p class="muted" style="margin-top: var(--space-2);">
            <a href="/workouts/">Create a workout template</a> to get going.
          </p>
        {/if}
      {/if}
    </Card>

    <Card title="Current program">
      {#if program}
        <h3>{program.name}</h3>
        <p class="muted">
          {progress.completed} of {progress.total} workouts done · ends {formatDate(program.ends_on)}
        </p>
        <div class="progress" role="progressbar" aria-valuenow={progress.completed} aria-valuemax={progress.total}>
          <div
            class="progress-fill"
            style={`width: ${progress.total ? (100 * progress.completed) / progress.total : 0}%`}
          ></div>
        </div>
      {:else}
        <p class="muted">No active program.</p>
        <a class="btn" href="/programs/" style="margin-top: var(--space-3);">Set up a program</a>
      {/if}
    </Card>
  </div>
{/if}

<style>
  .badge {
    display: inline-block;
    background: var(--color-warning);
    color: var(--bg-color);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 700;
    margin-left: var(--space-1);
  }

  .progress {
    margin-top: var(--space-3);
    height: 0.6rem;
    border-radius: var(--radius-full);
    background: var(--color-primary-soft);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--color-primary);
    border-radius: var(--radius-full);
  }

  .adhoc {
    display: flex;
    gap: var(--space-2);
  }
</style>
