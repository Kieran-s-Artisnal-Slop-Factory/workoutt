<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put } from '../../lib/db/repo';
  import { requestPersistentStorage, type PersistState } from '../../lib/db/persistence';
  import { downloadExport, importData, clearAllData, SCOPE_LABELS, type ExportScope } from '../../lib/db/export';
  import { seedSampleData, type SeedType } from '../../lib/db/seed';
  import { syncNow, getSyncStatus, getSyncUrl, setSyncUrl, setSyncMode, testConnection, type SyncStatus } from '../../lib/sync';
  import { formatTimestamp } from '../../lib/utils/dates';
  import { href } from '../../lib/paths';
  import type { UserProfile } from '../../lib/db/types';
  import Card from '../Card.svelte';

  type Theme = 'system' | 'light' | 'dark';
  type ColorTheme = 'default' | 'vigor' | 'nightlife' | 'earthy' | 'aquatic';

  const COLOR_THEMES: { value: ColorTheme; label: string }[] = [
    { value: 'default', label: 'Ember (default) — orange' },
    { value: 'vigor', label: 'Vigor — red' },
    { value: 'nightlife', label: 'Nightlife — neon purple' },
    { value: 'earthy', label: 'Earthy — brown & green' },
    { value: 'aquatic', label: 'Aquatic — blue' },
  ];

  let loading = $state(true);
  let profile: UserProfile | undefined = $state();
  let persistState: PersistState | 'unknown' = $state('unknown');
  let message = $state('');
  let theme: Theme = $state('system');
  let syncUrl = $state('');
  let syncStatus: SyncStatus = $state({ lastSyncAt: null, lastError: null });
  let syncing = $state(false);
  let testing = $state(false);
  let testResult: { ok: boolean; message: string } | null = $state(null);

  async function testServer() {
    testing = true;
    testResult = null;
    testResult = await testConnection(syncUrl);
    testing = false;
  }

  // Developer options are gated: the user must type the exact phrase once
  // per browser session (sessionStorage, so it resets across sessions).
  const DEV_MODE_KEY = 'workoutt-inDeveloperMode';
  const DEV_PHRASE = 'I understand I can lose and corrupt my data by using these settings';
  let inDeveloperMode = $state(false);
  let showDevModal = $state(false);
  let devPhraseInput = $state('');

  function unlockDeveloperMode(e: SubmitEvent) {
    e.preventDefault();
    if (devPhraseInput.trim() !== DEV_PHRASE) return;
    sessionStorage.setItem(DEV_MODE_KEY, '1');
    inDeveloperMode = true;
    showDevModal = false;
    devPhraseInput = '';
  }

  async function clearData() {
    if (!confirm('Delete ALL local data? This cannot be undone — export a backup first if in doubt.')) {
      return;
    }
    await clearAllData();
    location.href = href('/onboarding/');
  }

  function applyTheme() {
    if (theme === 'system') {
      localStorage.removeItem('workoutt-theme');
      document.documentElement.style.colorScheme = '';
    } else {
      localStorage.setItem('workoutt-theme', theme);
      document.documentElement.style.colorScheme = theme;
    }
  }

  let colorTheme: ColorTheme = $state('default');

  function applyColorTheme() {
    if (colorTheme === 'default') {
      localStorage.removeItem('workoutt-color-theme');
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem('workoutt-color-theme', colorTheme);
      document.documentElement.dataset.theme = colorTheme;
    }
  }

  async function runSync(seeded:boolean=false) {
    syncing = true;
    const result = await syncNow();
    syncing = false;
    if (seeded){
      message += result.ok
      ? `\nSync After Seed Complete: pushed ${result.pushed}, pulled ${result.pulled}.`
      : `\nSync failed: ${result.error}`;
    } else{
      console.log(result.pushed, result.pulled)
      message = result.ok
        ? ((result.pushed===0) && (result.pulled===0))
          ?'Sync complete: no changes to push or pull.'
          :`Sync Complete: pushed ${result.pushed}, pulled ${result.pulled}.`
        : `Sync failed: ${result.error}`;
    }
    syncStatus = await getSyncStatus();
  }

  function saveSyncUrl() {
    setSyncUrl(syncUrl);
    syncUrl = getSyncUrl();
    if (syncUrl) setSyncMode('sync'); // configuring a server opts back into syncing
    message = 'Sync server saved.';
  }

  onMount(async () => {
    inDeveloperMode = sessionStorage.getItem(DEV_MODE_KEY) === '1';
    const stored = localStorage.getItem('workoutt-theme');
    theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    const storedColor = localStorage.getItem('workoutt-color-theme');
    colorTheme = COLOR_THEMES.some((t) => t.value === storedColor)
      ? (storedColor as ColorTheme)
      : 'default';
    syncUrl = getSyncUrl();
    syncStatus = await getSyncStatus();
    profile = (await all<UserProfile>('user_profile'))[0];
    // Backfill the default so the range <select> has a matching value.
    if (profile && profile.weight_chart_months == null) profile.weight_chart_months = 3;
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

  // --- Pet game (pets.md §1/§8) ---
  let petsBusy = $state(false);
  /** Banked XP awaiting a spend/dump decision on re-enable; 0 = no modal. */
  let petsBankChoice = $state(0);

  async function refreshProfileRow() {
    profile = (await all<UserProfile>('user_profile'))[0];
  }

  async function startPets() {
    petsBusy = true;
    const { enablePets } = await import('../../lib/pets/xp');
    await enablePets();
    await refreshProfileRow();
    petsBusy = false;
    location.href = href('/pets/');
  }

  async function turnPetsOff() {
    petsBusy = true;
    const { disablePets } = await import('../../lib/pets/xp');
    await disablePets();
    await refreshProfileRow();
    petsBusy = false;
  }

  async function turnPetsOn() {
    petsBusy = true;
    const { enablePets } = await import('../../lib/pets/xp');
    const { bankedXp } = await enablePets();
    await refreshProfileRow();
    petsBusy = false;
    if (bankedXp > 0) petsBankChoice = bankedXp;
  }

  async function petsBankSpend() {
    const { spendBank } = await import('../../lib/pets/xp');
    await spendBank();
    petsBankChoice = 0;
    await refreshProfileRow();
  }

  async function petsBankDump() {
    const { dumpBank } = await import('../../lib/pets/xp');
    await dumpBank();
    petsBankChoice = 0;
    await refreshProfileRow();
  }

  let exportScope: ExportScope = $state('templates_user');

  async function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    let envelope: unknown;
    try {
      envelope = JSON.parse(await file.text());
    } catch {
      message = 'Import failed: that file is not valid JSON.';
      input.value = '';
      return;
    }
    // A full backup replaces everything; a templates-only file merges in and
    // leaves your existing data alone — warn accordingly.
    const isFull = (envelope as { scope?: string })?.scope !== 'templates';
    const warning = isFull
      ? 'This is a full backup — importing it REPLACES all current data. Continue?'
      : 'Import these templates? They will be added to your existing data (nothing is deleted).';
    if (!confirm(warning)) {
      input.value = '';
      return;
    }
    try {
      const result = await importData(envelope as Parameters<typeof importData>[0]);
      if (result.mode === 'replaced') {
        message = 'Import complete. Reloading…';
        location.reload();
      } else {
        message = `Imported ${result.rows} rows (templates merged in).`;
        input.value = '';
      }
    } catch (err) {
      message = `Import failed: ${err instanceof Error ? err.message : err}`;
      input.value = '';
    }
  }

  let seeding = $state(false);

  async function runSeed(type: SeedType) {
    seeding = true;
    message = type === 'heavy' ? 'Loading heavy dataset… this can take a moment.' : 'Loading sample data…';
    const seedInfo = await seedSampleData(type);
    message = seedInfo;
    if (syncUrl) {
      await runSync(true); // Modifies message state in the call when seeded is true
    }
    seeding = false;
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
        {#if profile.weight_tracking_enabled}
          <div style="margin-top: var(--space-3);">
            <label for="set-weight-range">Body-weight chart range</label>
            <select id="set-weight-range" bind:value={profile.weight_chart_months} onchange={saveProfile}>
              <option value={1}>Last month</option>
              <option value={2}>Last 2 months</option>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last year</option>
              <option value={0}>All time</option>
            </select>
            <p class="muted" style="margin-top: var(--space-2); font-size: var(--font-size-sm);">
              Sets how far back the weight graph on the Records page goes. Your full
              history always stays in the log below the graph.
            </p>
          </div>
        {/if}
        <p class="muted" style="margin-top: var(--space-3); font-size: var(--font-size-sm);">
          Want the full guided setup again?
          <a href={href('/onboarding/?redo=1')}>Re-run onboarding</a> — your
          existing data is kept, and everything is prefilled from your current
          settings.
        </p>
      </Card>
    {:else}
      <Card title="Preferences">
        <p class="muted">No profile yet — <a href={href('/onboarding/')}>run onboarding</a>.</p>
      </Card>
    {/if}

    {#if profile}
      <Card title="Pet game">
        {#if !(profile.pets_started_at ?? null)}
          <p class="muted" style="margin-bottom: var(--space-3);">
            An optional collection game: training earns XP that evolves
            pixel-art companions. Purely cosmetic — it never touches your
            training data.
          </p>
          <button class="btn btn-primary" onclick={startPets} disabled={petsBusy}>
            {petsBusy ? 'Starting…' : 'Start the pet game'}
          </button>
        {:else if profile.pets_enabled}
          <p class="muted" style="margin-bottom: var(--space-3);">
            The pet game is on — manage your collection on the
            <a href={href('/pets/')}>Pets page</a>.
          </p>
          <button class="btn" onclick={turnPetsOff} disabled={petsBusy}>Disable pet game</button>
          <p class="muted" style="margin-top: var(--space-2); font-size: var(--font-size-sm);">
            Disabling hides pets everywhere but deletes nothing — points keep
            accruing to a bank you can spend if you come back.
          </p>
        {:else}
          <p class="muted" style="margin-bottom: var(--space-3);">
            The pet game is off. Your collection is safe
            {#if (profile.pets_banked_xp ?? 0) > 0}
              and <strong>{profile.pets_banked_xp} XP</strong> is banked
            {/if} — re-enable to keep playing.
          </p>
          <button class="btn btn-primary" onclick={turnPetsOn} disabled={petsBusy}>
            {petsBusy ? 'Enabling…' : 'Re-enable pet game'}
          </button>
        {/if}
      </Card>
    {/if}

    {#if petsBankChoice > 0}
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pets-bank-title">
        <div class="modal">
          <h3 id="pets-bank-title">Welcome back! 🐾</h3>
          <p>
            While the pet game was off you banked
            <strong>{petsBankChoice} XP</strong>. What should happen to it?
          </p>
          <div class="modal-actions">
            <button class="btn" onclick={petsBankDump}>Start fresh (dump it)</button>
            <button class="btn btn-primary" onclick={petsBankSpend}>
              Spend it on my active pet
            </button>
          </div>
        </div>
      </div>
    {/if}

    <Card title="Appearance">
      <div class="row">
        <div>
          <label for="set-theme">Mode</label>
          <select id="set-theme" bind:value={theme} onchange={applyTheme}>
            <option value="system">System (follow OS setting)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div>
          <label for="set-color-theme">Color theme</label>
          <select id="set-color-theme" bind:value={colorTheme} onchange={applyColorTheme}>
            {#each COLOR_THEMES as t}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
        </div>
      </div>
      <p class="muted" style="margin-top: var(--space-2); font-size: var(--font-size-sm);">
        Every color theme has a light and a dark variant — the mode picks
        which one you see.
      </p>
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
      {#if testResult}
        <p class={testResult.ok ? 'test-ok' : 'test-err'} role="status" style="margin-bottom: var(--space-2);">
          {testResult.ok ? '✅' : '⚠️'} {testResult.message}
        </p>
      {/if}
      <div class="actions">
        <button class="btn" onclick={testServer} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button class="btn btn-primary" onclick={() => runSync()} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </Card>

    <Card title="Backup">
      <p class="muted" style="margin-bottom: var(--space-3);">
        Until sync ships, this device holds the only copy of your data. Export
        a JSON backup regularly. Choose what to include:
        <strong>Templates only</strong> gives you shareable exercises and
        workout/program templates; <strong>Templates and user information</strong>
        is a full backup with your profile, body weight, and workout history.
      </p>
      <div style="margin-bottom: var(--space-3);">
        <label for="set-export-scope">Export contents</label>
        <select id="set-export-scope" bind:value={exportScope}>
          <option value="templates_user">{SCOPE_LABELS.templates_user}</option>
          <option value="templates">{SCOPE_LABELS.templates}</option>
        </select>
      </div>
      <div class="actions">
        <button class="btn btn-primary" onclick={() => downloadExport(exportScope)}>Export</button>
        <label class="btn" style="margin-bottom: 0;">
          Import
          <input type="file" accept="application/json" onchange={onImportFile} hidden />
        </label>
      </div>
      <p class="muted" style="margin-top: var(--space-2); font-size: var(--font-size-sm);">
        Import detects the file's type automatically: a full backup replaces
        everything, a templates file merges in without touching your data.
      </p>
    </Card>

    <Card title="Developer">
      {#if !inDeveloperMode}
        <p class="muted" style="margin-bottom: var(--space-3);">
          Developer options can corrupt or destroy your data and are locked
          until you confirm you understand the risk (asked once per session).
        </p>
        <button class="btn" onclick={() => (showDevModal = true)}>Unlock developer options</button>
      {:else}
        <p class="muted" style="margin-bottom: var(--space-3);">
          Load sample data for trying the app out, or wipe everything on this
          device (exports in the Backup section above are your only undo).
          The <strong>simple</strong> seed is a realistic small dataset; the
          <strong>heavy usage</strong> seed loads hundreds of exercises,
          workouts, and records to exercise the paginated pages.
        </p>
        <div class="actions">
          <button class="btn" onclick={() => runSeed('simple')} disabled={seeding}>
            Load simple seed
          </button>
          <button class="btn" onclick={() => runSeed('heavy')} disabled={seeding}>
            Load heavy usage seed
          </button>
          <button class="btn btn-danger" onclick={clearData} disabled={seeding}>Clear all data</button>
        </div>
      {/if}
    </Card>
  </div>

  {#if showDevModal}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dev-modal-title">
      <div class="modal">
        <h3 id="dev-modal-title">Unlock developer options</h3>
        <p class="muted">To continue, type the following phrase exactly:</p>
        <p class="phrase">“{DEV_PHRASE}”</p>
        <form onsubmit={unlockDeveloperMode}>
          <input
            bind:value={devPhraseInput}
            placeholder="Type the phrase here"
            aria-label="Confirmation phrase"
          />
          <div class="modal-actions">
            <button
              type="button"
              class="btn"
              onclick={() => {
                showDevModal = false;
                devPhraseInput = '';
              }}>Cancel</button
            >
            <button type="submit" class="btn btn-primary" disabled={devPhraseInput.trim() !== DEV_PHRASE}>
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
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

  .test-ok {
    color: var(--color-success);
    font-size: var(--font-size-sm);
  }

  .test-err {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
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
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .phrase {
    font-style: italic;
    font-weight: 600;
    border-left: 3px solid var(--color-warning);
    padding-left: var(--space-3);
  }

  .modal-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-3);
  }

  @media (max-width: 30rem) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
