<script>
  let { summary, open = false, children } = $props();
</script>

<details class="accordion" {open}>
  <summary>
    <span>{summary}</span>
    <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </summary>
  <div class="content">
    {@render children?.()}
  </div>
</details>

<style>
  .accordion {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    font-weight: 600;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    background: var(--color-primary-soft);
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.2s ease;
    color: var(--text-muted-color);
  }

  details[open] .chevron {
    transform: rotate(180deg);
  }

  .content {
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--border-color);
  }
</style>
