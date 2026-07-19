<script lang="ts">
  import { onMount } from 'svelte';
  import { all, byIndex, get, put } from '../../lib/db/repo';
  import { getProfile } from '../../lib/db/profile';
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
  import { formatDuration, formatWeight, formatDistance } from '../../lib/utils/units';
  import { topBodyParts } from '../../lib/utils/bodyparts';
  import { formatDate, todayLocal, daysBetween, addDays, dayOfWeek, toLocalDate, parseLocalDate, WEEKDAYS_SHORT } from '../../lib/utils/dates';
  import { href } from '../../lib/paths';
  import type {
    Exercise,
    Pet,
    Program,
    UserProfile,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
    WorkoutTemplateExercise,
  } from '../../lib/db/types';
  import { petsEnabled } from '../../lib/pets/xp';
  import { stageForXp, nextThreshold, STAGE_LABELS, STAGE_THRESHOLDS } from '../../lib/pets/config';
  import { SPRITES, type PetSpecies } from '../../lib/pets/sprites';
  import Card from '../Card.svelte';
  import PixelSprite from '../PixelSprite.svelte';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let nextWorkout: Workout | undefined = $state();
  let nextBodyParts: string[] = $state([]);
  let program: Program | undefined = $state();
  let progress = $state({ completed: 0, total: 0, skipped: 0, bumped: 0 });
  let templates: WorkoutTemplate[] = $state([]);
  let adhocTemplateId = $state('');
  let prs: RecentPR[] = $state([]);
  let scheduleWorkouts: Workout[] = $state([]);
  let draggingWorkout: Workout | null = $state(null);
  let dragOverDay: string | null = $state(null);
  /** First-of-month (YYYY-MM-01) of the month shown in the schedule. */
  let viewMonth = $state('');
  /** Pending "move to past date" prompt. */
  let pastMove: { workout: Workout; date: string; time: string } | null = $state(null);
  let busy = $state(false);
  let greeting = $state('Home');

  // Inline reschedule on the next-workout card.
  let rescheduling = $state(false);
  let rescheduleDate = $state('');

  // "Read more" detail modal for the next workout.
  interface DetailExercise {
    name: string;
    setCount: number;
    target: string;
    superset: number | null;
  }
  interface WorkoutDetail {
    name: string;
    description: string;
    exercises: DetailExercise[];
    lastTime: { date: string; exercises: { name: string; sets: string[] }[] } | null;
  }
  let readMore: WorkoutDetail | null = $state(null);

  /** One-shot workout summary handed over by the active-workout page. */
  interface WorkoutSummary {
    name: string;
    setsDone: number;
    totalSets: number;
    durationSec: number | null;
    exercises?: { name: string; sets: string[] }[];
    prs: { exercise: string; label: string; value: number; secondary: number | null }[];
    /** Achievements unlocked by this workout. Absent on older payloads. */
    achievements?: { title: string; description: string; scopeName: string | null }[];
    /** Pet-game gains from this workout (pets.md). Absent when opted out. */
    pet?: {
      name: string;
      species: string;
      xp: number;
      gained: number;
      stage: string;
      evolved: boolean;
      eggEarned: boolean;
    } | null;
  }
  let summary: WorkoutSummary | null = $state(null);

  const GREETINGS: ((name: string | null) => string)[] = [
    (n) => (n ? `Welcome back, ${n}!` : 'Welcome back!'),
    (n) => (n ? `Ready to lift, ${n}?` : 'Ready to lift?'),
    (n) => (n ? `Let's get moving, ${n}` : "Let's get moving"),
    (n) => (n ? `Good to see you, ${n}` : 'Good to see you'),
    (n) => (n ? `Time to train, ${n}` : 'Time to train'),
    (n) => (n ? `Locked in ${n}?` : 'Locked in'),
    (n) => (n ? `Become speed ${n}` : 'Time to become speed'),
    (n) => (n ? `It's skeedadle o'clock ${n}` : `It's skeedadle o'clock`),
    (n) => (n ? `It's elbow greese o'clock ${n}` : `It's elbow greese o'clock`),
    (n) => (n ? `Athletics, Performance, ${n}` : `Athletics, Performance, Unnamed Athlete`),
    (_) => (`Live, laugh, laundry`),
    (_) => (`1 push up today is worth 1 push up tomorrow`),
    (_) => (`If you never try, you'll never know, yaknow`),
    (_) => (`Treadmills are more afraid of you than you are of them`),
    (_) => (`Train hard, sleep hard, wake up hard 😤`),
    (_) => (`Building the best ass in the west`),
    (n) => (n ? `Ready to defy gravity ${n}?` : 'Ready to defy gravity'),
    (n) => (n ? `Time to take your feelings, and put them in your muscles ${n}` : 'Take your feelings, put them in your muscles'),
  ];

  const today = todayLocal();

  function firstOfMonth(dateStr: string): string {
    return dateStr.slice(0, 8) + '01';
  }
  function addMonths(firstOfMonthStr: string, delta: number): string {
    const [y, m] = firstOfMonthStr.split('-').map(Number);
    const total = y * 12 + (m - 1) + delta;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return `${ny}-${String(nm).padStart(2, '0')}-01`;
  }

  /** The 6-week grid (Sun-anchored) covering the displayed month. */
  const monthGrid = $derived.by(() => {
    if (!viewMonth) return [] as string[];
    const gridStart = addDays(viewMonth, -dayOfWeek(viewMonth));
    const lastDay = addDays(addMonths(viewMonth, 1), -1);
    const gridEnd = addDays(lastDay, 6 - dayOfWeek(lastDay));
    const days: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
    return days;
  });
  const monthLabel = $derived(
    viewMonth
      ? parseLocalDate(viewMonth).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : ''
  );
  const inViewMonth = (date: string) => date.slice(0, 7) === viewMonth.slice(0, 7);

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const du = $derived(profile?.display_distance_unit ?? 'km');

  onMount(async () => {
    profile = (await getProfile());
    if (!profile?.onboarding_completed_at) {
      location.href = href('/onboarding/');
      return;
    }
    greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)](profile.name ?? null);
    viewMonth = firstOfMonth(today);

    const raw = sessionStorage.getItem('workoutt-workout-summary');
    if (raw) {
      sessionStorage.removeItem('workoutt-workout-summary'); // shown once
      try {
        summary = JSON.parse(raw) as WorkoutSummary;
      } catch {
        summary = null;
      }
    }
    // Reschedule anything that was missed before showing the week.
    await applyBumps();
    await refresh();
    loading = false;
  });

  // Pet companion widget (pets.md §7): active pet, when the game is on.
  let activePet: Pet | null = $state(null);

  async function refresh() {
    activePet = null;
    if (petsEnabled(profile) && profile?.active_pet_id) {
      activePet = (await get<Pet>('pets', profile.active_pet_id)) ?? null;
    }
    nextWorkout = await getNextWorkout();
    program = await getActiveProgram();
    if (program) progress = await programProgress(program);
    templates = (await all<WorkoutTemplate>('workout_templates')).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    prs = await recentPRs(5);

    // All schedulable workouts; the calendar filters by day as it renders.
    scheduleWorkouts = (await all<Workout>('workouts')).filter((w) => displayDate(w) != null);

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
    location.href = href(`/workout/?id=${nextWorkout.id}`);
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
    location.href = href(`/workout/?id=${workout.id}`);
  }

  function beginReschedule() {
    if (!nextWorkout) return;
    rescheduleDate = nextWorkout.scheduled_on ?? today;
    rescheduling = true;
  }

  /** Reschedule the next workout via the date picker (counts as a bump). */
  async function confirmReschedule() {
    if (!nextWorkout || !rescheduleDate || busy) return;
    busy = true;
    const w = $state.snapshot(nextWorkout) as Workout;
    if (rescheduleDate !== w.scheduled_on) {
      await put('workouts', {
        ...w,
        scheduled_on: rescheduleDate,
        original_scheduled_on: w.original_scheduled_on ?? w.scheduled_on,
      });
    }
    rescheduling = false;
    busy = false;
    await refresh();
  }

  const wu2 = () => profile?.display_weight_unit ?? 'kg';
  const du2 = () => profile?.display_distance_unit ?? 'km';

  function describeTarget(te: WorkoutTemplateExercise): string {
    const parts: string[] = [];
    if (te.target_reps != null) parts.push(`${te.target_reps} reps`);
    if (te.target_weight_kg != null) parts.push(formatWeight(te.target_weight_kg, wu2()));
    if (te.target_time_seconds != null) parts.push(formatDuration(te.target_time_seconds));
    if (te.target_distance_km != null) parts.push(formatDistance(te.target_distance_km, du2()));
    return parts.join(' · ');
  }

  function describeSet(s: WorkoutSet): string {
    const parts: string[] = [];
    if (s.weight_kg != null) parts.push(formatWeight(s.weight_kg, wu2()));
    if (s.reps != null) parts.push(`× ${s.reps}`);
    if (s.time_seconds != null) parts.push(formatDuration(s.time_seconds));
    if (s.distance_km != null) parts.push(formatDistance(s.distance_km, du2()));
    return parts.join(' ') || '—';
  }

  async function openReadMore() {
    if (!nextWorkout) return;
    const w = nextWorkout;
    const exList = await all<Exercise>('exercises');
    const exById = new Map(exList.map((e) => [e.id, e]));

    let description = '';
    let detailExercises: DetailExercise[] = [];
    if (w.workout_template_id) {
      const tpl = await get<WorkoutTemplate>('workout_templates', w.workout_template_id);
      description = tpl?.description ?? '';
      const tes = (
        await byIndex<WorkoutTemplateExercise>(
          'workout_template_exercises',
          'workout_template_id',
          w.workout_template_id
        )
      ).sort((a, b) => a.position - b.position);
      detailExercises = tes.map((te) => ({
        name: exById.get(te.exercise_id)?.name ?? 'Unknown exercise',
        setCount: te.set_count,
        target: describeTarget(te),
        superset: te.superset_group,
      }));
    }

    let lastTime: WorkoutDetail['lastTime'] = null;
    if (w.workout_template_id) {
      const last = (await all<Workout>('workouts'))
        .filter(
          (x) =>
            x.workout_template_id === w.workout_template_id &&
            x.id !== w.id &&
            x.state === 'completed' &&
            x.completed_at
        )
        .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
      if (last) {
        const wes = (await byIndex<WorkoutExercise>('workout_exercises', 'workout_id', last.id)).sort(
          (a, b) => a.position - b.position
        );
        const exs: { name: string; sets: string[] }[] = [];
        for (const we of wes) {
          const sets = (await byIndex<WorkoutSet>('workout_sets', 'workout_exercise_id', we.id))
            .filter((s) => s.completed)
            .sort((a, b) => a.position - b.position);
          exs.push({ name: exById.get(we.exercise_id)?.name ?? 'Unknown exercise', sets: sets.map(describeSet) });
        }
        lastTime = { date: toLocalDate(new Date(last.completed_at!)), exercises: exs };
      }
    }

    readMore = { name: w.name, description, exercises: detailExercises, lastTime };
  }

  function scheduleLabel(w: Workout): string {
    if (!w.scheduled_on) return 'Unscheduled';
    const days = daysBetween(today, w.scheduled_on);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return `${formatDate(w.scheduled_on)} — overdue`;
    return formatDate(w.scheduled_on);
  }

  /**
   * The calendar day a workout belongs on: the day it was actually completed
   * (so ad-hoc workouts and ones done early/late land on the right day),
   * otherwise its scheduled day.
   */
  function displayDate(w: Workout): string | null {
    if (w.state === 'completed' && w.completed_at) return toLocalDate(new Date(w.completed_at));
    return w.scheduled_on;
  }

  function workoutsOn(date: string): Workout[] {
    return scheduleWorkouts
      .filter((w) => displayDate(w) === date)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Scheduled workouts can be dragged to any day (past days prompt a modal). */
  const canDrag = (w: Workout) => w.state === 'scheduled';

  /**
   * Drop a dragged workout on a day. Future/today → straight reschedule
   * (bump). Past day → open the "Moving workout to Past Date" prompt.
   */
  async function dropOnDay(date: string) {
    const w = draggingWorkout;
    draggingWorkout = null;
    dragOverDay = null;
    if (!w || w.scheduled_on === date) return;
    if (date < today) {
      const now = new Date();
      pastMove = {
        workout: $state.snapshot(w) as Workout,
        date,
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      };
      return;
    }
    await put('workouts', {
      ...($state.snapshot(w) as Workout),
      scheduled_on: date,
      original_scheduled_on: w.original_scheduled_on ?? w.scheduled_on,
    });
    await refresh();
  }

  function pastCompletedIso(pm: { date: string; time: string }): string {
    const [y, mo, d] = pm.date.split('-').map(Number);
    const [h, mi] = pm.time.split(':').map(Number);
    return new Date(y, mo - 1, d, h || 0, mi || 0).toISOString();
  }

  /** Enter stats: anchor to the past date, start it, go to the workout page. */
  async function pastEnterStats() {
    if (!pastMove) return;
    const pm = pastMove;
    pastMove = null;
    busy = true;
    const anchored = {
      ...pm.workout,
      scheduled_on: pm.date,
      original_scheduled_on: pm.workout.original_scheduled_on ?? pm.workout.scheduled_on,
    };
    await put('workouts', anchored);
    await startWorkout(anchored as Workout);
    const iso = pastCompletedIso(pm);
    location.href = href(`/workout/?id=${pm.workout.id}&completeOn=${encodeURIComponent(iso)}`);
  }

  /** Submit without stats: mark completed on the past date, no sets logged. */
  async function pastSubmitNoStats() {
    if (!pastMove) return;
    const pm = pastMove;
    pastMove = null;
    busy = true;
    const iso = pastCompletedIso(pm);
    await put('workouts', {
      ...pm.workout,
      scheduled_on: pm.date,
      original_scheduled_on: pm.workout.original_scheduled_on ?? pm.workout.scheduled_on,
      state: 'completed',
      started_at: iso,
      completed_at: iso,
    });
    busy = false;
    await refresh();
  }

  // Dragging uses pointer events instead of HTML5 drag-and-drop: Edge
  // intercepts native drags (Super Drag & Drop etc.) and shows 🚫 even with
  // drag data set, and pointer events also work on touch screens.
  function chipPointerDown(e: PointerEvent, w: Workout) {
    if (!canDrag(w)) return;
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
    dragOverDay = el?.dataset.date ?? null;
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
  {#if summary}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="summary-title">
      <div class="modal">
        <h3 id="summary-title">Workout complete 🎉</h3>
        <p class="summary-line">
          <strong>{summary.name}</strong> — {summary.setsDone}/{summary.totalSets} sets done{#if summary.durationSec != null}&nbsp;in {formatDuration(summary.durationSec)}{/if}
        </p>

        {#if summary.prs.length > 0}
          <div>
            <p class="pr-heading">New personal records</p>
            <ul class="new-prs">
              {#each summary.prs as pr}
                <li>
                  <strong>{pr.exercise}</strong>
                  <span class="muted">{pr.label}</span>
                  <span class="pr-value">
                    {formatRecordValue(pr.label, { value: pr.value, secondary: pr.secondary, date: today }, wu, du)}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if summary.achievements && summary.achievements.length > 0}
          <div>
            <p class="pr-heading">Achievements unlocked 🏅</p>
            <ul class="new-prs">
              {#each summary.achievements as ach}
                <li>
                  <strong>{ach.title}</strong>
                  <span class="muted">
                    {ach.scopeName ? `${ach.scopeName} — ` : ''}{ach.description}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if summary.pet}
          <div class="summary-pet">
            {#if SPRITES[summary.pet.species as PetSpecies]}
              {@const set = SPRITES[summary.pet.species as PetSpecies]}
              <PixelSprite
                grid={set.stages[stageForXp(summary.pet.xp)]}
                palette={set.palette}
                size={56}
                title={summary.pet.name}
                animation="happy"
              />
            {/if}
            <div class="summary-pet-text">
              <strong>{summary.pet.name} gained {summary.pet.gained} XP</strong>
              {#if summary.pet.evolved}
                <span class="pet-evolved">Evolved into a {summary.pet.stage} {summary.pet.species}! 🎉</span>
              {/if}
              {#if summary.pet.eggEarned}
                <span class="muted">You earned a new egg 🥚 — hatch it on the <a href={href('/pets/')}>Pets page</a>.</span>
              {/if}
            </div>
          </div>
        {/if}

        {#if summary.exercises && summary.exercises.length > 0}
          <div class="summary-exercises">
            {#each summary.exercises as ex}
              <div class="summary-ex">
                <strong>{ex.name}</strong>
                {#if ex.sets.length > 0}
                  <span class="muted">{ex.sets.join(' · ')}</span>
                {:else}
                  <span class="muted">no sets completed</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <div class="modal-actions">
          {#if summary.achievements && summary.achievements.length > 0}
            <a class="btn" href={href('/achievements/')}>View achievements</a>
          {/if}
          <button class="btn" onclick={() => (summary = null)}>Dismiss</button>
        </div>
      </div>
    </div>
  {/if}

  {#if readMore}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="readmore-title">
      <div class="modal">
        <h3 id="readmore-title">{readMore.name}</h3>
        {#if readMore.description}
          <p class="muted">{readMore.description}</p>
        {/if}

        {#if readMore.exercises.length > 0}
          <div>
            <p class="rm-heading">Planned</p>
            <ul class="rm-list">
              {#each readMore.exercises as ex}
                <li>
                  <strong>{ex.name}</strong>
                  <span class="muted">
                    {ex.setCount} × {ex.target || 'sets'}{#if ex.superset != null} · SS{ex.superset}{/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div>
          <p class="rm-heading">Last time</p>
          {#if readMore.lastTime}
            <p class="muted" style="margin-bottom: var(--space-2);">{formatDate(readMore.lastTime.date)}</p>
            <ul class="rm-list">
              {#each readMore.lastTime.exercises as ex}
                <li>
                  <strong>{ex.name}</strong>
                  {#if ex.sets.length > 0}
                    <span class="muted">{ex.sets.join(' · ')}</span>
                  {:else}
                    <span class="muted">no sets completed</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">You haven't done this workout before.</p>
          {/if}
        </div>

        <div class="modal-actions">
          <button class="btn" onclick={() => (readMore = null)}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <div class="stack">
    {#if activePet}
      {@const set = SPRITES[activePet.species as PetSpecies]}
      {@const next = nextThreshold(activePet.xp)}
      {@const prev = [...STAGE_THRESHOLDS].reverse().find((t) => t.xp <= activePet.xp)}
      <a class="pet-strip" href={href('/pets/')}>
        {#if set}
          <PixelSprite
            grid={set.stages[stageForXp(activePet.xp)]}
            palette={set.palette}
            size={48}
            title={`${activePet.name} the ${activePet.species}`}
            animation="idle"
          />
        {/if}
        <div class="pet-strip-info">
          <strong>{activePet.name}</strong>
          <span class="muted">
            {STAGE_LABELS[stageForXp(activePet.xp)]} {activePet.species}
            {#if next}
              · {activePet.xp} / {next.xp} XP
            {:else}
              · fully evolved 💪
            {/if}
          </span>
          <div class="pet-strip-bar">
            <div
              class="pet-strip-fill"
              style={`width: ${next && prev ? Math.min(100, ((activePet.xp - prev.xp) / (next.xp - prev.xp)) * 100) : 100}%`}
            ></div>
          </div>
        </div>
      </a>
    {/if}
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
              <button class="btn" onclick={beginReschedule} disabled={busy}>Reschedule</button>
              <button class="btn" onclick={skipNext} disabled={busy}>Skip</button>
            {/if}
            <button class="btn" onclick={openReadMore}>Read more</button>
          </div>
          {#if rescheduling}
            <div class="reschedule-row">
              <input type="date" bind:value={rescheduleDate} aria-label="New date" />
              <button class="btn btn-primary" onclick={confirmReschedule} disabled={!rescheduleDate || busy}>
                Move
              </button>
              <button class="btn" onclick={() => (rescheduling = false)} disabled={busy}>Cancel</button>
            </div>
          {/if}
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
              <a href={href('/workouts/')}>Create a workout template</a> to get going.
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
          <a class="btn" href={href('/programs/')} style="margin-top: var(--space-3);">Set up a program</a>
        {/if}
      </Card>
    </div>

    <Card title="Workout schedule">
      <div class="cal-head">
        <button class="btn" onclick={() => (viewMonth = addMonths(viewMonth, -1))} aria-label="Previous month">←</button>
        <div class="cal-month">
          <strong>{monthLabel}</strong>
          {#if viewMonth !== firstOfMonth(today)}
            <button class="cal-today" onclick={() => (viewMonth = firstOfMonth(today))}>Today</button>
          {/if}
        </div>
        <button class="btn" onclick={() => (viewMonth = addMonths(viewMonth, 1))} aria-label="Next month">→</button>
      </div>
      <p class="muted week-hint">Drag a workout to another day to move it. Dropping on a past day lets you log it as done.</p>
      <div class="cal-weekdays">
        {#each WEEKDAYS_SHORT as wd}
          <span>{wd}</span>
        {/each}
      </div>
      <div class="month">
        {#each monthGrid as date (date)}
          {@const past = date < today}
          <div
            class="day"
            class:past
            class:is-today={date === today}
            class:other-month={!inViewMonth(date)}
            class:drop-target={draggingWorkout != null && dragOverDay === date}
            role="listitem"
            data-date={date}
            aria-label={`${date}${past ? ' (past)' : ''}`}
          >
            <span class="day-num">{Number(date.slice(8))}</span>
            {#each workoutsOn(date) as w (w.id)}
              <div
                class="week-chip"
                class:done={w.state === 'completed'}
                class:draggable-chip={canDrag(w)}
                class:dragging={draggingWorkout?.id === w.id}
                role="listitem"
                title={canDrag(w) ? 'Drag to move' : w.state}
                onpointerdown={(e) => chipPointerDown(e, w)}
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

    {#if pastMove}
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pastmove-title">
        <div class="modal">
          <h3 id="pastmove-title">Moving workout to Past Date</h3>
          <p class="muted">
            You're moving <strong>{pastMove.workout.name}</strong> to
            {formatDate(pastMove.date)}, which is in the past. Log it as completed?
          </p>
          <div>
            <label for="past-time">What time did you finish?</label>
            <input id="past-time" type="time" bind:value={pastMove.time} />
          </div>
          <div class="modal-actions">
            <button class="btn" onclick={() => (pastMove = null)} disabled={busy}>Cancel</button>
            <button class="btn" onclick={pastSubmitNoStats} disabled={busy}>Submit without stats</button>
            <button class="btn btn-primary" onclick={pastEnterStats} disabled={busy}>Enter stats</button>
          </div>
        </div>
      </div>
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
        <a class="btn" href={href('/records/')} style="margin-top: var(--space-3);">All records</a>
      </Card>
    {/if}
  </div>
{/if}

<style>
  .pet-strip {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
    text-decoration: none;
    color: var(--text-color);
  }

  .pet-strip:hover {
    border-color: var(--color-primary);
  }

  .pet-strip-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .pet-strip-info .muted {
    font-size: var(--font-size-sm);
  }

  .pet-strip-bar {
    height: 0.35rem;
    border-radius: var(--radius-full);
    background: var(--border-color);
    overflow: hidden;
  }

  .pet-strip-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
  }

  .summary-pet {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: var(--color-primary-soft);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }

  .summary-pet-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pet-evolved {
    font-weight: 700;
    color: var(--color-primary-strong);
  }

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
    flex-wrap: wrap;
  }

  .reschedule-row {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }

  .reschedule-row input {
    width: auto;
    flex: 1 1 9rem;
  }

  .rm-heading {
    font-weight: 700;
    color: var(--color-primary-strong);
    margin-bottom: var(--space-1);
  }

  .rm-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rm-list li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
  }

  .week-hint {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-2);
  }

  .cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .cal-month {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-lg);
  }

  .cal-today {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    color: var(--color-primary-strong);
    font-size: var(--font-size-sm);
    font-weight: 600;
    padding: 0 var(--space-2);
    cursor: pointer;
  }

  .cal-weekdays {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-1);
    margin-bottom: var(--space-1);
  }

  .cal-weekdays span {
    text-align: center;
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-muted-color);
  }

  .month {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-1);
  }

  .day {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-1);
    min-height: 4.5rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .day.other-month {
    opacity: 0.45;
  }

  .day-num {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    font-weight: 700;
    padding: 0 var(--space-1);
  }

  .is-today .day-num {
    color: var(--color-primary-strong);
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

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.5);
    display: grid;
    place-items: center;
    z-index: 50;
    padding: var(--space-4);
  }

  .modal {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    padding: var(--space-5);
    max-width: 34rem;
    width: 100%;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .summary-line {
    font-size: var(--font-size-lg);
  }

  .summary-exercises {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--border-color);
    padding-top: var(--space-3);
  }

  .summary-ex {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
  }

  .pr-heading {
    font-weight: 700;
    color: var(--color-primary-strong);
    margin-bottom: var(--space-1);
  }

  .new-prs {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .new-prs li {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    flex-wrap: wrap;
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
    .day {
      min-height: 3.5rem;
      font-size: var(--font-size-sm);
    }

    .week-chip {
      font-size: 0.7rem;
      padding: 2px;
    }
  }
</style>
