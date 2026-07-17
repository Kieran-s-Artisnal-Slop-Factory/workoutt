<script lang="ts">
  /**
   * Renders one pet-game pixel grid as crisp SVG rects (pets.md §"Pixel
   * art"). ~576 rects worst case (24×24) — no need to merge runs.
   */
  import { resolveColor, type SpriteGrid } from '../lib/pets/sprites/types';

  let {
    grid,
    palette,
    size = 96,
    title = '',
  }: {
    grid: SpriteGrid;
    palette: readonly [string, string, string, string];
    /** Rendered CSS size in px (the viewBox scales the grid up). */
    size?: number;
    title?: string;
  } = $props();

  const pixels = $derived.by(() => {
    const out: { x: number; y: number; color: string }[] = [];
    for (let y = 0; y < grid.rows.length; y++) {
      const row = grid.rows[y];
      for (let x = 0; x < row.length; x++) {
        const color = resolveColor(row[x], palette);
        if (color) out.push({ x, y, color });
      }
    }
    return out;
  });
</script>

<svg
  viewBox={`0 0 ${grid.size} ${grid.size}`}
  width={size}
  height={size}
  role="img"
  aria-label={title || 'pixel sprite'}
  style="shape-rendering: crispEdges; image-rendering: pixelated;"
>
  {#if title}<title>{title}</title>{/if}
  {#each pixels as p}
    <rect x={p.x} y={p.y} width="1" height="1" fill={p.color} />
  {/each}
</svg>
