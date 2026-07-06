<script lang="ts">
  import { onMount } from 'svelte';
  import { all, byIndex, put } from '../../lib/db/repo';
  import {
    getNextWorkout,
    getActiveProgram,
    programProgress,
    startWorkout,
    startAdhocWorkout,
    applyBumps,
    skipWorkout,
  } from '../../lib/services/workouts';
  import { recentPRs, type RecentPR } from '../../lib/services/records';
  import { formatRecordValue } from '../../lib/utils/records-format';
  import { topBodyParts } from '../../lib/utils/bodyparts';
  import { formatDate, todayLocal, daysBetween, addDays, dayOfWeek, WEEKDAYS_SHORT } from '../../lib/utils/dates';
  import type {
    Exercise,
    Program,
    UserProfile,
    Workout,
    WorkoutTemplate,
    WorkoutTemplateExercise,
  } from '../../lib/db/types';
  import Card from '../Card.svelte';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let nextWorkout: Workout | undefined = $state();
  let nextBodyParts: string[] = $state([]);
  let program: Program | undefined = $state();
  let progress = $state({ completed: 0, total: 0, skipped: 0, bumped: 0 });
  let templates: WorkoutTemplate[] = $state([]);
  let adhocTemplateId = $state('');
  let prs: RecentPR[] = $state([]);
  let weekWorkouts: Workout[] = $state([]);
  let draggingWorkout: Workout | null = $state(null);
  let dragOverDay: string | null = $state(null);
  let busy = $state(false);
  let greeting = $state('Home');

  const GREETINGS: ((name: string | null) => string)[] = [
    (n) => (n ? `Welcome back, ${n}!` : 'Welcome back!'),
    (n) => (n ? `Ready to lift, ${n}?` : 'Ready to lift?'),
    (n) => (n ? `Let's get moving, ${n}` : "Let's get moving"),
    (n) => (n ? `Good to see you, ${n}` : 'Good to see you'),
    (n) => (n ? `Time to train, ${n}` : 'Time to train'),
  ];

  const today = todayLocal();
  const weekStart = addDays(today, -dayOfWeek(today));
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const du = $derived(profile?.display_distance_unit ?? 'km');

  onMount(async () => {
    profile = (await all<UserProfile>('user_profile'))[0];
    if (!profile?.onboarding_completed_at) {
      location.href = '/onboarding/';
      return;
    }
    greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)](profile.name ?? null);
    // Reschedule anything that was missed before showing the week.
    await applyBumps();
    await refresh();
    loading = false;
  });

  async function refresh() {
    nextWorkout = await getNextWorkout();
    program = await getActiveProgram();
    if (program) progress = await programProgress(program);
    templates = (await all<WorkoutTemplate>('workout_templates')).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    prs = await recentPRs(5);

    const allWorkouts = await all<Workout>('workouts');
    weekWorkouts = allWorkouts.filter(
      (w) => w.scheduled_on && w.scheduled_on >= weekDates[0] && w.scheduled_on <= weekDates[6]
    );

    nextBodyParts = [];
    if (nextWorkout?.workout_template_id) {
      const [tes, exercises] = await Promise.all([
        byIndex<WorkoutTemplateExercise>(
          'workout_template_exercises',
          'workout_template_id',
          nextWorkout.workout_template_id
        ),
        all<Exercise>('exercises'),
      ]);
      const exById = new Map(exercises.map((e) => [e.id, e]));
      nextBodyParts = topBodyParts(
        tes.map((te) => ({ exercise: exById.get(te.exercise_id), weight: te.set_count }))
      );
    }
  }

  async function startNext() {
    if (!nextWorkout || busy) return;
    busy = true;
    if (nextWorkout.state === 'scheduled') await startWorkout($state.snapshot(nextWorkout) as Workout);
    location.href = `/workout/?id=${nextWorkout.id}`;
  }

  async function skipNext() {
    if (!nextWorkout || busy) return;
    if (!confirm(`Skip ${nextWorkout.name}? It won't be rescheduled. To reschedule drag workout to new date on the homepage.`)) return;
    busy = true;
    await skipWorkout($state.snapshot(nextWorkout) as Workout);
    busy = false;
    await refresh();
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
    const days = daysBetween(today, w.scheduled_on);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${formatDate(w.scheduled_on)} — overdue`;
    return formatDate(w.scheduled_on);
  }

  function workoutsOn(date: string): Workout[] {
    return weekWorkouts
      .filter((w) => w.scheduled_on === date)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const canDrag = (w: Workout, date: string) => w.state === 'scheduled' && date >= today;

  /** Reschedule via drag: counts as a bump (original date is preserved). */
  async function dropOnDay(date: string) {
    const w = draggingWorkout;
    draggingWorkout = null;
    dragOverDay = null;
    if (!w || date < today || w.scheduled_on === date) return;
    await put('workouts', {
      ...($state.snapshot(w) as Workout),
      scheduled_on: date,
      original_scheduled_on: w.original_scheduled_on ?? w.scheduled_on,
    });
    await refresh();
  }

  // Dragging uses pointer events instead of HTML5 drag-and-drop: Edge
  // intercepts native drags (Super Drag & Drop etc.) and shows 🚫 even with
  // drag data set, and pointer events also work on touch screens.
  function chipPointerDown(e: PointerEvent, w: Workout, date: string) {
    if (!canDrag(w, date)) return;
    draggingWorkout = w;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released/invalid — dragging still works via bubbling.
    }
  }

  function chipPointerMove(e: PointerEvent) {
    if (!draggingWorkout) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-date]') as HTMLElement | null;
    const date = el?.dataset.date ?? null;
    dragOverDay = date && date >= today ? date : null;
  }

  function chipPointerUp() {
    if (draggingWorkout && dragOverDay) {
      dropOnDay(dragOverDay);
    } else {
      draggingWorkout = null;
      dragOverDay = null;
    }
  }

  function chipPointerCancel() {
    draggingWorkout = null;
    dragOverDay = null;
  }
</script>

<div class="page-header">
  <h1>{greeting}</h1>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <div class="grid-2">
      <Card title="Next workout">
        {#if nextWorkout}
          <p class="next-name">{nextWorkout.name}</p>
          {#if nextBodyParts.length > 0}
            <div class="bp-chips">
              {#each nextBodyParts as part}
                <span class="bp-chip">{part.replace('_', ' ')}</span>
              {/each}
            </div>
          {/if}
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
          <div class="next-actions">
            <button class="btn btn-primary" onclick={startNext} disabled={busy}>
              {nextWorkout.state === 'in_progress' ? 'Resume workout' : 'Start workout'}
            </button>
            {#if nextWorkout.state === 'scheduled'}
              <button class="btn" onclick={skipNext} disabled={busy}>Skip</button>
            {/if}
          </div>
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
            {progress.completed} of {progress.total} workouts done
            {#if progress.skipped > 0}&nbsp;· {progress.skipped} skipped{/if}
            {#if progress.bumped > 0}&nbsp;· {progress.bumped} bumped{/if}
            &nbsp;· ends {formatDate(program.ends_on)}
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

    {#if weekWorkouts.length > 0}
      <Card title="This week">
        <p class="muted week-hint">Drag a workout to another day to reschedule it.</p>
        <div class="week">
          {#each weekDates as date (date)}
            {@const past = date < today}
            <div
              class="day"
              class:past
              class:is-today={date === today}
              class:drop-target={draggingWorkout != null && dragOverDay === date}
              role="listitem"
              data-date={date}
              aria-label={`${WEEKDAYS_SHORT[dayOfWeek(date)]} ${date}${past ? ' (past)' : ''}`}
            >
              <span class="day-label">
                {WEEKDAYS_SHORT[dayOfWeek(date)]}
                <span class="day-num">{Number(date.slice(8))}</span>
              </span>
              {#each workoutsOn(date) as w (w.id)}
                <div
                  class="week-chip"
                  class:done={w.state === 'completed'}
                  class:draggable-chip={canDrag(w, date)}
                  class:dragging={draggingWorkout?.id === w.id}
                  role="listitem"
                  title={canDrag(w, date) ? 'Drag to reschedule' : w.state}
                  onpointerdown={(e) => chipPointerDown(e, w, date)}
                  onpointermove={chipPointerMove}
                  onpointerup={chipPointerUp}
                  onpointercancel={chipPointerCancel}
                >
                  {w.name}
                  {#if w.state === 'completed'}✓{/if}
                  {#if w.state === 'in_progress'}⏱{/if}
                  {#if w.state === 'skipped'}—{/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </Card>
    {/if}

    {#if prs.length > 0}
      <Card title="Recent PRs">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Metric</th>
                <th>Value</th>
                <th class="pr-date-col">Date</th>
              </tr>
            </thead>
            <tbody>
              {#each prs as pr}
                <tr>
                  <td class="pr-exercise">{pr.exercise.name}</td>
                  <td class="muted" data-label="Metric">{pr.label}</td>
                  <td class="pr-value" data-label="Value">{formatRecordValue(pr.label, pr.entry, wu, du)}</td>
                  <td class="muted pr-date-col" data-label="Date">{formatDate(pr.entry.date)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <a class="btn" href="/records/" style="margin-top: var(--space-3);">All records</a>
      </Card>
    {/if}
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

  .next-name {
    font-size: var(--font-size-base);
    font-style: italic;
    font-weight: 600;
    color: color-mix(in srgb, var(--text-color) 65%, var(--text-muted-color));
  }

  .bp-chips {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin: var(--space-3) 0 var(--space-2);
  }

  .bp-chip {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
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

  .next-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .week-hint {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-2);
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-1);
  }

  .day {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-1);
    min-height: 5.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .day.past {
    opacity: 0.55;
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 6px,
      color-mix(in srgb, var(--border-color) 35%, transparent) 6px,
      color-mix(in srgb, var(--border-color) 35%, transparent) 7px
    );
  }

  .day.is-today {
    border-color: var(--color-primary);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }

  .day.drop-target {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
  }

  .day-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    padding: 0 var(--space-1);
  }

  .is-today .day-label {
    color: var(--color-primary-strong);
  }

  .week-chip {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
    font-size: var(--font-size-sm);
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .week-chip.done {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }

  .draggable-chip {
    cursor: grab;
    touch-action: none; /* pointer-drag needs the browser to not scroll instead */
    user-select: none;
  }

  .draggable-chip:active {
    cursor: grabbing;
  }

  .week-chip.dragging {
    opacity: 0.5;
  }

  .pr-exercise {
    font-weight: 700;
  }

  .pr-value {
    font-weight: 800;
    color: var(--color-primary-strong);
    white-space: nowrap;
  }

  .pr-date-col {
    text-align: right;
    white-space: nowrap;
  }

  @media (max-width: 40rem) {
    .week {
      grid-template-columns: repeat(7, minmax(4.5rem, 1fr));
      overflow-x: auto;
    }
  }
</style>
