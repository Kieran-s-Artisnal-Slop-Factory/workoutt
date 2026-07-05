<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put } from '../../lib/db/repo';
  import { requestPersistentStorage, type PersistState } from '../../lib/db/persistence';
  import { downloadExport, importData } from '../../lib/db/export';
  import { seedSampleData } from '../../lib/db/seed';
  import type { UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let persistState: PersistState | 'unknown' = $state('unknown');
  let message = $state('');

  onMount(async () => {
    profile = (await all<UserProfile>('user_profile'))[0];
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      persistState = (await navigator.storage.persisted()) ? 'granted' : 'denied';
    } else {
      persistState = 'unsupported';
    }
    loading = false;
  });

  async function saveProfile() {
    if (!profile) return;
    if (profile.name != null) profile.name = profile.name.trim() || null;
    profile = await put('user_profile', $state.snapshot(profile) as UserProfile);
    message = 'Preferences saved.';
  }

  async function askPersist() {
    persistState = await requestPersistentStorage();
  }

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm('Importing replaces ALL current data with the backup. Continue?')) {
      input.value = '';
      return;
    }
    try {
      await importData(JSON.parse(await file.text()));
      message = 'Import complete. Reloading…';
      location.reload();
    } catch (err) {
      message = `Import failed: ${err instanceof Error ? err.message : err}`;
      input.value = '';
    }
  }

  async function runSeed() {
    message = await seedSampleData();
  }
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else}
  <div class="stack">
    {#if message}
      <p class="notice">{message}</p>
    {/if}

    {#if profile}
      <Card title="Preferences">
        <div style="margin-bottom: var(--space-3);">
          <label for="set-name">Name</label>
          <input
            id="set-name"
            bind:value={profile.name}
            onchange={saveProfile}
            placeholder="Used in the homepage greeting"
          />
        </div>
        <div class="row">
          <div>
            <label for="set-wu">Weight unit</label>
            <select id="set-wu" bind:value={profile.display_weight_unit} onchange={saveProfile}>
              <option value="kg">Kilograms (kg)</option>
              <option value="lbs">Pounds (lbs)</option>
            </select>
          </div>
          <div>
            <label for="set-du">Distance unit</label>
            <select id="set-du" bind:value={profile.display_distance_unit} onchange={saveProfile}>
              <option value="km">Kilometers (km)</option>
              <option value="mi">Miles (mi)</option>
            </select>
          </div>
        </div>
        <label style="margin-top: var(--space-3); display: flex; align-items: center; gap: var(--space-2);">
          <input
            type="checkbox"
            style="width: auto;"
            bind:checked={profile.weight_tracking_enabled}
            onchange={saveProfile}
          />
          Track body weight
        </label>
      </Card>
    {:else}
      <Card title="Preferences">
        <p class="muted">No profile yet — <a href="/onboarding/">run onboarding</a>.</p>
      </Card>
    {/if}

    <Card title="Storage">
      {#if persistState === 'granted'}
        <p>✅ Persistent storage granted — the browser won't evict your data.</p>
      {:else if persistState === 'unsupported'}
        <p class="muted">This browser doesn't support persistent storage.</p>
      {:else}
        <p>
          ⚠️ Storage is <strong>not persistent</strong>: the browser may evict
          your data under storage pressure (iOS Safari does so after ~7 days of
          inactivity). Export a backup regularly.
        </p>
        <button class="btn" onclick={askPersist} style="margin-top: var(--space-2);">
          Request persistent storage
        </button>
      {/if}
    </Card>

    <Card title="Backup">
      <p class="muted" style="margin-bottom: var(--space-3);">
        Until sync ships, this device holds the only copy of your data. Export
        a JSON backup regularly; import restores it (replacing everything).
      </p>
      <div class="actions">
        <button class="btn btn-primary" onclick={downloadExport}>Export backup</button>
        <label class="btn" style="margin-bottom: 0;">
          Import backup
          <input type="file" accept="application/json" onchange={onImportFile} hidden />
        </label>
      </div>
    </Card>

    <Card title="Developer">
      <p class="muted" style="margin-bottom: var(--space-3);">
        Load sample exercises, templates, and history for trying the app out.
      </p>
      <button class="btn" onclick={runSeed}>Load sample data</button>
    </Card>
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .notice {
    background: var(--color-primary-soft);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  @media (max-width: 30rem) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
