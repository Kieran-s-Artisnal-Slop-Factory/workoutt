<script lang="ts">
  /**
   * Minutes:seconds split input for durations. Emits total seconds (or null
   * when both fields are empty) via onchange; storage stays seconds-only.
   */
  let {
    seconds = null,
    onchange,
    ariaLabel = 'time',
  }: {
    seconds?: number | null;
    onchange: (totalSeconds: number | null) => void;
    ariaLabel?: string;
  } = $props();

  let minutes: number | '' = $state(seconds == null ? '' : Math.floor(seconds / 60));
  let secs: number | '' = $state(seconds == null ? '' : Math.round(seconds % 60));

  function emit() {
    if (minutes === '' && secs === '') {
      onchange(null);
      return;
    }
    const total = (minutes === '' ? 0 : Number(minutes)) * 60 + (secs === '' ? 0 : Number(secs));
    onchange(total);
  }
</script>

<div class="time-input">
  <input
    type="number"
    min="0"
    inputmode="numeric"
    placeholder="min"
    bind:value={minutes}
    onchange={emit}
    aria-label={`${ariaLabel} minutes`}
  />
  <span class="colon">:</span>
  <input
    type="number"
    min="0"
    max="59"
    inputmode="numeric"
    placeholder="sec"
    bind:value={secs}
    onchange={emit}
    aria-label={`${ariaLabel} seconds`}
  />
</div>

<style>
  .time-input {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 6.5rem;
  }

  .time-input input {
    min-width: 3rem;
    flex: 1;
  }

  .colon {
    color: var(--text-muted-color);
    font-weight: 700;
  }
</style>
