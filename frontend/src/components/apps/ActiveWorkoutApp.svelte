<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { all, byIndex, get, put, softDelete, softDeleteMany, withSyncFields } from '../../lib/db/repo';
  import {
    getInProgressWorkout,
    getNextWorkout,
    startWorkout,
    startAdhocWorkout,
    finishWorkout,
    abandonWorkout,
    getLatestTemplateNotes,
  } from '../../lib/services/workouts';
  import { formatDate, daysBetween, todayLocal } from '../../lib/utils/dates';
  import { computeRecords } from '../../lib/services/records';
  import { evaluateAchievements } from '../../lib/achievements/evaluate';
  import { kgToDisplay, displayToKg, kmToDisplay, displayToKm, formatWeight, formatDistance, formatDuration } from '../../lib/utils/units';
  import { topBodyParts } from '../../lib/utils/bodyparts';
  import { showLocalNotification, msUntilStale } from '../../lib/notifications';
  import { href } from '../../lib/paths';
  import type {
    Exercise,
    MeasurementType,
    Pet,
    UserProfile,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
    WorkoutTemplateExercise,
  } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import TimeInput from '../TimeInput.svelte';

  interface Item {
    we: WorkoutExercise;
    exercise: Exercise | undefined;
    sets: WorkoutSet[];
  }

  let loading = $state(true);
  let workout: Workout | undefined = $state();
  let items: Item[] = $state([]);
  let profile: UserProfile | undefined = $state();
  let exercises: Exercise[] = $state([]);
  let templates: WorkoutTemplate[] = $state([]);
  let nextScheduled: Workout | undefined = $state();
  let nextPreview: { name: string; sets: number }[] = $state([]);
  let pickerTemplateId = $state('');
  let addExerciseId = $state('');
  let busy = $state(false);
  /** Editing an already-completed workout (from history). */
  let editing = $state(false);
  let showFinishConfirm = $state(false);
  /** When set (from the calendar "past date → enter stats" flow), finishing
   *  records completion at this ISO time instead of now. */
  let completeOn: string | null = $state(null);
  /** Notes for this workout, and notes carried from the last same-template one. */
  let notes = $state('');
  let priorNotes: { notes: string; date: string } | null = $state(null);

  const wu = $derived(profile?.display_weight_unit ?? 'kg');

  // --- Rest timer (simple per-set countdown; default from Settings) ---
  const restDefault = $derived(profile?.rest_timer_default_seconds ?? 90);
  let restRunning = $state(false);
  let restRemaining = $state(0);
  /** Whether the timer's been set this session (else we show the default). */
  let restStarted = $state(false);
  let restDone = $state(false);
  let restTick: ReturnType<typeof setInterval> | null = null;

  /** Seconds shown: the live countdown, or the default before first use. */
  const restDisplay = $derived(restStarted ? restRemaining : restDefault);

  function fmtClock(s: number): string {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  function restStop() {
    restRunning = false;
    if (restTick) {
      clearInterval(restTick);
      restTick = null;
    }
  }

  function restToggle() {
    if (restRunning) {
      restStop(); // pause
      return;
    }
    restDone = false;
    if (!restStarted || restRemaining <= 0) {
      restRemaining = restDefault;
      restStarted = true;
    }
    restRunning = true;
    restTick = setInterval(() => {
      restRemaining -= 1;
      if (restRemaining <= 0) {
        restRemaining = 0;
        restStop();
        restDone = true;
        restBeep();
      }
    }, 1000);
  }

  function restReset() {
    restStop();
    restStarted = true;
    restDone = false;
    restRemaining = restDefault;
  }

  function restAdjust(delta: number) {
    restStarted = true;
    restDone = false;
    if (!restRunning && restRemaining <= 0) restRemaining = restDefault;
    restRemaining = Math.max(0, restRemaining + delta);
  }

  /** Short beep when a rest ends. Best-effort — never throws. */
  function restBeep() {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
      osc.onended = () => ctx.close();
    } catch {
      /* audio unavailable — the visual "Rest over!" state still shows */
    }
  }

  onDestroy(restStop);

  // In-page "did you forget to finish?" reminder (notifications.md). The
  // reliable local path: while this page is open, fire exactly at the 45-min
  // mark. The server's Web Push covers the closed-app case. Guard against
  // re-firing for the same workout.
  let staleFiredFor: string | null = $state(null);

  async function fireStaleReminder(w: Workout) {
    if (staleFiredFor === w.id) return;
    staleFiredFor = w.id;
    await showLocalNotification({
      title: 'Still training? ⏱️',
      body: `You started ${w.name} a while ago — finish it to save your sets.`,
      tag: `stale_workout:${w.id}`,
      url: href('/workout/'),
    });
  }

  $effect(() => {
    const w = workout;
    if (!w || w.state !== 'in_progress' || !w.started_at || editing) return;
    if (!profile?.notifications_enabled || !(profile?.notify_stale_workout ?? true)) return;
    if (staleFiredFor === w.id) return;
    const ms = msUntilStale(w.started_at);
    if (ms <= 0) {
      void fireStaleReminder(w);
      return;
    }
    const id = setTimeout(() => void fireStaleReminder(w), ms);
    return () => clearTimeout(id);
  });
  const du = $derived(profile?.display_distance_unit ?? 'km');
  const doneCount = $derived(items.flatMap((i) => i.sets).filter((s) => s.completed).length);
  const totalCount = $derived(items.flatMap((i) => i.sets).length);
  /** A set is "empty" if none of its measurement fields are filled in. */
  const isEmptySet = (s: WorkoutSet) =>
    s.reps == null && s.weight_kg == null && s.time_seconds == null && s.distance_km == null;
  const emptyCount = $derived(items.flatMap((i) => i.sets).filter(isEmptySet).length);
  const mainBodyParts = $derived(
    topBodyParts(items.map((i) => ({ exercise: i.exercise, weight: i.sets.length })))
  );

  /** Fields a set needs before it counts as "entered" for its measurement type. */
  const REQUIRED_FIELDS: Record<MeasurementType, (keyof WorkoutSet)[]> = {
    reps: ['reps'],
    weight_reps: ['weight_kg', 'reps'],
    distance: ['distance_km'],
    time: ['time_seconds'],
    distance_time: ['distance_km', 'time_seconds'],
    weight_time: ['weight_kg', 'time_seconds'],
  };

  onMount(async () => {
    profile = (await all<UserProfile>('user_profile'))[0];
    exercises = (await all<Exercise>('exercises')).sort((a, b) => a.name.localeCompare(b.name));

    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    completeOn = params.get('completeOn');
    workout = id ? await get<Workout>('workouts', id) : await getInProgressWorkout();

    if (workout) {
      // Deep-link from history: open a completed workout straight into editing.
      if (workout.state === 'completed' && params.get('edit') === '1') editing = true;
      notes = workout.notes ?? '';
      // Notes carried over from the previous workout of this template.
      if (workout.workout_template_id) {
        priorNotes = await getLatestTemplateNotes(workout.workout_template_id, workout.id);
      }
      await loadItems();
    } else {
      templates = (await all<WorkoutTemplate>('workout_templates')).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      // No workout in progress: offer the program's next scheduled workout.
      nextScheduled = await getNextWorkout();
      if (nextScheduled?.workout_template_id) {
        const tes = (
          await byIndex<WorkoutTemplateExercise>(
            'workout_template_exercises',
            'workout_template_id',
            nextScheduled.workout_template_id
          )
        ).sort((a, b) => a.position - b.position);
        const exById = new Map(exercises.map((e) => [e.id, e]));
        nextPreview = tes.map((te) => ({
          name: exById.get(te.exercise_id)?.name ?? 'Unknown exercise',
          sets: te.set_count,
        }));
      }
    }
    loading = false;
  });

  function nextLabel(w: Workout): string {
    if (!w.scheduled_on) return 'Unscheduled';
    const days = daysBetween(todayLocal(), w.scheduled_on);
    if (days === 0) return 'Scheduled for today';
    if (days === 1) return 'Scheduled for tomorrow';
    if (days < 0) return `Was scheduled ${formatDate(w.scheduled_on)}`;
    return `Scheduled for ${formatDate(w.scheduled_on)}`;
  }

  async function startNextScheduled() {
    if (!nextScheduled || busy) return;
    busy = true;
    await startWorkout($state.snapshot(nextScheduled) as Workout);
    location.replace(href(`/workout/?id=${nextScheduled.id}`));
  }

  async function loadItems() {
    if (!workout) return;
    const wes = (await byIndex<WorkoutExercise>('workout_exercises', 'workout_id', workout.id)).sort(
      (a, b) => a.position - b.position
    );
    const exById = new Map(exercises.map((e) => [e.id, e]));
    const loaded: Item[] = [];
    for (const we of wes) {
      const sets = (await byIndex<WorkoutSet>('workout_sets', 'workout_exercise_id', we.id)).sort(
        (a, b) => a.position - b.position
      );
      loaded.push({ we, exercise: exById.get(we.exercise_id), sets });
    }
    items = loaded;
  }

  async function startFromPicker() {
    const template = templates.find((t) => t.id === pickerTemplateId);
    if (!template || busy) return;
    busy = true;
    const w = await startAdhocWorkout(template);
    location.replace(href(`/workout/?id=${w.id}`));
  }

  function num(e: Event): number | null {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? null : Number(v);
  }

  /**
   * Persist a patch to a set immediately — nothing lives only in memory.
   * The patch is applied to reactive state FIRST and the merged row is what
   * gets written; otherwise two rapid edits (e.g. weight change + done
   * checkbox in one gesture) each snapshot the same stale row and the second
   * write silently reverts the first.
   */
  async function saveSet(item: Item, set: WorkoutSet, patch: Partial<WorkoutSet>) {
    const idx = item.sets.findIndex((s) => s.id === set.id);
    if (idx < 0) return;
    Object.assign(item.sets[idx], patch);

    // Entering data checks the set off automatically (once every field the
    // measurement type needs is filled). Only the checkbox unchecks it.
    if (!('completed' in patch)) {
      const mt = item.exercise?.measurement_type ?? 'weight_reps';
      if (REQUIRED_FIELDS[mt].every((f) => item.sets[idx][f] != null)) {
        item.sets[idx].completed = true;
      }
    }

    const saved = await put('workout_sets', $state.snapshot(item.sets[idx]) as WorkoutSet);
    item.sets[idx].updated_at = saved.updated_at;

    // Entering a value in the FIRST set carries it down to the other sets
    // that don't have that field yet — per field, so weight and reps each
    // propagate independently regardless of entry order. Autofilled sets are
    // never checked off; only their own data entry (or the checkbox) does that.
    if (!('completed' in patch) && idx === 0) {
      const VALUE_FIELDS = ['reps', 'weight_kg', 'time_seconds', 'distance_km'] as const;
      const source = item.sets[0];
      for (const [j, other] of item.sets.entries()) {
        if (j === 0 || other.completed) continue;
        let changed = false;
        for (const f of VALUE_FIELDS) {
          if (source[f] != null && other[f] == null) {
            other[f] = source[f];
            changed = true;
          }
        }
        if (changed) {
          const savedOther = await put('workout_sets', $state.snapshot(other) as WorkoutSet);
          other.updated_at = savedOther.updated_at;
        }
      }
    }
  }

  const exerciseDone = (item: Item) => item.sets.length > 0 && item.sets.every((s) => s.completed);

  async function setExerciseDone(item: Item, done: boolean) {
    for (const s of item.sets) {
      if (s.completed !== done) await saveSet(item, s, { completed: done });
    }
  }

  const groupMembers = (group: number) => items.filter((i) => i.we.superset_group === group);
  const groupDone = (group: number) => groupMembers(group).every((i) => exerciseDone(i));
  const isFirstOfGroup = (item: Item) =>
    item.we.superset_group != null && groupMembers(item.we.superset_group)[0]?.we.id === item.we.id;

  async function setGroupDone(group: number, done: boolean) {
    for (const member of groupMembers(group)) {
      await setExerciseDone(member, done);
    }
  }

  async function addSet(item: Item) {
    const last = item.sets[item.sets.length - 1];
    const created = await put(
      'workout_sets',
      withSyncFields({
        workout_exercise_id: item.we.id,
        position: item.sets.length,
        completed: false,
        reps: last?.reps ?? null,
        weight_kg: last?.weight_kg ?? null,
        time_seconds: last?.time_seconds ?? null,
        distance_km: last?.distance_km ?? null,
      })
    );
    item.sets.push(created);
  }

  async function removeSet(item: Item, set: WorkoutSet) {
    await softDelete('workout_sets', set.id);
    item.sets = item.sets.filter((s) => s.id !== set.id);
  }

  async function addExercise() {
    if (!workout || !addExerciseId) return;
    const exercise = exercises.find((e) => e.id === addExerciseId);
    if (!exercise) return;
    const we = await put(
      'workout_exercises',
      withSyncFields({
        workout_id: workout.id,
        exercise_id: exercise.id,
        position: items.length,
        superset_group: null,
      })
    );
    const sets: WorkoutSet[] = [];
    for (let i = 0; i < 3; i++) {
      sets.push(
        await put(
          'workout_sets',
          withSyncFields({
            workout_exercise_id: we.id,
            position: i,
            completed: false,
            reps: null,
            weight_kg: null,
            time_seconds: null,
            distance_km: null,
          })
        )
      );
    }
    items.push({ we, exercise, sets });
    addExerciseId = '';
  }

  async function removeExercise(item: Item) {
    if (!confirm(`Remove ${item.exercise?.name ?? 'this exercise'} from the workout?`)) return;
    await softDeleteMany('workout_sets', item.sets.map((s) => s.id));
    await softDelete('workout_exercises', item.we.id);
    items = items.filter((i) => i.we.id !== item.we.id);
  }

  /** Finish button: warn about empty sets first, otherwise complete. */
  function requestFinish() {
    if (!workout || busy) return;
    if (emptyCount > 0) {
      showFinishConfirm = true;
      return;
    }
    void completeWorkout();
  }

  async function completeWorkout() {
    if (!workout || busy) return;
    showFinishConfirm = false;
    busy = true;
    const startedAt = workout.started_at;

    // Pet game: snapshot the active pet so the summary can report the XP
    // gained across the workout grant AND the achievement grants below.
    let petBefore: { id: string; xp: number } | null = null;
    try {
      const { petsEnabled } = await import('../../lib/pets/xp');
      const profile = (await all<UserProfile>('user_profile'))[0];
      if (petsEnabled(profile) && profile?.active_pet_id) {
        const pet = await get<Pet>('pets', profile.active_pet_id);
        if (pet) petBefore = { id: pet.id, xp: pet.xp };
      }
    } catch {}

    const workoutGrant = await finishWorkout(
      { ...($state.snapshot(workout) as Workout), notes: notes.trim() || null },
      completeOn ?? undefined
    );

    // Hand a full overview to the homepage, which shows it as a modal.
    try {
      const today = todayLocal();
      const records = await computeRecords();
      const exerciseIds = new Set(items.map((i) => i.we.exercise_id));
      const prs: { exercise: string; label: string; value: number; secondary: number | null }[] = [];
      for (const rec of records) {
        if (!exerciseIds.has(rec.exercise.id)) continue;
        for (const [label, progression] of Object.entries(rec.metrics)) {
          const current = progression[progression.length - 1];
          if (current.date === today) {
            prs.push({ exercise: rec.exercise.name, label, value: current.value, secondary: current.secondary });
          }
        }
      }
      const exerciseSummaries = items.map((i) => ({
        name: i.exercise?.name ?? 'Unknown exercise',
        sets: i.sets.filter((s) => s.completed).map((s) => summarizeSet(s)),
      }));

      // Award anything this workout unlocked; new ones join the summary.
      const unlocked = (await evaluateAchievements()).map((n) => ({
        title: n.def.title + (n.tierLabel ? ` ${n.tierLabel}` : ''),
        description: n.def.description,
        scopeName: n.scopeName,
      }));

      // Pet block: XP delta across the workout grant + achievement grants.
      let petSummary: unknown = null;
      if (petBefore) {
        try {
          const { stageForXp } = await import('../../lib/pets/config');
          const after = await get<Pet>('pets', petBefore.id);
          if (after && after.xp > petBefore.xp) {
            const stageBefore = stageForXp(petBefore.xp);
            const stageAfter = stageForXp(after.xp);
            petSummary = {
              name: after.name,
              species: after.species,
              xp: after.xp,
              gained: after.xp - petBefore.xp,
              stage: stageAfter,
              evolved: stageBefore !== stageAfter,
              eggEarned: workoutGrant?.eggEarned ?? false,
            };
          }
        } catch {}
      }

      sessionStorage.setItem(
        'workoutt-workout-summary',
        JSON.stringify({
          name: workout.name,
          setsDone: doneCount,
          totalSets: totalCount,
          durationSec: startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)) : null,
          exercises: exerciseSummaries,
          prs,
          achievements: unlocked,
          pet: petSummary,
        })
      );
    } catch (err) {
      console.error('[workoutt] workout summary failed:', err);
    }
    location.href = href('/');
  }

  /** Finished editing a previously-completed workout (persist notes too). */
  async function doneEditing() {
    if (workout) {
      const snap = $state.snapshot(workout) as Workout;
      const trimmed = notes.trim() || null;
      if ((snap.notes ?? null) !== trimmed) {
        workout = await put('workouts', { ...snap, notes: trimmed });
      }
    }
    editing = false;
    // Drop the ?edit flag so a refresh shows the read-only view.
    const url = new URL(location.href);
    url.searchParams.delete('edit');
    history.replaceState(null, '', url);
  }

  async function abandon() {
    if (!workout || busy) return;
    if (!confirm('Abandon this workout? It will be discarded entirely.')) return;
    busy = true;
    await abandonWorkout($state.snapshot(workout) as Workout);
    location.href = href('/');
  }

  function summarizeSet(s: WorkoutSet): string {
    const parts: string[] = [];
    if (s.weight_kg != null) parts.push(formatWeight(s.weight_kg, wu));
    if (s.reps != null) parts.push(`× ${s.reps}`);
    if (s.time_seconds != null) parts.push(formatDuration(s.time_seconds));
    if (s.distance_km != null) parts.push(formatDistance(s.distance_km, du));
    return parts.join(' ') || '—';
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else if !workout}
  <div class="stack">
    {#if nextScheduled}
      <Card title="Next workout in your program">
        <h3>{nextScheduled.name}</h3>
        <p class="muted next-when">
          {nextLabel(nextScheduled)}
          {#if nextScheduled.original_scheduled_on}
            <span class="badge">bumped</span>
          {/if}
        </p>
        {#if nextPreview.length > 0}
          <ul class="preview-list">
            {#each nextPreview as row}
              <li>{row.name} <span class="muted">— {row.sets} sets</span></li>
            {/each}
          </ul>
        {/if}
        <button class="btn btn-primary" onclick={startNextScheduled} disabled={busy}>
          Start this workout
        </button>
      </Card>
    {/if}

    <Card title={nextScheduled ? 'Or start something else' : 'Start a workout'}>
      {#if templates.length === 0}
        <p class="muted">
          No workout in progress and no templates to start from —
          <a href={href('/workouts/')}>create a template</a> first.
        </p>
      {:else}
        <p class="muted" style="margin-bottom: var(--space-3);">
          Start an ad-hoc workout from any template (it won't affect your program schedule):
        </p>
        <div class="picker">
          <select bind:value={pickerTemplateId}>
            <option value="" disabled>Choose a template…</option>
            {#each templates as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
          <button class="btn btn-primary" onclick={startFromPicker} disabled={!pickerTemplateId || busy}>
            Start
          </button>
        </div>
      {/if}
    </Card>
  </div>
{:else if workout.state === 'completed' && !editing}
  <Card title={workout.name}>
    <p class="muted" style="margin-bottom: var(--space-3);">Completed workout.</p>
    {#each items as item (item.we.id)}
      <div style="margin-bottom: var(--space-2);">
        <strong>{item.exercise?.name ?? 'Unknown exercise'}</strong>
        <ul style="padding-left: var(--space-4);">
          {#each item.sets.filter((s) => s.completed) as s}
            <li>Set {s.position + 1}: {summarizeSet(s)}</li>
          {/each}
        </ul>
      </div>
    {/each}
    {#if workout.notes}
      <div class="notes-view">
        <strong>Notes</strong>
        <p>{workout.notes}</p>
      </div>
    {/if}
    <div class="header-actions">
      <a class="btn" href={href('/')}>Back home</a>
      <button class="btn btn-primary" onclick={() => (editing = true)}>Edit workout</button>
    </div>
  </Card>
{:else}
  <div class="workout-header">
    <div>
      <h2>{workout.name}</h2>
      <p class="muted">
        {#if editing}Editing completed workout · {/if}{doneCount}/{totalCount} sets done
      </p>
      {#if mainBodyParts.length > 0}
        <div class="bp-chips">
          {#each mainBodyParts as part}
            <span class="bp-chip">{part.replace('_', ' ')}</span>
          {/each}
        </div>
      {/if}
    </div>
    <div class="header-actions">
      {#if editing}
        <button class="btn btn-primary" onclick={doneEditing} disabled={busy}>Done editing</button>
      {:else}
        <button class="btn btn-danger" onclick={abandon} disabled={busy}>Abandon</button>
        <button class="btn btn-primary" onclick={requestFinish} disabled={busy}>Finish workout</button>
      {/if}
    </div>
  </div>

  {#if !editing}
    <div class="rest-timer" class:running={restRunning} class:done={restDone}>
      <div class="rest-label">
        <span>Rest timer</span>
        <span class="rest-time" aria-live="polite">{fmtClock(restDisplay)}</span>
      </div>
      <div class="rest-controls">
        <button class="btn" onclick={() => restAdjust(-15)} aria-label="Subtract 15 seconds">−15s</button>
        <button class="btn btn-primary rest-go" onclick={restToggle}>
          {restRunning ? 'Pause' : restStarted && restRemaining > 0 ? 'Resume' : 'Start rest'}
        </button>
        <button class="btn" onclick={() => restAdjust(15)} aria-label="Add 15 seconds">+15s</button>
        <button class="btn" onclick={restReset} aria-label="Reset rest timer">Reset</button>
      </div>
      {#if restDone}<span class="rest-done-label" role="status">Rest over! 💪</span>{/if}
    </div>
  {/if}

  {#if priorNotes}
    <div class="prior-notes" role="note">
      <strong>📝 Notes from last {workout.name} ({formatDate(priorNotes.date)})</strong>
      <p>{priorNotes.notes}</p>
    </div>
  {/if}

  <div class="stack">
    {#each items as item (item.we.id)}
      {@const mt = item.exercise?.measurement_type ?? 'weight_reps'}
      <Card>
        <div class="exercise-header">
          <h3>
            {item.exercise?.name ?? 'Unknown exercise'}
            {#if item.we.superset_group != null}
              <span class="ss-badge">SS{item.we.superset_group}</span>
            {/if}
          </h3>
          <div class="hdr-controls">
            {#if isFirstOfGroup(item)}
              <label class="hdr-check" title="Mark every set in this superset done">
                <input
                  type="checkbox"
                  checked={groupDone(item.we.superset_group!)}
                  onchange={(e) => setGroupDone(item.we.superset_group!, (e.target as HTMLInputElement).checked)}
                />
                Superset done
              </label>
            {/if}
            <label class="hdr-check" title="Mark every set of this exercise done">
              <input
                type="checkbox"
                checked={exerciseDone(item)}
                onchange={(e) => setExerciseDone(item, (e.target as HTMLInputElement).checked)}
              />
              All done
            </label>
            <button class="btn btn-danger" onclick={() => removeExercise(item)} aria-label="Remove exercise">✕</button>
          </div>
        </div>

        <div class="sets">
          <div class="set-row set-head">
            <span>Set</span>
            {#if mt === 'weight_reps' || mt === 'weight_time'}<span>Weight ({wu})</span>{/if}
            {#if mt === 'reps' || mt === 'weight_reps'}<span>Reps</span>{/if}
            {#if mt === 'time' || mt === 'distance_time' || mt === 'weight_time'}<span>Time</span>{/if}
            {#if mt === 'distance' || mt === 'distance_time'}<span>Distance ({du})</span>{/if}
            <span>Done</span>
            <span></span>
          </div>

          {#each item.sets as s (s.id)}
            <div class="set-row" class:done={s.completed}>
              <span class="set-num">{s.position + 1}</span>
              {#if mt === 'weight_reps' || mt === 'weight_time'}
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  inputmode="decimal"
                  value={s.weight_kg == null ? '' : round1(kgToDisplay(s.weight_kg, wu))}
                  onchange={(e) => {
                    const v = num(e);
                    saveSet(item, s, { weight_kg: v == null ? null : displayToKg(v, wu) });
                  }}
                  aria-label={`Set ${s.position + 1} weight`}
                />
              {/if}
              {#if mt === 'reps' || mt === 'weight_reps'}
                <input
                  type="number"
                  min="0"
                  inputmode="numeric"
                  value={s.reps ?? ''}
                  onchange={(e) => saveSet(item, s, { reps: num(e) })}
                  aria-label={`Set ${s.position + 1} reps`}
                />
              {/if}
              {#if mt === 'time' || mt === 'distance_time' || mt === 'weight_time'}
                <TimeInput
                  seconds={s.time_seconds}
                  onchange={(v) => saveSet(item, s, { time_seconds: v })}
                  ariaLabel={`Set ${s.position + 1} time`}
                />
              {/if}
              {#if mt === 'distance' || mt === 'distance_time'}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputmode="decimal"
                  value={s.distance_km == null ? '' : round1(kmToDisplay(s.distance_km, du) * 100) / 100}
                  onchange={(e) => {
                    const v = num(e);
                    saveSet(item, s, { distance_km: v == null ? null : displayToKm(v, du) });
                  }}
                  aria-label={`Set ${s.position + 1} distance`}
                />
              {/if}
              <input
                type="checkbox"
                class="done-check"
                checked={s.completed}
                onchange={(e) => saveSet(item, s, { completed: (e.target as HTMLInputElement).checked })}
                aria-label={`Set ${s.position + 1} done`}
              />
              <button class="remove-set" onclick={() => removeSet(item, s)} aria-label={`Remove set ${s.position + 1}`}>
                ✕
              </button>
            </div>
          {/each}
        </div>

        <button class="btn" style="margin-top: var(--space-2);" onclick={() => addSet(item)}>
          + Add set
        </button>
      </Card>
    {/each}

    <Card title="Add exercise">
      <div class="picker">
        <select bind:value={addExerciseId}>
          <option value="" disabled>Choose an exercise…</option>
          {#each exercises as ex}
            <option value={ex.id}>{ex.name}</option>
          {/each}
        </select>
        <button class="btn" onclick={addExercise} disabled={!addExerciseId}>Add</button>
      </div>
    </Card>

    <Card title="Notes">
      <p class="muted" style="margin-bottom: var(--space-2); font-size: var(--font-size-sm);">
        Saved when you finish and shown at the start of your next {workout.name}.
      </p>
      <textarea
        bind:value={notes}
        rows="3"
        placeholder="e.g. bumped bench to 62.5kg next time, left knee felt tight…"
        aria-label="Workout notes"
      ></textarea>
    </Card>
  </div>

  {#if showFinishConfirm}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="finish-confirm-title">
      <div class="modal">
        <h3 id="finish-confirm-title">Finish with empty sets?</h3>
        <p class="muted">
          {emptyCount} {emptyCount === 1 ? 'set has' : 'sets have'} no values entered. Those
          empty sets won't be counted. Finish this workout anyway?
        </p>
        <div class="modal-actions">
          <button type="button" class="btn" onclick={() => (showFinishConfirm = false)} disabled={busy}>
            Go back
          </button>
          <button type="button" class="btn btn-primary" onclick={completeWorkout} disabled={busy}>
            Finish anyway
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .workout-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .header-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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
    max-width: 30rem;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .modal-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .exercise-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }

  .hdr-controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .hdr-check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    margin: 0;
    cursor: pointer;
    white-space: nowrap;
  }

  .hdr-check input {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--color-primary);
  }

  .ss-badge {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 700;
    vertical-align: middle;
  }

  .bp-chips {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin-top: var(--space-1);
  }

  .prior-notes {
    background: var(--color-primary-soft);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .prior-notes p {
    margin-top: var(--space-1);
    white-space: pre-wrap;
  }

  .notes-view {
    border-top: 1px solid var(--border-color);
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .notes-view p {
    margin-top: var(--space-1);
    white-space: pre-wrap;
  }

  .bp-chip {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .sets {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .set-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .set-row > input[type='number'] {
    flex: 1;
    min-width: 3rem;
  }

  .set-head {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .set-head > span {
    flex: 1;
  }

  .set-head > span:first-child,
  .set-num {
    flex: 0 0 2rem;
  }

  .set-head > span:nth-last-child(2) {
    flex: 0 0 2.5rem;
  }

  .set-head > span:last-child {
    flex: 0 0 2rem;
  }

  .set-row.done .set-num {
    color: var(--color-success);
    font-weight: 700;
  }

  .done-check {
    flex: 0 0 2.5rem;
    width: 1.4rem;
    height: 1.4rem;
    accent-color: var(--color-primary);
  }

  .remove-set {
    flex: 0 0 2rem;
    background: none;
    border: none;
    color: var(--text-muted-color);
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .remove-set:hover {
    color: var(--color-danger);
  }

  .picker {
    display: flex;
    gap: var(--space-2);
  }

  .next-when {
    margin-bottom: var(--space-2);
  }

  .preview-list {
    list-style: none;
    padding: 0;
    margin-bottom: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .preview-list li {
    font-weight: 600;
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

  /* --- Rest timer --- */
  .rest-timer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    background: var(--surface-color);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
  }

  .rest-timer.running {
    border-color: var(--color-primary);
  }

  .rest-timer.done {
    border-color: var(--color-warning);
    animation: rest-flash 0.5s ease-in-out 3;
  }

  @keyframes rest-flash {
    0%, 100% { background: var(--surface-color); }
    50% { background: var(--color-primary-soft); }
  }

  .rest-label {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }

  .rest-label > span:first-child {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    font-weight: 600;
  }

  .rest-time {
    font-size: 1.9rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .rest-controls {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-left: auto;
  }

  .rest-go {
    min-width: 6rem;
  }

  .rest-done-label {
    font-weight: 700;
    color: var(--color-warning);
    flex-basis: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .rest-timer.done {
      animation: none;
    }
  }
</style>
