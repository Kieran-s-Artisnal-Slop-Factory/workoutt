<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put } from '../../lib/db/repo';
  import { requestPersistentStorage, type PersistState } from '../../lib/db/persistence';
  import { downloadExport, importData } from '../../lib/db/export';
  import { seedSampleData } from '../../lib/db/seed';
  import { syncNow, getSyncStatus, getSyncUrl, setSyncUrl, type SyncStatus } from '../../lib/sync';
  import { formatTimestamp } from '../../lib/utils/dates';
  import type { UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';

  type Theme = 'system' | 'light' | 'dark';

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let persistState: PersistState | 'unknown' = $state('unknown');
  let message = $state('');
  let theme: Theme = $state('system');
  let syncUrl = $state('');
  let syncStatus: SyncStatus = $state({ lastSyncAt: null, lastError: null });
  let syncing = $state(false);

  function applyTheme() {
    if (theme === 'system') {
      localStorage.removeItem('workoutt-theme');
      document.documentElement.style.colorScheme = '';
    } else {
      localStorage.setItem('workoutt-theme', theme);
      document.documentElement.style.colorScheme = theme;
    }
  }

  async function runSync() {
    syncing = true;
    const result = await syncNow();
    syncing = false;
    message = result.ok
      ? `Synced: pushed ${result.pushed}, pulled ${result.pulled}.`
      : `Sync failed: ${result.error}`;
    syncStatus = await getSyncStatus();
  }

  function saveSyncUrl() {
    setSyncUrl(syncUrl);
    syncUrl = getSyncUrl();
    message = 'Sync server saved.';
  }

  onMount(async () => {
    const stored = localStorage.getItem('workoutt-theme');
    theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    syncUrl = getSyncUrl();
    syncStatus = await getSyncStatus();
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

    <Card title="Appearance">
      <label for="set-theme">Theme</label>
      <select id="set-theme" bind:value={theme} onchange={applyTheme}>
        <option value="system">System (follow OS setting)</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </Card>

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

    <Card title="Sync">
      {#if syncStatus.lastError}
        <p style="margin-bottom: var(--space-2);">
          ⚠️ Not currently syncing — last attempt failed:
          <span class="muted">{syncStatus.lastError}</span>
        </p>
      {:else if syncStatus.lastSyncAt}
        <p style="margin-bottom: var(--space-2);">
          ✅ Last synced {formatTimestamp(syncStatus.lastSyncAt)}.
        </p>
      {:else}
        <p class="muted" style="margin-bottom: var(--space-2);">
          Never synced. Syncing is optional — the app is fully functional
          offline; a sync server just backs up your data and shares it across
          devices.
        </p>
      {/if}
      <div style="margin-bottom: var(--space-3);">
        <label for="set-sync-url">Sync server URL (blank = same origin)</label>
        <input
          id="set-sync-url"
          bind:value={syncUrl}
          onchange={saveSyncUrl}
          placeholder="e.g. http://192.168.1.10:8080"
        />
      </div>
      <button class="btn btn-primary" onclick={runSync} disabled={syncing}>
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
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
