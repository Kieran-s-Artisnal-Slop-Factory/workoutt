<script>
  /**
   * Line chart built on Observable Plot (single or multi-line via zAxisDataField).
   * Prop API mirrors https://kieranwood.ca/components/stacks/astro-svelte/observable-plot/linechart/
   * reimplemented with Svelte 5 runes. Client-only (use client:load / client:visible).
   */
  import * as Plot from '@observablehq/plot';

  let {
    data = [],
    xAxisDataField,
    yAxisDataField,
    zAxisDataField = undefined,
    title = undefined,
    subtitle = undefined,
    xAxisLabel = undefined,
    yAxisLabel = undefined,
    lineColor = 'var(--color-primary)',
    interpolation = 'linear',
    tooltips = true,
    sort = true,
    sortDescending = false,
    width = 640,
    height = 400,
    domain = undefined,
    colorConfig = {},
  } = $props();

  let container;

  $effect(() => {
    if (!container || data.length === 0) return;

    const rows = sort
      ? [...data].sort((a, b) => {
          const ax = a[xAxisDataField];
          const bx = b[xAxisDataField];
          const cmp = ax < bx ? -1 : ax > bx ? 1 : 0;
          return sortDescending ? -cmp : cmp;
        })
      : data;

    const lineOptions = {
      x: xAxisDataField,
      y: yAxisDataField,
      curve: interpolation,
      ...(zAxisDataField ? { z: zAxisDataField, stroke: zAxisDataField } : { stroke: lineColor }),
      ...(tooltips && { tip: true }),
    };

    const plot = Plot.plot({
      width,
      height,
      style: { background: 'transparent', color: 'var(--text-muted-color)' },
      x: { label: xAxisLabel ?? xAxisDataField },
      y: { label: yAxisLabel ?? yAxisDataField, grid: true, ...(domain && { domain }) },
      ...(zAxisDataField && { color: { legend: true, ...colorConfig } }),
      marks: [Plot.line(rows, lineOptions), Plot.dot(rows, { x: xAxisDataField, y: yAxisDataField, fill: zAxisDataField ?? lineColor })],
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
