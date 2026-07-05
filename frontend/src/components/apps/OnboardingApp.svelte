<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, withSyncFields, nowIso } from '../../lib/db/repo';
  import { requestPersistentStorage } from '../../lib/db/persistence';
  import { displayToKg } from '../../lib/utils/units';
  import { todayLocal } from '../../lib/utils/dates';
  import type { UserProfile, WeightUnit, DistanceUnit, ExperienceLevel } from '../../lib/db/types';
  import Card from '../Card.svelte';

  let loading = $state(true);
  let saving = $state(false);

  let name = $state('');
  let weightUnit: WeightUnit = $state('kg');
  let distanceUnit: DistanceUnit = $state('km');
  let currentWeight: number | '' = $state('');
  let age: number | '' = $state('');
  let height: number | '' = $state('');
  let experience: ExperienceLevel = $state('beginner');

  onMount(async () => {
    const profiles = await all<UserProfile>('user_profile');
    if (profiles[0]?.onboarding_completed_at) {
      location.href = '/';
      return;
    }
    loading = false;
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    saving = true;

    await put(
      'user_profile',
      withSyncFields({
        name: name.trim() || null,
        display_weight_unit: weightUnit,
        display_distance_unit: distanceUnit,
        age_years: age === '' ? null : Number(age),
        height_cm: height === '' ? null : Number(height),
        experience_level: experience,
        weight_tracking_enabled: currentWeight !== '',
        onboarding_completed_at: nowIso(),
      })
    );

    if (currentWeight !== '') {
      await put(
        'body_weight_entries',
        withSyncFields({
          weight_kg: displayToKg(Number(currentWeight), weightUnit),
          measured_on: todayLocal(),
        })
      );
    }

    // Ask the browser to protect our data from eviction (result shown in Settings).
    await requestPersistentStorage();
    location.href = '/';
  }
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <Card title="Welcome to Workoutt">
    <p class="muted" style="margin-bottom: var(--space-4);">
      A few details to get set up. Everything is stored on this device — no
      account needed.
    </p>

    <form class="stack" onsubmit={submit}>
      <div>
        <label for="ob-name">Your name</label>
        <input id="ob-name" bind:value={name} placeholder="What should we call you?" />
      </div>

      <div class="row">
        <div>
          <label for="ob-wu">Weight unit</label>
          <select id="ob-wu" bind:value={weightUnit}>
            <option value="kg">Kilograms (kg)</option>
            <option value="lbs">Pounds (lbs)</option>
          </select>
        </div>
        <div>
          <label for="ob-du">Distance unit</label>
          <select id="ob-du" bind:value={distanceUnit}>
            <option value="km">Kilometers (km)</option>
            <option value="mi">Miles (mi)</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label for="ob-weight">Current weight ({weightUnit}) — optional</label>
          <input
            id="ob-weight"
            type="number"
            step="0.1"
            min="1"
            bind:value={currentWeight}
            placeholder="Enables weight tracking"
          />
        </div>
        <div>
          <label for="ob-age">Age (years)</label>
          <input id="ob-age" type="number" min="1" max="120" bind:value={age} />
        </div>
      </div>

      <div class="row">
        <div>
          <label for="ob-height">Height (cm)</label>
          <input id="ob-height" type="number" min="50" max="250" bind:value={height} />
        </div>
        <div>
          <label for="ob-exp">Experience</label>
          <select id="ob-exp" bind:value={experience}>
            <option value="beginner">Beginner (&lt;1 year)</option>
            <option value="intermediate">Intermediate (&lt;5 years)</option>
            <option value="advanced">Advanced (5+ years)</option>
          </select>
        </div>
      </div>

      <button class="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Get started'}
      </button>
    </form>
  </Card>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  @media (max-width: 30rem) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
