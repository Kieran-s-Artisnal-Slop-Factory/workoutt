<script lang="ts">
  import { onMount } from 'svelte';
  import { all, put, withSyncFields, nowIso } from '../../lib/db/repo';
  import { getProfile, newProfile } from '../../lib/db/profile';
  import { requestPersistentStorage } from '../../lib/db/persistence';
  import { testConnection, setSyncUrl, getSyncUrl, setSyncMode, getSyncMode, syncNow } from '../../lib/sync';
  import { displayToKg, kgToDisplay } from '../../lib/utils/units';
  import { todayLocal } from '../../lib/utils/dates';
  import { href } from '../../lib/paths';
  import type {
    BodyWeightEntry,
    UserProfile,
    WeightUnit,
    DistanceUnit,
  } from '../../lib/db/types';
  import Card from '../Card.svelte';

  const OFFLINE_HELP =
    'While in this mode data is stored ONLY in the browser. Due to differences between browsers please do regular backups of your data via the export options in the settings page.';
  const SYNC_HELP =
    'This mode will synchronize data between your device and a server. See our documentation for details on server setup. (Please note you can still lose data if your information is synced offline according to the data retention policies of your browser.)';

  let loading = $state(true);
  let saving = $state(false);
  let submitError = $state('');
  let showProgramModal = $state(false);

  /**
   * The very first choice (pets.md / sync UX): a brand-new setup, or joining
   * an existing sync server. 'choose' shows the fork; 'existing' asks only
   * for the server URL and pulls everything; 'new' is the full setup form.
   */
  let flow: 'choose' | 'new' | 'existing' = $state('choose');

  let name = $state('');
  let weightUnit: WeightUnit = $state('kg');
  let distanceUnit: DistanceUnit = $state('km');
  let currentWeight: number | '' = $state('');
  let age: number | '' = $state('');
  let height: number | '' = $state('');
  let heightUnit: 'cm' | 'ftin' = $state('cm');
  let heightFt: number | '' = $state('');
  let heightIn: number | '' = $state('');

  const CM_PER_IN = 2.54;

  /** Whatever the inputs hold, as canonical centimeters. */
  function heightAsCm(): number | null {
    if (heightUnit === 'cm') return height === '' ? null : Number(height);
    if (heightFt === '' && heightIn === '') return null;
    const inches = (heightFt === '' ? 0 : Number(heightFt)) * 12 + (heightIn === '' ? 0 : Number(heightIn));
    return Math.round(inches * CM_PER_IN * 10) / 10;
  }

  /** Convert the current value when the user flips the height unit. */
  function onHeightUnitChange() {
    if (heightUnit === 'ftin' && height !== '') {
      const totalIn = Number(height) / CM_PER_IN;
      heightFt = Math.floor(totalIn / 12);
      heightIn = Math.round(totalIn % 12);
    } else if (heightUnit === 'cm' && (heightFt !== '' || heightIn !== '')) {
      height = heightAsCmFromFtIn();
    }
  }

  function heightAsCmFromFtIn(): number | '' {
    if (heightFt === '' && heightIn === '') return '';
    const inches = (heightFt === '' ? 0 : Number(heightFt)) * 12 + (heightIn === '' ? 0 : Number(heightIn));
    return Math.round(inches * CM_PER_IN * 10) / 10;
  }

  /** Pet-game opt-in (pets.md §1) — off by default, enabled after submit. */
  let petsOptIn = $state(false);

  let mode: 'offline' | 'sync' = $state('offline');
  let serverUrl = $state('');
  let testing = $state(false);
  let testResult: { ok: boolean; message: string } | null = $state(null);

  // Partial state from a previous install (e.g. onboarding never finished,
  // or manually damaged data): offer a best-effort recovery instead of
  // silently overwriting.
  let existing: UserProfile | undefined;
  let hasPartialState = $state(false);
  let recovered = $state(false);
  /** Deliberate re-run from Settings (?redo=1): keep existing data, prefill. */
  let redo = $state(false);

  onMount(async () => {
    redo = new URLSearchParams(location.search).get('redo') === '1';
    try {
      const profile = await getProfile();
      if (profile?.onboarding_completed_at && !redo) {
        location.href = href('/');
        return;
      }
      if (profile?.onboarding_completed_at && redo) {
        // Re-run: merge into the existing profile on submit (no duplicates)
        // and start from the current settings rather than a blank form.
        existing = profile;
        flow = 'new';
        await recover();
        loading = false;
        return;
      }
      existing = profile;
      if (existing) {
        hasPartialState = true;
        flow = 'new'; // partial local data → straight to the form (recover offered)
      } else {
        // Profile missing but other data present also counts as partial state.
        const [exercises, weights] = await Promise.all([
          all('exercises'),
          all<BodyWeightEntry>('body_weight_entries'),
        ]);
        hasPartialState = exercises.length > 0 || weights.length > 0;
        if (hasPartialState) flow = 'new';
      }
    } catch (err) {
      // Damaged storage (e.g. a manually deleted store) — proceed as a fresh
      // install; submitting may still fail, which we surface below.
      console.error('[workoutt onboarding] could not inspect existing data:', err);
    }
    loading = false;
  });

  /**
   * "Connect to an existing server": ignore all local form fields, pull the
   * whole dataset (profile included) and adopt it. Deliberately creates NO
   * local profile — that's what caused duplicate-profile / shadowed-settings
   * bugs across devices.
   */
  async function connectExisting(e: SubmitEvent) {
    e.preventDefault();
    if (!serverUrl.trim()) return;
    saving = true;
    submitError = '';
    try {
      await setSyncUrl(serverUrl);
      setSyncMode('sync');
      sessionStorage.setItem('workoutt-session-synced', '1');
      const res = await syncNow();
      if (!res.ok) {
        submitError = res.error ?? 'Could not sync with that server.';
        saving = false;
        return;
      }
      await requestPersistentStorage();
      // The server's profile should now be local. If not, the server is empty
      // or the URL is wrong — don't silently strand the user offline.
      const profile = await getProfile();
      if (!profile?.onboarding_completed_at) {
        submitError =
          'Connected, but that server has no set-up account yet. Start a new setup on your first device, or double-check the address.';
        saving = false;
        return;
      }
      location.href = href('/');
    } catch (err) {
      console.error('[workoutt onboarding] connect to existing failed:', err);
      submitError = 'Could not connect and sync — check the address and that the server is running.';
      saving = false;
    }
  }

  /** Best-effort prefill from whatever survived. */
  async function recover() {
    try {
      if (existing) {
        name = existing.name ?? '';
        weightUnit = existing.display_weight_unit ?? 'kg';
        distanceUnit = existing.display_distance_unit ?? 'km';
        age = existing.age_years ?? '';
        height = existing.height_cm ?? '';
      }
      const weights = (await all<BodyWeightEntry>('body_weight_entries')).sort((a, b) =>
        b.measured_on.localeCompare(a.measured_on)
      );
      if (weights[0]) {
        currentWeight = Math.round(kgToDisplay(weights[0].weight_kg, weightUnit ?? 'kg') * 10) / 10;
      }
      mode = getSyncMode();
      serverUrl = getSyncUrl();
      recovered = true;
    } catch (err) {
      console.error('[workoutt onboarding] recovery failed:', err);
      submitError = 'Could not recover previous settings — continuing with a blank form.';
      recovered = true;
    }
  }

  async function testServer() {
    if (!serverUrl.trim()) return;
    testing = true;
    testResult = null;
    testResult = await testConnection(serverUrl);
    testing = false;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    saving = true;
    submitError = '';
    try {
      // Experience level is no longer collected here — it's chosen in the
      // program walkthrough. New profiles start with it unset; existing rows
      // keep whatever they already had.
      const fields = {
        name: name.trim() || null,
        display_weight_unit: weightUnit,
        display_distance_unit: distanceUnit,
        age_years: age === '' ? null : Number(age),
        height_cm: heightAsCm(),
        weight_tracking_enabled: currentWeight !== '',
        onboarding_completed_at: nowIso(),
      };

      if (existing) {
        // Merge into the surviving row: keeps its id (the singleton) and any
        // fields onboarding doesn't manage (e.g. highlighted PRs, experience).
        await put('user_profile', { ...existing, ...fields });
      } else {
        // Fixed singleton id so a second device never mints a duplicate.
        await put(
          'user_profile',
          newProfile({ ...fields, experience_level: null, highlighted_exercise_ids: [] })
        );
      }

      if (currentWeight !== '') {
        // Upsert today's entry so re-running onboarding never duplicates it.
        const today = todayLocal();
        const kg = displayToKg(Number(currentWeight), weightUnit);
        const todays = (await all<BodyWeightEntry>('body_weight_entries'))
          .filter((e) => e.measured_on === today)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        if (todays) {
          await put('body_weight_entries', { ...todays, weight_kg: kg });
        } else {
          await put(
            'body_weight_entries',
            withSyncFields({ weight_kg: kg, measured_on: today })
          );
        }
      }

      await setSyncUrl(mode === 'sync' ? serverUrl : '');
      setSyncMode(mode);
      if (mode === 'sync') {
        // First sync right away so any existing server data is here before
        // the homepage renders (also counts as this session's initial sync).
        sessionStorage.setItem('workoutt-session-synced', '1');
        await syncNow();
      }

      // Ask the browser to protect our data from eviction (result shown in Settings).
      await requestPersistentStorage();

      if (petsOptIn) {
        const { enablePets } = await import('../../lib/pets/xp');
        await enablePets();
      }

      // Offer the guided program walkthrough — unless they already have
      // program templates (e.g. recovered install or data pulled via sync).
      const templates = await all('program_templates');
      if (templates.length === 0) {
        saving = false;
        showProgramModal = true;
        return;
      }
      location.href = href('/');
    } catch (err) {
      console.error('[workoutt onboarding] failed to save:', err);
      submitError =
        'Could not save your settings — local storage appears damaged. Try clearing site data for this app in your browser and reloading.';
      saving = false;
    }
  }
</script>

{#if loading}
  <p class="muted">Loading…</p>
{:else if flow === 'choose'}
  <Card title="Welcome to Workoutt">
    <p class="muted" style="margin-bottom: var(--space-4);">
      Are you setting up for the first time, or connecting this device to a
      sync server you already use?
    </p>
    <div class="choose-grid">
      <button type="button" class="choose-option" onclick={() => (flow = 'new')}>
        <strong>New setup</strong>
        <span class="muted">
          Start fresh on this device. You can turn on syncing later.
        </span>
      </button>
      <button type="button" class="choose-option" onclick={() => (flow = 'existing')}>
        <strong>Connect to an existing sync server</strong>
        <span class="muted">
          Already set up elsewhere? Pull everything — your profile, programs,
          history — from your server. No other details needed.
        </span>
      </button>
    </div>
  </Card>
{:else if flow === 'existing'}
  <Card title="Connect to your sync server">
    <p class="muted" style="margin-bottom: var(--space-4);">
      Enter your server's address. Everything on it will be downloaded to this
      device — you don't need to re-enter any of your settings.
    </p>

    {#if submitError}
      <p class="error-msg" role="alert">⚠️ {submitError}</p>
    {/if}

    <form class="stack" onsubmit={connectExisting}>
      <div>
        <label for="ob-existing-server">Server address</label>
        <div class="server-row">
          <input
            id="ob-existing-server"
            type="url"
            required
            bind:value={serverUrl}
            placeholder="e.g. http://192.168.1.10:8080"
          />
          <button type="button" class="btn" onclick={testServer} disabled={!serverUrl.trim() || testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        {#if testResult}
          <p class={testResult.ok ? 'test-ok' : 'error-msg'} role="status">
            {testResult.ok ? '✅' : '⚠️'}
            {testResult.message}
          </p>
        {/if}
      </div>

      <div class="wiz-actions">
        <button type="button" class="btn" onclick={() => (flow = 'choose')} disabled={saving}>Back</button>
        <button class="btn btn-primary" type="submit" disabled={saving || !serverUrl.trim()}>
          {saving ? 'Connecting…' : 'Connect & pull everything'}
        </button>
      </div>
    </form>
  </Card>
{:else}
  <Card title="Welcome to Workoutt">
    <p class="muted" style="margin-bottom: var(--space-4);">
      A few details to get set up — no account needed.
    </p>

    {#if hasPartialState && !recovered}
      <div class="recover-notice">
        <p>
          We found data from a previous install that wasn't fully set up. You
          can start onboarding with your last settings recovered (best effort).
        </p>
        <button type="button" class="btn" onclick={recover}>Recover previous settings</button>
      </div>
    {/if}

    {#if submitError}
      <p class="error-msg" role="alert">⚠️ {submitError}</p>
    {/if}

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
          <div class="height-label">
            <label for="ob-height">Height</label>
            <select
              class="height-unit"
              bind:value={heightUnit}
              onchange={onHeightUnitChange}
              aria-label="Height unit"
            >
              <option value="cm">cm</option>
              <option value="ftin">ft + in</option>
            </select>
          </div>
          {#if heightUnit === 'cm'}
            <input id="ob-height" type="number" min="50" max="250" bind:value={height} placeholder="cm" />
          {:else}
            <div class="ftin-row">
              <input id="ob-height" type="number" min="1" max="8" bind:value={heightFt} placeholder="ft" aria-label="Height feet" />
              <input type="number" min="0" max="11" bind:value={heightIn} placeholder="in" aria-label="Height inches" />
            </div>
          {/if}
        </div>
        <div></div>
      </div>

      <div>
        <span class="field-label">Data storage</span>
        <div class="mode-toggle">
          <button
            type="button"
            class:active={mode === 'offline'}
            aria-pressed={mode === 'offline'}
            onclick={() => (mode = 'offline')}
          >
            Offline only
          </button>
          <button
            type="button"
            class:active={mode === 'sync'}
            aria-pressed={mode === 'sync'}
            onclick={() => (mode = 'sync')}
          >
            Sync mode
          </button>
        </div>
        <p class="muted helptext">{mode === 'offline' ? OFFLINE_HELP : SYNC_HELP}</p>

        {#if mode === 'sync'}
          <label for="ob-server">Server URL</label>
          <div class="server-row">
            <input
              id="ob-server"
              type="url"
              required
              bind:value={serverUrl}
              placeholder="e.g. http://192.168.1.10:8080"
            />
            <button type="button" class="btn" onclick={testServer} disabled={!serverUrl.trim() || testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
          {#if testResult}
            <p class={testResult.ok ? 'test-ok' : 'error-msg'} role="status">
              {testResult.ok ? '✅' : '⚠️'}
              {testResult.message}
            </p>
          {/if}
        {/if}
      </div>

      <label class="pets-check">
        <input type="checkbox" bind:checked={petsOptIn} />
        <span>
          Hatch a workout buddy? 🥚
          <span class="muted helptext" style="display: block; margin-bottom: 0;">
            An optional collection game: training earns XP that evolves
            pixel-art companions. Purely cosmetic — you can turn it off any
            time in Settings.
          </span>
        </span>
      </label>

      <button class="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Get started'}
      </button>
    </form>
  </Card>

  {#if showProgramModal}
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="program-modal-title">
      <div class="modal">
        <h3 id="program-modal-title">Want help setting up your first program?</h3>
        <p class="muted">
          We can walk you through it step by step — what exercises, workout
          templates, and programs are, and how to build your own (or use the
          classic Push / Pull / Legs split). It takes a couple of minutes and
          you'll finish with workouts on your schedule.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn" onclick={() => (location.href = href('/'))}>
            Not now, take me home
          </button>
          <button type="button" class="btn btn-primary" onclick={() => (location.href = href('/setup-program/'))}>
            Yes, walk me through it
          </button>
        </div>
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

  .height-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .height-label label {
    margin-bottom: var(--space-1);
  }

  .height-unit {
    width: auto;
    padding: 0 var(--space-2);
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-1);
  }

  .ftin-row {
    display: flex;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-muted-color);
    display: block;
    margin-bottom: var(--space-1);
  }

  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }

  .mode-toggle button {
    border: none;
    background: var(--surface-color);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    font-weight: 600;
    color: var(--text-muted-color);
  }

  .mode-toggle button.active {
    background: var(--color-primary);
    color: var(--color-on-primary);
  }

  .helptext {
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-3);
  }

  .pets-check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    color: var(--text-color);
  }

  .pets-check input {
    width: auto;
    margin-top: 0.25rem;
  }

  .server-row {
    display: flex;
    gap: var(--space-2);
  }

  .server-row input {
    flex: 1;
  }

  .choose-grid {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  }

  .choose-option {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    text-align: left;
    background: var(--surface-color);
    border: 2px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    cursor: pointer;
    font: inherit;
  }

  .choose-option:hover {
    border-color: var(--color-primary);
  }

  .choose-option strong {
    color: var(--text-color);
  }

  .wiz-actions {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .test-ok {
    color: var(--color-success);
    font-size: var(--font-size-sm);
    margin-top: var(--space-2);
  }

  .error-msg {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    margin-top: var(--space-2);
  }

  .recover-notice {
    background: var(--color-primary-soft);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
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
    max-width: 32rem;
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

  @media (max-width: 30rem) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
