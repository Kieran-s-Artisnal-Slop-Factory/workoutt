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

  const formatValue = (label: string, entry: RecordEntry) =>
    formatRecordValue(label, entry, wu, du);

  const weightChartData = $derived(
    weightEntries.map((e) => ({
      // Date objects so Plot uses a proper time scale, not a point scale
      date: parseLocalDate(e.measured_on),
      weight: Math.round(kgToDisplay(e.weight_kg, wu) * 10) / 10,
    }))
  );

  async function addWeight(e: SubmitEvent) {
    e.preventDefault();
    if (newWeight === '') return;
    await put(
      'body_weight_entries',
      withSyncFields({ weight_kg: displayToKg(Number(newWeight), wu), measured_on: todayLocal() })
    );
    newWeight = '';
    await refresh();
  }
</script>

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

    <h2>Personal records</h2>
    {#if records.length === 0}
      <p class="muted">
        No records yet — they're computed automatically from completed workouts.
      </p>
    {:else}
      {#each records as rec (rec.exercise.id)}
        <Card title={rec.exercise.name}>
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
      {/each}
    {/if}
  </div>
{/if}

<style>
  .weight-form {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
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
