<script>
  /**
   * Bar chart built on Observable Plot.
   * Prop API mirrors https://kieranwood.ca/components/stacks/astro-svelte/observable-plot/barchart/
   * reimplemented with Svelte 5 runes. Client-only (use client:load / client:visible).
   */
  import * as Plot from '@observablehq/plot';

  let {
    data = [],
    xAxisDataField,
    yAxisDataField,
    title = undefined,
    subtitle = undefined,
    xAxisLabel = undefined,
    yAxisLabel = undefined,
    fillDataField = undefined,
    colorConfig = { scheme: 'Oranges' },
    domain = undefined,
    width = 640,
    height = 400,
    tooltips = true,
    sort = false,
    sortDescending = false,
    valuesOnBars = true,
  } = $props();

  let container;

  $effect(() => {
    if (!container || data.length === 0) return;

    const rows = sort
      ? [...data].sort((a, b) =>
          sortDescending
            ? b[yAxisDataField] - a[yAxisDataField]
            : a[yAxisDataField] - b[yAxisDataField]
        )
      : data;

    const barOptions = {
      x: xAxisDataField,
      y: yAxisDataField,
      fill: fillDataField ?? 'var(--color-primary)',
      ...(tooltips && { tip: true }),
    };

    const marks = [
      Plot.barY(rows, barOptions),
      Plot.ruleY([0]),
    ];

    if (valuesOnBars) {
      marks.push(
        Plot.text(rows, {
          x: xAxisDataField,
          y: yAxisDataField,
          text: (d) => d[yAxisDataField],
          dy: -8,
          fill: 'var(--text-color)',
        })
      );
    }

    const plot = Plot.plot({
      width,
      height,
      style: { background: 'transparent', color: 'var(--text-muted-color)' },
      x: { label: xAxisLabel ?? xAxisDataField, tickSize: 0 },
      y: { label: yAxisLabel ?? yAxisDataField, grid: true, ...(domain && { domain }) },
      ...(fillDataField && { color: { legend: true, ...colorConfig } }),
      marks,
    });

    container.replaceChildren(plot);
    return () => plot.remove();
  });
</script>

<figure class="chart">
  {#if title}<figcaption class="title">{title}</figcaption>{/if}
  {#if subtitle}<figcaption class="subtitle">{subtitle}</figcaption>{/if}
  <div bind:this={container}>
    {#if data.length === 0}
      <p class="empty">No data yet</p>
    {/if}
  </div>
</figure>

<style>
  .chart {
    margin: 0;
  }

  .title {
    font-weight: 700;
    font-size: var(--font-size-lg);
  }

  .subtitle {
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    margin-bottom: var(--space-2);
  }

  .empty {
    color: var(--text-muted-color);
    font-size: var(--font-size-sm);
    padding: var(--space-4) 0;
  }
</style>
