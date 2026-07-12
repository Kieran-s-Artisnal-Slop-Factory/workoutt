<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, softDelete, withSyncFields } from '../../lib/db/repo';
  import { computeRecords, type ExerciseRecords, type RecordEntry } from '../../lib/services/records';
  import { formatWeight, kgToDisplay, displayToKg } from '../../lib/utils/units';
  import { formatRecordValue } from '../../lib/utils/records-format';
  import { formatDate, parseLocalDate, todayLocal, addMonths } from '../../lib/utils/dates';
  import { href } from '../../lib/paths';
  import type { BodyWeightEntry, UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';
  import Accordion from '../Accordion.svelte';
  import LineChart from '../LineChart.svelte';
  import Pagination from '../Pagination.svelte';

  const PAGE_SIZE = 45;
  const WEIGHT_HISTORY_PAGE_SIZE = 12;

  let loading = $state(true);
  let records: ExerciseRecords[] = $state([]);
  let profile: UserProfile | undefined = $state();
  let weightEntries: BodyWeightEntry[] = $state([]);
  let newWeight: number | '' = $state('');

  // Inline editing of a past body-weight entry.
  let editingWeightId: string | null = $state(null);
  let editWeightValue: number | '' = $state('');
  let editWeightDate = $state('');
  let weightHistoryPage = $state(0);

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

  // How many months of body-weight to chart (0 = all time). The logs below
  // always show the full history regardless of this.
  const chartMonths = $derived(profile?.weight_chart_months ?? 3);
  const chartCutoff = $derived(chartMonths > 0 ? addMonths(todayLocal(), -chartMonths) : '');
  const RANGE_LABELS: Record<number, string> = {
    0: 'all time',
    1: 'last month',
    2: 'last 2 months',
    3: 'last 3 months',
    6: 'last 6 months',
    12: 'last year',
  };
  const rangeLabel = $derived(RANGE_LABELS[chartMonths] ?? `last ${chartMonths} months`);

  let recordSearch = $state('');
  const matchedRecords = $derived(
    recordSearch.trim()
      ? records.filter((r) => r.exercise.name.toLowerCase().includes(recordSearch.trim().toLowerCase()))
      : records
  );
  const highlightedRecords = $derived(matchedRecords.filter((r) => highlightedIds.has(r.exercise.id)));
  const otherRecords = $derived(matchedRecords.filter((r) => !highlightedIds.has(r.exercise.id)));

  // Pagination applies only to the non-highlighted list; highlighted PRs
  // always show in full above.
  let page = $state(0);
  const pagedOtherRecords = $derived(otherRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
  // Reset to the first page whenever the search changes.
  $effect(() => {
    recordSearch;
    page = 0;
  });

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
      // Only chart entries within the selected range (logs stay full).
      if (chartCutoff && e.measured_on < chartCutoff) continue;
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

  // --- Editing / deleting past entries.
  const weightHistory = $derived(
    [...weightEntries].sort((a, b) => b.measured_on.localeCompare(a.measured_on))
  );
  const pagedWeightHistory = $derived(
    weightHistory.slice(
      weightHistoryPage * WEIGHT_HISTORY_PAGE_SIZE,
      (weightHistoryPage + 1) * WEIGHT_HISTORY_PAGE_SIZE
    )
  );

  function startEditWeight(entry: BodyWeightEntry) {
    editingWeightId = entry.id;
    editWeightValue = Math.round(kgToDisplay(entry.weight_kg, wu) * 10) / 10;
    editWeightDate = entry.measured_on;
  }

  function cancelEditWeight() {
    editingWeightId = null;
    editWeightValue = '';
    editWeightDate = '';
  }

  async function saveEditWeight(entry: BodyWeightEntry) {
    if (editWeightValue === '' || !editWeightDate) return;
    await put('body_weight_entries', {
      ...($state.snapshot(entry) as BodyWeightEntry),
      weight_kg: displayToKg(Number(editWeightValue), wu),
      measured_on: editWeightDate,
    });
    cancelEditWeight();
    await refresh();
  }

  async function deleteWeight(entry: BodyWeightEntry) {
    if (!confirm(`Delete the weight entry from ${formatDate(entry.measured_on)}?`)) return;
    await softDelete('body_weight_entries', entry.id);
    if (editingWeightId === entry.id) cancelEditWeight();
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
          <p class="muted chart-range">
            Chart: {rangeLabel} · <a href={href('/settings/')}>change range</a>
          </p>
          <LineChart
            data={weightChartData}
            xAxisDataField="date"
            yAxisDataField="weight"
            yAxisLabel={`Weight (${wu})`}
            xAxisLabel="Date"
            height={260}
          />
        {:else if weightEntries.length === 0}
          <p class="muted">No weight entries yet.</p>
        {:else if weightChartData.length <= 1 && chartCutoff}
          <p class="muted">
            Not enough entries in the {rangeLabel} to chart — your full history is
            below. <a href={href('/settings/')}>Widen the range</a> in Settings.
          </p>
        {:else}
          <p class="muted">
            One entry so far ({formatWeight(weightEntries[0].weight_kg, wu)} on
            {formatDate(weightEntries[0].measured_on)}) — add more to see the trend.
          </p>
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

        {#if weightEntries.length > 0}
          <div style="margin-top: var(--space-3);">
            <Accordion summary={`History (${weightEntries.length} ${weightEntries.length === 1 ? 'entry' : 'entries'})`}>
              <ul class="weight-history">
                {#each pagedWeightHistory as entry (entry.id)}
                  <li>
                    {#if editingWeightId === entry.id}
                      <div class="wh-edit">
                        <input
                          type="date"
                          bind:value={editWeightDate}
                          aria-label="Entry date"
                        />
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          bind:value={editWeightValue}
                          aria-label={`Weight (${wu})`}
                        />
                        <span class="wh-unit">{wu}</span>
                        <button class="btn btn-primary" onclick={() => saveEditWeight(entry)} disabled={editWeightValue === '' || !editWeightDate}>
                          Save
                        </button>
                        <button class="btn" onclick={cancelEditWeight}>Cancel</button>
                      </div>
                    {:else}
                      <div class="wh-row">
                        <span class="wh-date">{formatDate(entry.measured_on)}</span>
                        <span class="wh-weight">{formatWeight(entry.weight_kg, wu)}</span>
                        <div class="wh-actions">
                          <button class="btn" onclick={() => startEditWeight(entry)}>Edit</button>
                          <button class="btn btn-danger" onclick={() => deleteWeight(entry)}>Delete</button>
                        </div>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
              <Pagination
                total={weightHistory.length}
                pageSize={WEIGHT_HISTORY_PAGE_SIZE}
                bind:page={weightHistoryPage}
                label="entries"
              />
            </Accordion>
          </div>
        {/if}
      </Card>
    {/if}

    {#if records.length > 0}
      <input
        type="search"
        class="record-search"
        placeholder="Search records by exercise…"
        bind:value={recordSearch}
      />
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
    {:else if matchedRecords.length === 0}
      <p class="muted">No records match “{recordSearch}”.</p>
    {:else if otherRecords.length === 0}
      <p class="muted">All matching records are highlighted above.</p>
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

  .chart-range {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-2);
  }

  .record-search {
    margin-bottom: var(--space-1);
  }

  .weight-history {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .weight-history li {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .weight-history li:last-child {
    border-bottom: none;
  }

  .wh-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .wh-date {
    flex: 1;
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
  }

  .wh-weight {
    font-weight: 700;
  }

  .wh-actions {
    display: flex;
    gap: var(--space-2);
  }

  .wh-actions .btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
  }

  .wh-edit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .wh-edit input[type='date'] {
    width: auto;
    flex: 1 1 9rem;
  }

  .wh-edit input[type='number'] {
    width: auto;
    flex: 0 1 5rem;
  }

  .wh-unit {
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
  }

  .wh-edit .btn {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
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
