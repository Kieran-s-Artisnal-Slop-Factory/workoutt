<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, withSyncFields } from '../../lib/db/repo';
  import { computeRecords, type ExerciseRecords, type RecordEntry } from '../../lib/services/records';
  import { formatWeight, kgToDisplay, displayToKg } from '../../lib/utils/units';
  import { formatRecordValue } from '../../lib/utils/records-format';
  import { formatDate, parseLocalDate, todayLocal } from '../../lib/utils/dates';
  import type { BodyWeightEntry, UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Accordion from '../Accordion.svelte';
  import LineChart from '../LineChart.svelte';
  import Pagination from '../Pagination.svelte';

  const PAGE_SIZE = 45;

  let loading = $state(true);
  let records: ExerciseRecords[] = $state([]);
  let profile: UserProfile | undefined = $state();
  let weightEntries: BodyWeightEntry[] = $state([]);
  let newWeight: number | '' = $state('');

  onMount(refresh);

  async function refresh() {
    profile = (await all<UserProfile>('user_profile'))[0];
    records = await computeRecords();
    weightEntries = (await all<BodyWeightEntry>('body_weight_entries')).sort((a, b) =>
      a.measured_on.localeCompare(b.measured_on)
    );
    loading = false;
  }

  const wu = $derived(profile?.display_weight_unit ?? 'kg');
  const du = $derived(profile?.display_distance_unit ?? 'km');
  const highlightedIds = $derived(new Set(profile?.highlighted_exercise_ids ?? []));
  const highlightedRecords = $derived(records.filter((r) => highlightedIds.has(r.exercise.id)));
  const otherRecords = $derived(records.filter((r) => !highlightedIds.has(r.exercise.id)));

  // Pagination applies only to the non-highlighted list; highlighted PRs
  // always show in full above.
  let page = $state(0);
  const pagedOtherRecords = $derived(otherRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));

  async function toggleHighlight(exerciseId: string) {
    if (!profile) return;
    const current = profile.highlighted_exercise_ids ?? [];
    profile.highlighted_exercise_ids = current.includes(exerciseId)
      ? current.filter((id) => id !== exerciseId)
      : [...current, exerciseId];
    profile = await put('user_profile', $state.snapshot(profile) as UserProfile);
  }

  const formatValue = (label: string, entry: RecordEntry) =>
    formatRecordValue(label, entry, wu, du);

  // One point per day: if a day has several entries (e.g. logged twice),
  // chart the most recently updated one — stacked same-day points render as
  // an unreadable vertical smear otherwise.
  const weightChartData = $derived.by(() => {
    const byDay = new Map<string, BodyWeightEntry>();
    for (const e of weightEntries) {
      const prev = byDay.get(e.measured_on);
      if (!prev || e.updated_at > prev.updated_at) byDay.set(e.measured_on, e);
    }
    return [...byDay.values()]
      .sort((a, b) => a.measured_on.localeCompare(b.measured_on))
      .map((e) => ({
        // Date objects so Plot uses a proper time scale, not a point scale
        date: parseLocalDate(e.measured_on),
        weight: Math.round(kgToDisplay(e.weight_kg, wu) * 10) / 10,
      }));
  });

  /** Upsert: logging again on the same day updates that day's entry. */
  async function addWeight(e: SubmitEvent) {
    e.preventDefault();
    if (newWeight === '') return;
    const today = todayLocal();
    const kg = displayToKg(Number(newWeight), wu);
    const existing = weightEntries
      .filter((en) => en.measured_on === today)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (existing) {
      await put('body_weight_entries', { ...($state.snapshot(existing) as BodyWeightEntry), weight_kg: kg });
    } else {
      await put('body_weight_entries', withSyncFields({ weight_kg: kg, measured_on: today }));
    }
    newWeight = '';
    await refresh();
  }
</script>

{#snippet recordCard(rec: ExerciseRecords)}
  <Card>
    <div class="rec-head">
      <h3 class="rec-name">{rec.exercise.name}</h3>
      <button
        class="star"
        class:active={highlightedIds.has(rec.exercise.id)}
        title={highlightedIds.has(rec.exercise.id) ? 'Remove from Highlighted PRs' : 'Add to Highlighted PRs'}
        aria-label={highlightedIds.has(rec.exercise.id)
          ? `Remove ${rec.exercise.name} from Highlighted PRs`
          : `Add ${rec.exercise.name} to Highlighted PRs`}
        aria-pressed={highlightedIds.has(rec.exercise.id)}
        onclick={() => toggleHighlight(rec.exercise.id)}
      >
        {highlightedIds.has(rec.exercise.id) ? '★' : '☆'}
      </button>
    </div>
    <div class="metrics">
      {#each Object.entries(rec.metrics) as [label, progression]}
        {@const current = progression[progression.length - 1]}
        <div class="metric">
          <span class="metric-label">{label}</span>
          <span class="metric-value">{formatValue(label, current)}</span>
          <span class="metric-date">{formatDate(current.date)}</span>
          {#if progression.length > 1}
            <Accordion summary={`History (${progression.length - 1} previous)`}>
              <ul class="history">
                {#each [...progression.slice(0, -1)].reverse() as prev}
                  <li>
                    {formatValue(label, prev)}
                    <span class="muted">— {formatDate(prev.date)}</span>
                  </li>
                {/each}
              </ul>
            </Accordion>
          {/if}
        </div>
      {/each}
    </div>
  </Card>
{/snippet}

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    {#if profile?.weight_tracking_enabled}
      <Card title="Body weight">
        {#if weightChartData.length > 1}
          <LineChart
            data={weightChartData}
            xAxisDataField="date"
            yAxisDataField="weight"
            yAxisLabel={`Weight (${wu})`}
            xAxisLabel="Date"
            height={260}
          />
        {:else if weightEntries.length === 1}
          <p class="muted">
            One entry so far ({formatWeight(weightEntries[0].weight_kg, wu)} on
            {formatDate(weightEntries[0].measured_on)}) — add more to see the trend.
          </p>
        {:else}
          <p class="muted">No weight entries yet.</p>
        {/if}
        <form class="weight-form" onsubmit={addWeight}>
          <input
            type="number"
            step="0.1"
            min="1"
            placeholder={`Today's weight (${wu})`}
            bind:value={newWeight}
          />
          <button class="btn btn-primary" type="submit" disabled={newWeight === ''}>Log</button>
        </form>
      </Card>
    {/if}

    {#if highlightedRecords.length > 0}
      <h2 class="section-title">Highlighted PRs</h2>
      {#each highlightedRecords as rec (rec.exercise.id)}
        {@render recordCard(rec)}
      {/each}
    {/if}

    <h2 class="section-title">Personal records</h2>
    {#if records.length === 0}
      <p class="muted">
        No records yet — they're computed automatically from completed workouts.
      </p>
    {:else if otherRecords.length === 0}
      <p class="muted">All your records are highlighted above.</p>
    {:else}
      {#each pagedOtherRecords as rec (rec.exercise.id)}
        {@render recordCard(rec)}
      {/each}
      <Pagination total={otherRecords.length} pageSize={PAGE_SIZE} bind:page label="records" />
    {/if}
  </div>
{/if}

<style>
  .weight-form {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .rec-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .rec-name {
    font-size: var(--font-size-lg);
  }

  .star {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-xl);
    line-height: 1;
    color: var(--text-muted-color);
    padding: var(--space-1);
  }

  .star:hover {
    color: var(--color-primary);
  }

  .star.active {
    color: var(--color-primary);
  }

  .metrics {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }

  .metric {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .metric-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .metric-value {
    font-size: var(--font-size-xl);
    font-weight: 800;
    color: var(--color-primary-strong);
  }

  .metric-date {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
  }

  .history {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
