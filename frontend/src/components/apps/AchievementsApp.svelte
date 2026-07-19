<script lang="ts">
  import { onMount } from 'svelte';
  import { all } from '../../lib/db/repo';
  import { getProfile } from '../../lib/db/profile';
  import { buildAggregates, evaluateAchievements, type Aggregates } from '../../lib/achievements/evaluate';
  import {
    ACCOUNT_DEFS,
    EXERCISE_DEFS,
    PROGRAM_DEFS,
    TEMPLATE_DEFS,
    type AchievementDef,
    type AchievementUnit,
    type ExerciseAggregate,
  } from '../../lib/achievements/catalogue';
  import { formatWeight, formatDistance, formatDuration } from '../../lib/utils/units';
  import { formatDate, formatTimestamp } from '../../lib/utils/dates';
  import type { AchievementAward, Exercise, Program, UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Pagination from '../Pagination.svelte';

  const EXERCISE_PAGE_SIZE = 24;

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let aggs: Aggregates | undefined = $state();
  let awards: AchievementAward[] = $state([]);
  let exerciseSearch = $state('');
  let exercisePage = $state(0);

  onMount(async () => {
    profile = (await getProfile());
    // Lazy backfill: award anything already earned (idempotent).
    const built = await buildAggregates();
    await evaluateAchievements(built);
    aggs = built;
    awards = await all<AchievementAward>('achievement_awards');
    loading = false;
  });

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const du = $derived(profile?.display_distance_unit ?? 'km');

  /** award lookup: achievement|scope_id|tier → award. */
  const awardMap = $derived(
    new Map(awards.map((a) => [`${a.achievement}|${a.scope_id}|${a.tier}`, a]))
  );

  interface TierStatus {
    tier: number;
    label: string | null;
    threshold: number;
    earnedAt: string | null;
  }

  interface DefStatus {
    def: AchievementDef;
    value: number;
    tiers: TierStatus[];
    /** First unearned tier — what the progress bar tracks. Null = all done. */
    next: TierStatus | null;
  }

  function statusFor(def: AchievementDef, scopeId: string, value: number): DefStatus {
    const tiers = def.tiers.map((tr) => ({
      tier: tr.tier,
      label: tr.label ?? null,
      threshold: tr.threshold,
      earnedAt: awardMap.get(`${def.id}|${scopeId}|${tr.tier}`)?.earned_at ?? null,
    }));
    return { def, value, tiers, next: tiers.find((tr) => !tr.earnedAt) ?? null };
  }

  const emptyExerciseAgg: ExerciseAggregate = {
    volumeKg: 0,
    reps: 0,
    seconds: 0,
    distanceKm: 0,
    sets: 0,
    workouts: 0,
  };

  const accountStatuses = $derived(
    aggs ? ACCOUNT_DEFS.map((def) => statusFor(def, '', def.metric(aggs!.account))) : []
  );

  /** Exercises with any progress or any award, alphabetical. */
  const exerciseGroups = $derived.by(() => {
    if (!aggs) return [];
    const withAwards = new Set(
      awards.filter((a) => a.scope_type === 'exercise').map((a) => a.scope_id)
    );
    return aggs.exercises
      .filter((ex) => aggs!.byExercise.has(ex.id) || withAwards.has(ex.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((exercise) => {
        const agg = aggs!.byExercise.get(exercise.id) ?? emptyExerciseAgg;
        const statuses = EXERCISE_DEFS.filter((def) =>
          def.measurementTypes.includes(exercise.measurement_type)
        ).map((def) => statusFor(def, exercise.id, def.metric(agg)));
        return { exercise, statuses };
      })
      .filter((g) => g.statuses.length > 0);
  });

  const matchedExerciseGroups = $derived(
    exerciseSearch.trim()
      ? exerciseGroups.filter((g) =>
          g.exercise.name.toLowerCase().includes(exerciseSearch.trim().toLowerCase())
        )
      : exerciseGroups
  );
  const pagedExerciseGroups = $derived(
    matchedExerciseGroups.slice(
      exercisePage * EXERCISE_PAGE_SIZE,
      (exercisePage + 1) * EXERCISE_PAGE_SIZE
    )
  );
  $effect(() => {
    exerciseSearch;
    exercisePage = 0;
  });

  /** Program iterations, most recent first. */
  const programGroups = $derived.by(() => {
    if (!aggs) return [];
    return [...aggs.programs]
      .sort((a, b) => b.started_on.localeCompare(a.started_on))
      .map((program) => {
        const agg = aggs!.byProgram.get(program.id);
        if (!agg) return null;
        return {
          program,
          statuses: PROGRAM_DEFS.map((def) => statusFor(def, program.id, def.metric(agg))),
        };
      })
      .filter((g) => g != null);
  });

  /** Program templates (lifetime scope): every template a run points at. */
  const templateGroups = $derived.by(() => {
    if (!aggs) return [];
    const names = new Map(aggs.programTemplates.map((pt) => [pt.id, pt.name]));
    const ids = [...new Set(aggs.programs.map((p) => p.program_template_id).filter((x) => x != null))];
    return ids
      .map((id) => {
        const agg = aggs!.byTemplate.get(id!) ?? { iterations: 0, totalWeeks: 0 };
        const name =
          names.get(id!) ?? aggs!.programs.find((p) => p.program_template_id === id)?.name ?? 'Program';
        return {
          id: id!,
          name,
          statuses: TEMPLATE_DEFS.map((def) => statusFor(def, id!, def.metric(agg))),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const earnedCount = $derived(awards.length);

  function fmtVal(unit: AchievementUnit, v: number): string {
    switch (unit) {
      case 'kg':
        return formatWeight(v, wu);
      case 'km':
        return formatDistance(v, du);
      case 'seconds':
        return formatDuration(v);
      case 'days':
        return `${Math.floor(v)} ${Math.floor(v) === 1 ? 'day' : 'days'}`;
      case 'weeks':
        return `${Math.floor(v)} ${Math.floor(v) === 1 ? 'week' : 'weeks'}`;
      default:
        return String(Math.floor(v));
    }
  }

  const programRange = (p: Program) => `${formatDate(p.started_on)} – ${formatDate(p.ends_on)}`;
</script>

{#snippet defRow(s: DefStatus)}
  {@const done = s.next == null}
  <div class="ach" class:done>
    <div class="ach-main">
      <span class="ach-title">
        {s.def.title}
        {#each s.tiers as tr}
          {#if tr.earnedAt}
            <span class="tier-badge earned" title={`Earned ${formatTimestamp(tr.earnedAt)}`}>
              {tr.label ?? '✓'}
            </span>
          {:else}
            <span class="tier-badge">{tr.label ?? '·'}</span>
          {/if}
        {/each}
      </span>
      <span class="ach-desc muted">{s.def.description}</span>
    </div>
    {#if done}
      {@const last = s.tiers[s.tiers.length - 1]}
      <span class="ach-done">Earned {last.earnedAt ? formatTimestamp(last.earnedAt) : ''} 🏅</span>
    {:else if s.next}
      <div class="ach-progress">
        <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={s.next.threshold} aria-valuenow={Math.min(s.value, s.next.threshold)}>
          <div class="fill" style={`width: ${Math.min(100, (s.value / s.next.threshold) * 100)}%`}></div>
        </div>
        <span class="progress-text muted">
          {fmtVal(s.def.unit, s.value)} / {fmtVal(s.def.unit, s.next.threshold)}
        </span>
      </div>
    {/if}
  </div>
{/snippet}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    <p class="muted">
      {earnedCount === 0
        ? 'Nothing earned yet — achievements unlock automatically as you train.'
        : `${earnedCount} ${earnedCount === 1 ? 'achievement' : 'achievements'} earned so far.`}
    </p>

    <Card title="Account">
      {#each accountStatuses as s (s.def.id)}
        {@render defRow(s)}
      {/each}
    </Card>

    <h2 class="section-title">Per exercise</h2>
    {#if exerciseGroups.length === 0}
      <p class="muted">Complete some sets and your per-exercise achievements will show up here.</p>
    {:else}
      <input
        type="search"
        class="ach-search"
        placeholder="Search exercises…"
        bind:value={exerciseSearch}
      />
      {#if matchedExerciseGroups.length === 0}
        <p class="muted">No exercises match “{exerciseSearch}”.</p>
      {/if}
      {#each pagedExerciseGroups as g (g.exercise.id)}
        <Card title={g.exercise.name}>
          {#each g.statuses as s (s.def.id)}
            {@render defRow(s)}
          {/each}
        </Card>
      {/each}
      <Pagination
        total={matchedExerciseGroups.length}
        pageSize={EXERCISE_PAGE_SIZE}
        bind:page={exercisePage}
        label="exercises"
      />
    {/if}

    <h2 class="section-title">Per program</h2>
    {#if programGroups.length === 0}
      <p class="muted">Start a program to work toward per-program achievements.</p>
    {:else}
      {#each programGroups as g (g.program.id)}
        <Card title={`${g.program.name} · ${programRange(g.program)}`}>
          {#each g.statuses as s (s.def.id)}
            {@render defRow(s)}
          {/each}
        </Card>
      {/each}
    {/if}

    {#if templateGroups.length > 0}
      <h2 class="section-title">Program lifetime</h2>
      <p class="muted" style="margin-top: calc(-1 * var(--space-2));">
        Earned once per program, across every time you run it.
      </p>
      {#each templateGroups as g (g.id)}
        <Card title={g.name}>
          {#each g.statuses as s (s.def.id)}
            {@render defRow(s)}
          {/each}
        </Card>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .ach {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .ach:last-child {
    border-bottom: none;
  }

  .ach-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .ach-title {
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }

  .ach-desc {
    font-size: var(--font-size-sm);
  }

  .tier-badge {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--text-muted-color);
    line-height: 1.6;
  }

  .tier-badge.earned {
    background: var(--color-primary-soft);
    border-color: var(--color-primary);
    color: var(--color-primary-strong);
  }

  .ach-progress {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
    width: min(40%, 12rem);
  }

  .bar {
    width: 100%;
    height: 0.5rem;
    border-radius: var(--radius-full);
    background: var(--border-color);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary);
  }

  .progress-text {
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }

  .ach-done {
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--color-primary-strong);
    flex-shrink: 0;
  }

  .ach-search {
    margin-bottom: var(--space-1);
  }

  @media (max-width: 30rem) {
    .ach {
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
    }

    .ach-progress {
      width: 100%;
      align-items: stretch;
    }

    .progress-text {
      text-align: right;
    }
  }
</style>
