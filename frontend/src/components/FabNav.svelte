<script>
  /**
   * Floating action button that expands into a stack of quick actions.
   * Pass `actions` to customize per page; defaults to global quick-nav.
   */
  let {
    actions = [
      { href: '/workout/', label: 'Start workout' },
      { href: '/exercises/', label: 'New exercise' },
      { href: '/workouts/', label: 'New template' },
    ],
  } = $props();

  let open = $state(false);
</script>

<div class="fab-nav" class:open>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (open = false)}></div>
  {/if}

  <div class="actions" role="menu" aria-hidden={!open}>
    {#each actions as action}
      <a class="action" role="menuitem" href={action.href} tabindex={open ? 0 : -1}>
        {action.label}
      </a>
    {/each}
  </div>

  <button
    class="fab"
    aria-expanded={open}
    aria-label={open ? 'Close quick actions' : 'Open quick actions'}
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  </button>
</div>

<style>
  .fab-nav {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-3);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.25);
    z-index: -1;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    opacity: 0;
    transform: translateY(8px);
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }

  .open .actions {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  .action {
    background: var(--surface-raised-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-1);
    padding: var(--space-2) var(--space-4);
    text-decoration: none;
    color: var(--text-color);
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .fab {
    width: 3.5rem;
    height: 3.5rem;
    border-radius: var(--radius-full);
    border: none;
    background: var(--color-primary);
    color: var(--color-on-primary);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .fab:hover {
    background: var(--color-primary-strong);
  }

  .open .fab {
    transform: rotate(45deg);
  }
</style>
