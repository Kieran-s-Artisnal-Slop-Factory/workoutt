<script lang="ts">
  /**
   * Site-wide warning strip under the navbar. Shows when the data is at
   * risk: persistent storage not granted, or the last sync attempt failed.
   * Dismissable for the rest of the browser session.
   */
  import { onMount } from 'svelte';
  import { getSyncStatus, getSyncMode, SYNC_EVENT } from '../lib/sync';
  import { href } from '../lib/paths';

  const DISMISS_KEY = 'workoutt-warnings-dismissed';

  interface Warning {
    id: string;
    text: string;
  }

  let warnings: Warning[] = $state([]);
  let dismissed = $state(false);

  async function evaluate() {
    const next: Warning[] = [];

    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      next.push({
        id: 'persist',
        text: 'Storage is not persistent — the browser may evict your workout data. Grant persistence and export a backup in Settings.',
      });
    }

    const status = await getSyncStatus();
    if (getSyncMode() !== 'offline' && status.lastError) {
      next.push({
        id: 'sync',
        text: 'Not currently syncing — the sync server is unreachable, so this device holds the only copy of recent changes.',
      });
    }

    warnings = next;
  }

  onMount(() => {
    dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    evaluate();
    // Re-evaluate when a sync attempt finishes (the initial auto-sync fires
    // right after page load, so a stale error clears itself).
    const onSync = () => evaluate();
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  });

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    dismissed = true;
  }
</script>

{#if warnings.length > 0 && !dismissed}
  <div class="banner" role="alert">
    <div class="messages">
      {#each warnings as warning (warning.id)}
        <p>⚠️ {warning.text} <a href={href('/settings/')}>Open Settings</a></p>
      {/each}
    </div>
    <button class="dismiss" onclick={dismiss} aria-label="Dismiss warnings for this session">✕</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    background: color-mix(in srgb, var(--color-warning) 18%, var(--surface-color));
    border-bottom: 1px solid var(--color-warning);
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-sm);
  }

  .messages {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .messages a {
    font-weight: 600;
  }

  .dismiss {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted-color);
    font-size: var(--font-size-base);
    padding: 0 var(--space-1);
  }

  .dismiss:hover {
    color: var(--text-color);
  }
</style>
